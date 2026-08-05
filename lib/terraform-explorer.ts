import "server-only";

import { parse } from "@cdktf/hcl2json";
import type {
  InfrastructureCategory,
  InfrastructureEdge,
  InfrastructureExplorerData,
  InfrastructureKind,
  InfrastructureNode,
  InfrastructureOutput,
  InfrastructurePattern,
  InfrastructureProvider,
  InfrastructureVariable,
} from "@/components/infrastructure-types";

type TerraformFile = { path: string; content: string };
type JsonObject = Record<string, unknown>;

type BlockLocation = {
  kind: string;
  type?: string;
  name: string;
  line: number;
  implementation: string;
};

const CATEGORY_ORDER: InfrastructureCategory[] = [
  "Networking",
  "Compute",
  "Kubernetes",
  "Storage",
  "Databases",
  "Identity",
  "Security",
  "Monitoring",
  "Integration",
  "Platform",
];

function title(value: string) {
  return value
    .replace(/\.tf$/, "")
    .replace(/[-_]+/g, " ")
    .replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function scopeForFile(file: string) {
  const match = file.match(/^modules\/([^/]+)\//);
  return match ? `module.${match[1]}` : "root";
}

function providerFor(type: string, kind: InfrastructureKind) {
  if (kind === "module") return "module";
  const known = ["aws", "kubernetes", "helm", "random", "local", "null", "time", "tls", "http", "archive", "cloudinit"];
  return known.find((name) => type === name || type.startsWith(`${name}_`)) ?? type.split("_")[0];
}

function categoryFor(type: string, name: string, source = ""): InfrastructureCategory {
  const value = `${type} ${name} ${source}`.toLowerCase();
  if (/grafana|loki|kubecost|monitor|metric|logging|cloudwatch|log_bucket|access_log/.test(value)) return "Monitoring";
  if (/kms|secret|password|certificate|tls|public_access|encryption|key$/.test(value)) return "Security";
  if (/vpc|subnet|route|network|security_group|ingress_rule|load_balancer|cidr/.test(value)) return "Networking";
  if (/iam|identity|role|policy|key_pair|keycloak|service_account|irsa/.test(value)) return "Identity";
  if (/rds|database|postgres|mysql|elasticache|redis|_db\b|db_/.test(value)) return "Databases";
  if (/eks|kubernetes|helm|zarf|cluster|node_group|velero/.test(value)) return "Kubernetes";
  if (/s3|bucket|ebs|efs|volume|snapshot|dlm|storage/.test(value)) return "Storage";
  if (/ec2|instance|launch_template|autoscaling|bastion|build.executor|runner|lambda|ami/.test(value)) return "Compute";
  if (/sqs|notification|adna|mattermost|jira|confluence|artifactory|gitlab|sonarqube/.test(value)) return "Integration";
  return "Platform";
}

function systemFor(file: string, scope: string) {
  if (scope !== "root") return title(scope.replace(/^module\./, ""));
  const base = file.split("/").pop()?.replace(/\.tf$/, "") ?? "platform";
  const systems: Record<string, string> = {
    main: "Platform foundation",
    backend: "Platform foundation",
    providers: "Platform foundation",
    versions: "Platform foundation",
    variables: "Platform foundation",
    outputs: "Platform foundation",
    vpc: "Network foundation",
    eks: "Kubernetes platform",
    "access-logging": "Access logging",
    "load-balancer-access-logging": "Access logging",
    "asg-scheduled-actions": "Compute scheduling",
    "uds-config": "Platform configuration",
    "build-executor": "Build executor",
    "gitlab-runner": "GitLab runners",
  };
  return systems[base] ?? title(base);
}

function humanType(type: string) {
  return title(type.replace(/^(aws|kubernetes|random|local|null|time|tls|archive|cloudinit)_/, ""));
}

function plainSummary(kind: InfrastructureKind, type: string, name: string, system: string, source = "") {
  const label = title(name);
  const value = `${type} ${name} ${source}`.toLowerCase();
  if (kind === "data") return `References an existing ${humanType(type).toLowerCase()} used by ${system}. This repository reads it but does not create it.`;
  if (kind === "module") {
    if (/subnet.addrs|cidr.subnets/.test(value)) return `Calculates the network address ranges used to divide the ${system.toLowerCase()} into subnets.`;
    if (/glr.vpc|gitlab.runner.*vpc/.test(value)) return "Deploys an isolated network for short-lived GitLab runner compute.";
    if (/\bvpc\b/.test(value)) return "Deploys the primary network, its public and private subnets, database subnets, routing, and flow logging.";
    if (/\beks\b/.test(value)) return "Deploys the Kubernetes control plane and worker-node foundation that hosts the software factory services.";
    if (/_db\b|rds/.test(value)) return `Deploys a managed relational database for ${system}.`;
    if (/s3.bucket|_s3_bucket/.test(value)) return `Deploys object storage used by ${system}.`;
    if (/kms/.test(value)) return `Creates an encryption key dedicated to ${system}.`;
    if (/irsa/.test(value)) return `Grants ${system} workloads narrowly scoped AWS permissions through their Kubernetes service accounts.`;
    if (/volume.snapshot/.test(value)) return `Configures recurring volume backups for ${system}.`;
    if (/bastion/.test(value)) return "Deploys an administrative access host for securely reaching private infrastructure.";
    if (/fleeting.runner/.test(value)) return "Deploys an automatically scaled pool of short-lived GitLab build runners.";
    if (/zarf/.test(value)) return "Connects package deployment tooling to the Kubernetes cluster and its supporting storage.";
    return `Uses a reusable module to manage the ${label} component for ${system}.`;
  }
  if (/security_group_ingress_rule/.test(type)) return `Allows an approved source to reach ${system} on a specific network port.`;
  if (/security_group/.test(type)) return `Controls which network traffic can reach ${system}.`;
  if (/secretsmanager_secret_version/.test(type)) return `Stores the current managed value for a ${system} secret.`;
  if (/secretsmanager_secret/.test(type)) return `Creates a protected secret container used by ${system}.`;
  if (/random_password/.test(type)) return `Generates a password for ${system} without placing a fixed credential in source control.`;
  if (/kms_key|kms_alias/.test(type)) return `Provides an identifiable encryption key for data managed by ${system}.`;
  if (/s3_bucket_lifecycle/.test(type)) return `Controls retention and cleanup for object storage used by ${system}.`;
  if (/s3_bucket/.test(type)) return `Creates object storage used by ${system}.`;
  if (/elasticache_replication_group/.test(type)) return "Deploys a highly available Redis cache used by GitLab.";
  if (/autoscaling_schedule/.test(type)) return `Schedules when ${system} compute capacity should increase or decrease.`;
  if (/autoscaling_group/.test(type)) return `Maintains the requested amount of compute capacity for ${system}.`;
  if (/launch_template/.test(type)) return `Defines how new ${system} compute instances are configured when launched.`;
  if (/iam_policy|iam_role/.test(type)) return `Defines AWS permissions used by ${system}.`;
  if (/sqs_queue/.test(type)) return `Creates a message queue that receives events from ${system}.`;
  return `Creates and manages the ${label} ${humanType(type).toLowerCase()} used by ${system}.`;
}

function stringify(value: unknown, limit = 320) {
  if (value === undefined) return "";
  let result: string;
  if (typeof value === "string") result = value;
  else {
    try {
      result = JSON.stringify(value);
    } catch {
      result = String(value);
    }
  }
  return result.length > limit ? `${result.slice(0, limit - 1)}…` : result;
}

function locations(source: string): BlockLocation[] {
  const blocks: BlockLocation[] = [];
  const expression = /^\s*(resource|data)\s+"([^"]+)"\s+"([^"]+)"\s*\{|^\s*(module|variable|output|provider)\s+"([^"]+)"\s*\{/gm;
  let match: RegExpExecArray | null;
  while ((match = expression.exec(source))) {
    const kind = match[1] ?? match[4];
    const type = match[1] ? match[2] : undefined;
    const name = match[1] ? match[3] : match[5];
    const start = match.index;
    const brace = source.indexOf("{", start);
    let depth = 0;
    let end = brace;
    let quoted = false;
    let escaped = false;
    for (let index = brace; index < source.length; index += 1) {
      const character = source[index];
      if (escaped) {
        escaped = false;
      } else if (character === "\\" && quoted) {
        escaped = true;
      } else if (character === '"') {
        quoted = !quoted;
      } else if (!quoted && character === "{") {
        depth += 1;
      } else if (!quoted && character === "}") {
        depth -= 1;
        if (depth === 0) {
          end = index + 1;
          break;
        }
      }
    }
    blocks.push({
      kind,
      type,
      name,
      line: source.slice(0, start).split("\n").length,
      implementation: source.slice(start, end).trim().slice(0, 12_000),
    });
  }
  return blocks;
}

function findLocation(entries: BlockLocation[], kind: string, name: string, type?: string) {
  return entries.find((entry) => entry.kind === kind && entry.name === name && (!type || entry.type === type));
}

function walkStrings(value: unknown, callback: (value: string) => void) {
  if (typeof value === "string") {
    callback(value);
  } else if (Array.isArray(value)) {
    value.forEach((item) => walkStrings(item, callback));
  } else if (value && typeof value === "object") {
    Object.values(value).forEach((item) => walkStrings(item, callback));
  }
}

function references(block: JsonObject) {
  const infrastructure = new Set<string>();
  const variables = new Set<string>();
  const locals = new Set<string>();
  walkStrings(block, (value) => {
    if (!value.includes("${")) return;
    for (const match of value.matchAll(/\bdata\.([A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)|\bmodule\.([A-Za-z0-9_-]+)|\b([A-Za-z][A-Za-z0-9_-]*_[A-Za-z0-9_-]+)\.([A-Za-z0-9_-]+)/g)) {
      if (match[1] && match[2]) infrastructure.add(`data.${match[1]}.${match[2]}`);
      else if (match[3]) infrastructure.add(`module.${match[3]}`);
      else if (match[4] && match[5]) infrastructure.add(`${match[4]}.${match[5]}`);
    }
    for (const match of value.matchAll(/\bvar\.([A-Za-z0-9_-]+)/g)) variables.add(match[1]);
    for (const match of value.matchAll(/\blocal\.([A-Za-z0-9_-]+)/g)) locals.add(match[1]);
  });
  return { infrastructure: [...infrastructure], variables: [...variables], locals: [...locals] };
}

function moduleVersion(source: string) {
  const match = source.match(/[?&]ref=([^&]+)/);
  return match?.[1];
}

function attributes(block: JsonObject) {
  const hidden = new Set(["source", "version", "providers", "depends_on", "count", "for_each"]);
  return Object.entries(block)
    .filter(([name]) => !hidden.has(name))
    .slice(0, 14)
    .map(([name, value]) => ({ name: title(name), value: stringify(value) }));
}

function repetition(block: JsonObject) {
  if (block.for_each !== undefined) return `One component for each item in ${stringify(block.for_each, 180)}`;
  if (block.count !== undefined) return `Creates ${stringify(block.count, 180)} copies when its condition is met.`;
  return undefined;
}

function repeatedPattern(nodes: InfrastructureNode[], matcher: (node: InfrastructureNode) => boolean, name: string, description: string): InfrastructurePattern | null {
  const matching = nodes.filter(matcher);
  return matching.length > 1 ? { name, description, count: matching.length, nodeIds: matching.map((node) => node.id) } : null;
}

export async function analyzeTerraform({
  repository,
  branch,
  sourceRevision,
  rootPath,
  files,
  environments,
}: {
  repository: string;
  branch: string;
  sourceRevision: string;
  rootPath: string;
  files: TerraformFile[];
  environments: string[];
}): Promise<Omit<InfrastructureExplorerData, "deployment">> {
  const nodes: InfrastructureNode[] = [];
  const variables: InfrastructureVariable[] = [];
  const outputs: InfrastructureOutput[] = [];
  const providers = new Map<string, InfrastructureProvider>();
  const warnings: string[] = [];
  const sourceBase = `https://github.com/${repository}/blob/${branch}/${rootPath}`;

  for (const file of files) {
    let parsed: JsonObject;
    try {
      parsed = await parse(file.path, file.content) as JsonObject;
    } catch (error) {
      warnings.push(`${file.path} could not be parsed: ${error instanceof Error ? error.message : "Unknown parser error"}`);
      continue;
    }
    const fileLocations = locations(file.content);
    const scope = scopeForFile(file.path);
    const system = systemFor(file.path, scope);

    for (const kind of ["resource", "data"] as const) {
      const byType = (parsed[kind] ?? {}) as Record<string, Record<string, JsonObject[]>>;
      for (const [type, byName] of Object.entries(byType)) {
        for (const [name, definitions] of Object.entries(byName)) {
          const block = definitions[0] ?? {};
          const location = findLocation(fileLocations, kind, name, type);
          const address = kind === "data" ? `data.${type}.${name}` : `${type}.${name}`;
          const id = scope === "root" ? address : `${scope}::${address}`;
          nodes.push({
            id,
            address,
            name,
            type,
            kind,
            managed: kind === "resource",
            category: categoryFor(type, name),
            system,
            scope,
            provider: providerFor(type, kind),
            file: file.path,
            line: location?.line ?? 1,
            sourceUrl: `${sourceBase}/${file.path}${location ? `#L${location.line}` : ""}`,
            summary: plainSummary(kind, type, name, system),
            dependencies: [],
            dependents: [],
            variableReferences: references(block).variables,
            localReferences: references(block).locals,
            repetition: repetition(block),
            attributes: attributes(block),
            implementation: location?.implementation ?? stringify(block, 12_000),
          });
        }
      }
    }

    const moduleBlocks = (parsed.module ?? {}) as Record<string, JsonObject[]>;
    for (const [name, definitions] of Object.entries(moduleBlocks)) {
      const block = definitions[0] ?? {};
      const source = stringify(block.source);
      const location = findLocation(fileLocations, "module", name);
      const address = `module.${name}`;
      const id = scope === "root" ? address : `${scope}::${address}`;
      nodes.push({
        id,
        address,
        name,
        type: "module",
        kind: "module",
        managed: true,
        category: categoryFor("module", name, source),
        system,
        scope,
        provider: "module",
        file: file.path,
        line: location?.line ?? 1,
        sourceUrl: `${sourceBase}/${file.path}${location ? `#L${location.line}` : ""}`,
        summary: plainSummary("module", "module", name, system, source),
        source,
        version: moduleVersion(source) ?? (typeof block.version === "string" ? block.version : undefined),
        dependencies: [],
        dependents: [],
        variableReferences: references(block).variables,
        localReferences: references(block).locals,
        repetition: repetition(block),
        attributes: attributes(block),
        implementation: location?.implementation ?? stringify(block, 12_000),
      });
    }

    const variableBlocks = (parsed.variable ?? {}) as Record<string, JsonObject[]>;
    for (const [name, definitions] of Object.entries(variableBlocks)) {
      const block = definitions[0] ?? {};
      const location = findLocation(fileLocations, "variable", name);
      const sensitive = block.sensitive === true;
      variables.push({
        name: scope === "root" ? name : `${scope}.${name}`,
        description: typeof block.description === "string" ? block.description : null,
        type: stringify(block.type) || "any",
        defaultValue: sensitive ? "Sensitive value hidden" : block.default === undefined ? null : stringify(block.default),
        required: block.default === undefined,
        sensitive,
        file: file.path,
        line: location?.line ?? 1,
      });
    }

    const outputBlocks = (parsed.output ?? {}) as Record<string, JsonObject[]>;
    for (const [name, definitions] of Object.entries(outputBlocks)) {
      const block = definitions[0] ?? {};
      const location = findLocation(fileLocations, "output", name);
      outputs.push({
        name: scope === "root" ? name : `${scope}.${name}`,
        description: typeof block.description === "string" ? block.description : null,
        value: stringify(block.value),
        sensitive: block.sensitive === true,
        file: file.path,
        line: location?.line ?? 1,
      });
    }

    for (const terraformBlock of (parsed.terraform ?? []) as JsonObject[]) {
      for (const required of (terraformBlock.required_providers ?? []) as JsonObject[]) {
        for (const [name, definition] of Object.entries(required)) {
          const details = definition as JsonObject;
          providers.set(name, {
            name,
            source: typeof details.source === "string" ? details.source : null,
            version: typeof details.version === "string" ? details.version : null,
          });
        }
      }
    }
    for (const name of Object.keys((parsed.provider ?? {}) as JsonObject)) {
      if (!providers.has(name)) providers.set(name, { name, source: null, version: null });
    }
  }

  const byId = new Map(nodes.map((node) => [node.id, node]));
  const edges: InfrastructureEdge[] = [];
  const edgeIds = new Set<string>();

  for (const node of nodes) {
    const file = files.find((candidate) => candidate.path === node.file);
    if (!file) continue;
    let parsed: JsonObject;
    try {
      parsed = await parse(file.path, file.content) as JsonObject;
    } catch {
      continue;
    }
    let block: JsonObject | undefined;
    if (node.kind === "module") block = ((parsed.module as Record<string, JsonObject[]> | undefined)?.[node.name] ?? [])[0];
    else block = ((parsed[node.kind] as Record<string, Record<string, JsonObject[]>> | undefined)?.[node.type]?.[node.name] ?? [])[0];
    if (!block) continue;
    const refs = references(block).infrastructure;
    for (const reference of refs) {
      const targetId = node.scope === "root" ? reference : `${node.scope}::${reference}`;
      if (!byId.has(targetId) || targetId === node.id) continue;
      const edgeId = `${node.id}->${targetId}`;
      if (edgeIds.has(edgeId)) continue;
      edgeIds.add(edgeId);
      edges.push({ id: edgeId, source: node.id, target: targetId, relationship: "depends-on" });
      node.dependencies.push(targetId);
      byId.get(targetId)?.dependents.push(node.id);
    }
  }

  for (const node of nodes.filter((candidate) => candidate.kind === "module" && candidate.scope === "root" && candidate.source?.startsWith("./modules/"))) {
    const localName = node.source?.replace(/^\.\/modules\//, "").split("/")[0];
    const childScope = `module.${localName}`;
    for (const child of nodes.filter((candidate) => candidate.scope === childScope)) {
      const edgeId = `${node.id}=>${child.id}`;
      if (edgeIds.has(edgeId)) continue;
      edgeIds.add(edgeId);
      edges.push({ id: edgeId, source: node.id, target: child.id, relationship: "contains" });
    }
  }

  const rootNodes = nodes.filter((node) => node.scope === "root");
  const categories = CATEGORY_ORDER.map((name) => {
    const matching = rootNodes.filter((node) => node.category === name);
    return {
      name,
      count: matching.length,
      managed: matching.filter((node) => node.managed).length,
      referenced: matching.filter((node) => !node.managed).length,
    };
  }).filter((category) => category.count > 0);

  const systemMap = new Map<string, InfrastructureNode[]>();
  rootNodes.forEach((node) => systemMap.set(node.system, [...(systemMap.get(node.system) ?? []), node]));
  const systems = [...systemMap.entries()]
    .map(([name, members]) => ({
      name,
      count: members.length,
      summary: `${members.filter((node) => node.managed).length} managed components and ${members.filter((node) => !node.managed).length} existing references.`,
    }))
    .sort((a, b) => b.count - a.count);

  const patterns = [
    repeatedPattern(rootNodes, (node) => node.kind === "module" && /_db$/.test(node.name), "Per-service databases", "Multiple software factory services receive a dedicated managed relational database."),
    repeatedPattern(rootNodes, (node) => /kms/.test(node.name), "Dedicated encryption keys", "Services use separate encryption keys to limit the impact of key access and rotation."),
    repeatedPattern(rootNodes, (node) => /volume_snapshots?/.test(node.name), "Recurring volume snapshots", "Persistent service volumes follow a reusable backup pattern."),
    repeatedPattern(rootNodes, (node) => /irsa/.test(node.name), "Workload-specific AWS access", "Kubernetes workloads receive AWS permissions through dedicated service-account roles."),
    repeatedPattern(rootNodes, (node) => /s3_bucket/.test(node.name) && node.kind === "module", "Service object storage", "Stateful services use dedicated S3 buckets instead of sharing one storage boundary."),
  ].filter((pattern): pattern is InfrastructurePattern => Boolean(pattern));

  const databaseCount = rootNodes.filter((node) => node.kind === "module" && /_db$/.test(node.name)).length;
  const bucketCount = rootNodes.filter((node) => node.kind === "module" && /s3_bucket/.test(node.name)).length;
  const vpcCount = rootNodes.filter((node) => node.kind === "module" && /(^|_)vpc$/.test(node.name)).length;
  const summary = `This stack builds an AWS-hosted software factory around an EKS cluster and ${vpcCount || 2} network environments. It provisions ${databaseCount} service databases, ${bucketCount} dedicated object-storage modules, encrypted secrets and backups, administrative and build compute, GitLab runner capacity, and observability services. Existing account identity, images, certificates, licenses, and availability-zone information are referenced rather than created.`;

  const commonTags = [
    { name: "RootTFModule", value: "swf" },
    { name: "GithubRepo", value: `github.com/${repository}` },
    { name: "Environment", value: "Selected from var.stage" },
    { name: "Origin", value: "defenseunicorns/narwhal-delivery-iac-swf-reference-deployment" },
  ];

  return {
    repository,
    rootPath,
    branch,
    sourceRevision,
    sourceUrl: `https://github.com/${repository}/tree/${branch}/${rootPath}`,
    summary,
    generatedAt: new Date().toISOString(),
    metrics: {
      managed: rootNodes.filter((node) => node.managed).length,
      referenced: rootNodes.filter((node) => !node.managed).length,
      modules: rootNodes.filter((node) => node.kind === "module").length,
      relationships: edges.filter((edge) => edge.relationship === "depends-on").length,
      variables: variables.filter((variable) => !variable.name.startsWith("module.")).length,
      outputs: outputs.filter((output) => !output.name.startsWith("module.")).length,
      files: files.length,
      systems: systems.length,
    },
    categories,
    systems,
    nodes,
    edges,
    variables,
    outputs,
    providers: [...providers.values()].sort((a, b) => a.name.localeCompare(b.name)),
    environments,
    commonTags,
    patterns,
    warnings,
  };
}
