import "server-only";

import { load } from "js-yaml";
import type {
  DeploymentKnowledge,
  DeploymentSource,
  DeploymentStep,
  InfrastructureNode,
  UdsConfigSection,
  UdsPackage,
} from "@/components/infrastructure-types";

type SourceFile = { path: string; content: string };
type BundleDocument = {
  packages?: Array<{
    name?: string;
    ref?: string;
    repository?: string;
    path?: string;
    optionalComponents?: string[];
    "<<"?: { ref?: string; repository?: string };
  }>;
};

function source(repository: string, branch: string, file: SourceFile, needle: RegExp | string): DeploymentSource {
  const lines = file.content.split("\n");
  const line = typeof needle === "string"
    ? Math.max(1, lines.findIndex((entry) => entry.includes(needle)) + 1)
    : Math.max(1, lines.findIndex((entry) => needle.test(entry)) + 1);
  return {
    file: file.path,
    line,
    url: `https://github.com/${repository}/blob/${branch}/${file.path}#L${line}`,
  };
}

function taskSource(repository: string, branch: string, file: SourceFile, task: string) {
  return source(repository, branch, file, new RegExp(`^\\s*- name: ${task.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`));
}

function addresses(value: string) {
  const results = new Set<string>();
  for (const match of value.matchAll(/\bdata\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)|\bmodule\.([A-Za-z0-9_-]+)|\b([A-Za-z][A-Za-z0-9_-]*_[A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)/g)) {
    if (match[1] && match[2]) results.add(`data.${match[1]}.${match[2]}`);
    else if (match[3]) results.add(`module.${match[3]}`);
    else if (match[4] && match[5]) results.add(`${match[4]}.${match[5]}`);
  }
  return [...results];
}

function configSections(repository: string, branch: string, file: SourceFile, nodes: InfrastructureNode[]): UdsConfigSection[] {
  const start = file.content.indexOf("\nvariables:\n");
  const end = file.content.indexOf("\nEOY", start);
  if (start < 0 || end < 0) return [];
  const content = file.content.slice(start + 1, end);
  const lines = content.split("\n");
  const sections: UdsConfigSection[] = [];
  const headings = lines
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => /^  [A-Za-z0-9_-]+:\s*$/.test(line));
  const nodeIds = new Set(nodes.filter((node) => node.scope === "root").map((node) => node.id));

  headings.forEach((heading, index) => {
    const next = headings[index + 1]?.index ?? lines.length;
    const body = lines.slice(heading.index, next).join("\n");
    const name = heading.line.trim().replace(/:$/, "");
    const variables = lines
      .slice(heading.index + 1, next)
      .map((line) => line.match(/^    ([A-Za-z][A-Za-z0-9_-]+):/)?.[1])
      .filter((variable): variable is string => Boolean(variable));
    const dependencies = addresses(body).filter((address) => nodeIds.has(address));
    const line = file.content.slice(0, start + 1).split("\n").length + heading.index + 1;
    sections.push({
      name,
      variableCount: variables.length,
      variables,
      infrastructureNodeIds: dependencies,
      source: {
        file: file.path,
        line,
        url: `https://github.com/${repository}/blob/${branch}/${file.path}#L${line}`,
      },
    });
  });
  return sections;
}

export function analyzeSonicDeployment({
  repository,
  branch,
  files,
  nodes,
  detectedEnvironments,
}: {
  repository: string;
  branch: string;
  files: SourceFile[];
  nodes: InfrastructureNode[];
  detectedEnvironments: string[];
}): DeploymentKnowledge {
  const byPath = new Map(files.map((file) => [file.path, file]));
  const topTasks = byPath.get("tasks.yaml") ?? { path: "tasks.yaml", content: "" };
  const mainTasks = byPath.get("tasks/main.yaml") ?? { path: "tasks/main.yaml", content: "" };
  const swfTasks = byPath.get("tasks/swf.yaml") ?? { path: "tasks/swf.yaml", content: "" };
  const utilityTasks = byPath.get("tasks/utility.yaml") ?? { path: "tasks/utility.yaml", content: "" };
  const bundleFile = byPath.get("bundles/swf/uds-bundle.yaml") ?? { path: "bundles/swf/uds-bundle.yaml", content: "" };
  const configFile = byPath.get("iac/swf/uds-config.tf") ?? { path: "iac/swf/uds-config.tf", content: "" };
  const deployFlow = byPath.get("docs/00-overview/deploy-flow.md") ?? { path: "docs/00-overview/deploy-flow.md", content: "" };
  const environmentDoc = byPath.get("docs/00-overview/environments.md") ?? { path: "docs/00-overview/environments.md", content: "" };

  const steps: DeploymentStep[] = [
    {
      id: "select-environment",
      order: 1,
      title: "Select the target environment",
      command: "uds run set-env --set ENV=<stg|prd>",
      phase: "prepare",
      frequency: "every deployment",
      description: "Persists the environment used by subsequent UDS tasks. Operators should confirm it with uds run read-env before changing infrastructure.",
      outcome: "Every following task reads the intended staging or production configuration.",
      source: taskSource(repository, branch, topTasks, "set-env"),
    },
    {
      id: "bootstrap",
      order: 2,
      title: "Create the remote-state foundation",
      command: "uds run one-time-bootstrap-env --set ENV=<stg|prd>",
      phase: "foundation",
      frequency: "first deployment",
      description: "Creates the S3 state bucket and DynamoDB locking table, then generates backend configuration for each Terraform root.",
      outcome: "Terraform state can be shared and safely locked for the selected environment.",
      source: taskSource(repository, branch, mainTasks, "one-time-bootstrap-env"),
    },
    {
      id: "account",
      order: 3,
      title: "Establish account-level access",
      command: "uds run apply-account --set ENV=<stg|prd>",
      phase: "foundation",
      frequency: "first deployment",
      description: "Applies the account root that manages the shared assumable administrative role used by operators and later infrastructure tasks.",
      outcome: "The AWS account has the shared access foundation required to administer the platform.",
      source: taskSource(repository, branch, topTasks, "apply-account"),
    },
    {
      id: "plan-swf",
      order: 4,
      title: "Preview the SWF infrastructure change",
      command: "uds run plan-swf --set ENV=<stg|prd>",
      phase: "infrastructure",
      frequency: "every deployment",
      description: "Reconfigures the selected backend and previews changes using common, SWF, and context environment files.",
      outcome: "Operators can review what will be created, changed, or removed before applying it.",
      source: taskSource(repository, branch, topTasks, "plan-swf"),
    },
    {
      id: "apply-swf",
      order: 5,
      title: "Deploy the AWS and Kubernetes foundation",
      command: "uds run apply-swf --set ENV=<stg|prd>",
      phase: "infrastructure",
      frequency: "every deployment",
      description: "Applies the SWF Terraform root: networks, EKS, worker capacity, databases, storage, encryption, secrets, access hosts, and application AWS dependencies.",
      outcome: "The cloud foundation needed by UDS Core and the software factory applications exists.",
      source: taskSource(repository, branch, topTasks, "apply-swf"),
    },
    {
      id: "transit-gateway",
      order: 6,
      title: "Connect the SWF network",
      command: "uds run apply-transit-gateway --set ENV=<stg|prd>",
      phase: "infrastructure",
      frequency: "every deployment",
      description: "Reads the SWF remote state and creates the Transit Gateway attachment, routing, and associations after the VPC exists.",
      outcome: "The private SWF network is connected to the wider environment through approved routes.",
      source: taskSource(repository, branch, topTasks, "apply-transit-gateway"),
    },
    {
      id: "uds-config",
      order: 7,
      title: "Publish infrastructure values for UDS",
      command: "uds run update-uds-config --set ENV=<stg|prd>",
      phase: "configuration",
      frequency: "every deployment",
      description: "Targets the generated UDS configuration secret so current database endpoints, bucket names, IAM roles, encryption keys, certificates, and platform settings are available to the bundle.",
      outcome: "AWS Secrets Manager contains the environment-specific configuration consumed during UDS deployment.",
      source: taskSource(repository, branch, topTasks, "update-uds-config"),
    },
    {
      id: "kubeconfig",
      order: 8,
      title: "Configure access to the private cluster",
      command: "uds run update-kubeconfig --set ENV=<stg|prd>",
      phase: "configuration",
      frequency: "as needed",
      description: "Reads EKS outputs and updates the operator's kubeconfig. The private cluster endpoint is reached through the bastion and SSM connectivity.",
      outcome: "The deployment machine can authenticate to and reach the EKS cluster.",
      source: taskSource(repository, branch, topTasks, "update-kubeconfig"),
    },
    {
      id: "bundle",
      order: 9,
      title: "Build and deploy the UDS bundle",
      command: "uds run bundle-all --set ENV=<stg|prd>",
      phase: "delivery",
      frequency: "every deployment",
      description: "Creates local Zarf packages, builds the SWF UDS bundle, retrieves the environment configuration, and deploys UDS Core and the application packages into EKS.",
      outcome: "UDS Core and the software factory applications are installed and connected to their AWS dependencies.",
      source: taskSource(repository, branch, topTasks, "bundle-all"),
    },
    {
      id: "validate",
      order: 10,
      title: "Validate the deployed platform",
      command: "Follow docs/10-operators/post-deploy-validation.md",
      phase: "validation",
      frequency: "every deployment",
      description: "Verify cluster access, workloads, gateways, application health, storage, monitoring, and other operational checks before considering the deployment complete.",
      outcome: "Operators have evidence that infrastructure and applications are functioning together.",
      source: source(repository, branch, deployFlow, "post-deploy validation"),
    },
  ];

  const roots = [
    {
      name: "bootstrap",
      path: "iac/bootstrap",
      order: 1,
      purpose: "Creates the shared S3 state backend and DynamoDB lock table used by all later Terraform roots.",
      command: "uds run apply-bootstrap",
      dependsOn: [],
    },
    {
      name: "account",
      path: "iac/account",
      order: 2,
      purpose: "Creates account-level administrative access and shared IAM foundations.",
      command: "uds run apply-account",
      dependsOn: ["bootstrap"],
    },
    {
      name: "swf",
      path: "iac/swf",
      order: 3,
      purpose: "Creates the VPCs, EKS platform, compute, databases, storage, secrets, backups, and application-specific AWS dependencies shown in this explorer.",
      command: "uds run apply-swf",
      dependsOn: ["bootstrap", "account"],
    },
    {
      name: "transit-gateway",
      path: "iac/transit-gateway",
      order: 4,
      purpose: "Reads SWF remote state and connects the deployed VPC to external network routes through Transit Gateway.",
      command: "uds run apply-transit-gateway",
      dependsOn: ["swf"],
    },
  ].map((root) => ({
    ...root,
    sourceUrl: `https://github.com/${repository}/tree/${branch}/${root.path}`,
  }));

  let bundle: BundleDocument = {};
  try {
    bundle = load(bundleFile.content) as BundleDocument;
  } catch {
    // The API analysis warning will still expose an empty package list without failing Terraform inventory.
  }

  const sections = configSections(repository, branch, configFile, nodes);
  const sectionNames = new Set(sections.map((section) => section.name));
  const packages: UdsPackage[] = (bundle.packages ?? [])
    .filter((item): item is NonNullable<BundleDocument["packages"]>[number] & { name: string } => Boolean(item.name))
    .map((item, order) => {
      const matchingSections = sectionNames.has(item.name) ? [item.name] : [];
      return {
        name: item.name,
        version: item.ref ?? item["<<"]?.ref ?? null,
        repository: item.repository ?? item["<<"]?.repository ?? null,
        local: Boolean(item.path),
        optionalComponents: item.optionalComponents ?? [],
        configSections: matchingSections,
        order: order + 1,
        source: source(repository, branch, bundleFile, new RegExp(`^\\s*- name: ${item.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\s*$`)),
      };
    });

  const environments = detectedEnvironments.map((name) => ({
    name,
    status: name === "dev" ? "vestigial" as const : "deployed" as const,
    purpose: name === "prd" ? "Production" : name === "stg" ? "Staging" : "Legacy development configuration; not an active SONIC deployment target",
    tfvarsUrl: `https://github.com/${repository}/tree/${branch}/iac/env/${name}/tfvars`,
  }));

  const udsConfigFlow = [
    {
      title: "Terraform assembles deployment configuration",
      description: "iac/swf/uds-config.tf maps infrastructure outputs into shared and package-specific UDS variables. Sensitive values remain references and are not exposed by this explorer.",
      source: source(repository, branch, configFile, "secret_string = <<EOY"),
    },
    {
      title: "AWS Secrets Manager stores the environment document",
      description: "Terraform manages an environment-specific secret and updates its current version after infrastructure values change.",
      source: source(repository, branch, configFile, 'resource "aws_secretsmanager_secret" "uds_config"'),
    },
    {
      title: "A UDS task retrieves the current configuration",
      description: "grab-uds-config downloads the secret and writes iac/env/<ENV>/uds/uds-config.yaml on the deployment machine.",
      source: taskSource(repository, branch, swfTasks, "grab-uds-config"),
    },
    {
      title: "UDS receives the generated configuration",
      description: "bundle-deploy exports the generated file through UDS_CONFIG before running uds deploy against the built SWF bundle.",
      source: taskSource(repository, branch, swfTasks, "bundle-deploy"),
    },
    {
      title: "Packages consume only their configuration section",
      description: "UDS Core and application packages receive the endpoints, role ARNs, storage identifiers, certificates, sizing, and settings assigned to their named section.",
      source: source(repository, branch, bundleFile, "packages:"),
    },
  ];

  return {
    summary: "Operators use UDS tasks as the supported interface for selecting an environment, applying the ordered Terraform roots, generating environment-specific UDS configuration, establishing cluster access, and deploying the UDS bundle.",
    preferredInterface: "UDS tasks wrap backend selection, environment tfvars, OpenTofu/Terraform operations, configuration generation, Zarf packaging, and bundle deployment.",
    quickCommand: "uds run all-up --set ENV=<stg|prd>",
    steps,
    roots,
    packages,
    configSections: sections,
    environments,
    udsConfigFlow,
    notices: [
      {
        type: "info",
        message: "Executable task definitions are treated as the primary source. The repository's deployment-flow document labels itself as a draft that has not yet been validated against a live deployment.",
        source: source(repository, branch, deployFlow, "not yet validated against a live deploy"),
      },
      {
        type: "warning",
        message: "The dev directory is retained in source but repository operator documentation identifies only stg and prd as active SONIC deployment targets.",
        source: source(repository, branch, environmentDoc, "A `dev/` tree exists but is vestigial"),
      },
      {
        type: "info",
        message: "The task implementation invokes the tofu CLI. Always use the repository's UDS tasks instead of manually reproducing backend and var-file arguments.",
        source: source(repository, branch, utilityTasks, "tofu apply"),
      },
    ],
  };
}
