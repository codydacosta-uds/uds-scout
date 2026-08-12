import "server-only";

export type SecurityProductProfile = {
  id: string;
  name: string;
  aliases: RegExp[];
  imageRepositories: RegExp[];
  upstreamRepository: string;
  purl?: string;
  cpe?: { vendor: string; product: string };
  expectedAdvisorySources?: string[];
  applicationVersionPattern?: RegExp;
  githubRepositoryAdvisories?: boolean;
};

// Product profiles are reusable application coordinates, not repository allowlists.
// Keep matches conservative: an incorrect direct-product match is worse than an
// explicit coverage gap. Supporting images should only be included when they ship
// the same product version and should otherwise remain container evidence.
export const SECURITY_PRODUCT_PROFILES: SecurityProductProfile[] = [
  {
    id: "jenkins", name: "Jenkins", aliases: [/^jenkins$/],
    imageRepositories: [/(?:^|\/)jenkins\/jenkins$/, /(?:^|\/)defenseunicorns\.com\/jenkins$/],
    upstreamRepository: "jenkinsci/jenkins", cpe: { vendor: "jenkins", product: "jenkins" },
    expectedAdvisorySources: ["Jenkins Security Advisory"],
  },
  {
    id: "jfrog-artifactory", name: "JFrog Artifactory", aliases: [/^artifactory$/],
    imageRepositories: [/(?:^|\/)artifactory(?:-pro)?$/], upstreamRepository: "jfrog/artifactory-oss",
    cpe: { vendor: "jfrog", product: "artifactory" }, expectedAdvisorySources: ["JFrog Security Advisory"], githubRepositoryAdvisories: false,
  },
  {
    id: "jfrog-xray", name: "JFrog Xray", aliases: [/^xray$/],
    imageRepositories: [/(?:^|\/)(?:jfrog-)?xray-(?:analysis|indexer|persist|policyenforcer|server)$/],
    upstreamRepository: "jfrog/jfrog-xray", expectedAdvisorySources: ["JFrog Security Advisory"], githubRepositoryAdvisories: false,
  },
  {
    id: "jira", name: "Jira Software", aliases: [/^jira$/],
    imageRepositories: [/(?:^|\/)jira-software$/, /(?:^|\/)jira-node$/], upstreamRepository: "atlassian/jira",
    cpe: { vendor: "atlassian", product: "jira" }, expectedAdvisorySources: ["Atlassian Security Advisory"], githubRepositoryAdvisories: false,
  },
  {
    id: "confluence", name: "Confluence", aliases: [/^confluence$/],
    imageRepositories: [/(?:^|\/)confluence$/, /(?:^|\/)confluence-node$/], upstreamRepository: "atlassian/confluence",
    cpe: { vendor: "atlassian", product: "confluence_server" }, expectedAdvisorySources: ["Atlassian Security Advisory"], githubRepositoryAdvisories: false,
  },
  {
    id: "gitlab", name: "GitLab", aliases: [/^gitlab$/],
    imageRepositories: [
      /(?:^|\/)gitlab-(?:ce|ee)$/,
      /(?:^|\/)gitlab$/,
      /(?:^|\/)(?:gitaly|gitlab-(?:base|container-registry|exporter|pages|shell|sidekiq(?:-ee)?|toolbox(?:-ee)?|webservice(?:-ee)?|workhorse(?:-ee)?))$/,
    ],
    upstreamRepository: "gitlab-org/gitlab", cpe: { vendor: "gitlab", product: "gitlab" },
    expectedAdvisorySources: ["GitLab Security Release"], githubRepositoryAdvisories: false,
  },
  {
    id: "gitlab-runner", name: "GitLab Runner", aliases: [/^gitlab-runner$/],
    imageRepositories: [/(?:^|\/)gitlab-runner(?:-ocp)?$/, /(?:^|\/)gitlab-runner-helper(?:-ocp)?$/],
    upstreamRepository: "gitlab-org/gitlab-runner", cpe: { vendor: "gitlab", product: "runner" },
    expectedAdvisorySources: ["GitLab Security Release"], githubRepositoryAdvisories: false,
  },
  {
    id: "cert-manager", name: "cert-manager", aliases: [/^cert-manager$/],
    imageRepositories: [/(?:^|\/)cert-manager-(?:acmesolver|cainjector|controller|webhook)(?:-fips)?$/],
    upstreamRepository: "cert-manager/cert-manager", purl: "pkg:golang/github.com/cert-manager/cert-manager",
  },
  {
    id: "podinfo", name: "Podinfo", aliases: [/^podinfo$/], imageRepositories: [/(?:^|\/)podinfo$/],
    upstreamRepository: "stefanprodan/podinfo", purl: "pkg:golang/github.com/stefanprodan/podinfo",
  },
  {
    id: "vault-kubernetes", name: "Vault Kubernetes", aliases: [/^vault-k8s$/], imageRepositories: [/(?:^|\/)vault-k8s(?:-fips)?$/],
    upstreamRepository: "hashicorp/vault-k8s", purl: "pkg:golang/github.com/hashicorp/vault-k8s",
    expectedAdvisorySources: ["HashiCorp Security Bulletin"],
  },
  {
    id: "vault-csi-provider", name: "Vault CSI Provider", aliases: [/^vault-csi-provider$/], imageRepositories: [/(?:^|\/)vault-csi-provider(?:-fips)?$/],
    upstreamRepository: "hashicorp/vault-csi-provider", purl: "pkg:golang/github.com/hashicorp/vault-csi-provider",
    expectedAdvisorySources: ["HashiCorp Security Bulletin"],
  },
  {
    id: "vault", name: "HashiCorp Vault", aliases: [/^vault$/], imageRepositories: [/(?:^|\/)vault(?:-fips)?$/],
    upstreamRepository: "hashicorp/vault", purl: "pkg:golang/github.com/hashicorp/vault",
    cpe: { vendor: "hashicorp", product: "vault" }, expectedAdvisorySources: ["HashiCorp Security Bulletin"],
  },
  {
    id: "sonarqube", name: "SonarQube", aliases: [/^sonarqube$/],
    imageRepositories: [/(?:^|\/)sonarqube(?:-community-build)?$/], upstreamRepository: "SonarSource/sonarqube",
    cpe: { vendor: "sonarsource", product: "sonarqube" }, expectedAdvisorySources: ["Sonar Security Advisory"],
  },
  {
    id: "tak-server", name: "TAK Server", aliases: [/^takserver$/, /^tak-server$/], imageRepositories: [/(?:^|\/)tak-server$/],
    upstreamRepository: "TAK-Product-Center/Server", expectedAdvisorySources: ["TAK Product Center Security Advisory"],
  },
  {
    id: "mattermost", name: "Mattermost", aliases: [/^mattermost$/],
    imageRepositories: [/(?:^|\/)mattermost(?:-enterprise-edition)?$/], upstreamRepository: "mattermost/mattermost",
    cpe: { vendor: "mattermost", product: "server" },
    expectedAdvisorySources: ["Mattermost Security Update"],
  },
  {
    id: "minio-operator", name: "MinIO Operator", aliases: [/^minio-operator$/],
    imageRepositories: [/(?:^|\/)(?:minio-)?operator(?:-sidecar)?$/], upstreamRepository: "minio/operator",
    purl: "pkg:golang/github.com/minio/operator",
  },
  {
    id: "minio", name: "MinIO", aliases: [/^minio$/], imageRepositories: [/(?:^|\/)minio(?:-fips)?$/],
    upstreamRepository: "minio/minio", purl: "pkg:golang/github.com/minio/minio", cpe: { vendor: "minio", product: "minio" },
    expectedAdvisorySources: ["MinIO Security Advisory"], applicationVersionPattern: /^RELEASE[.-]\d/i,
  },
  {
    id: "metallb", name: "MetalLB", aliases: [/^metallb$/],
    imageRepositories: [/(?:^|\/)(?:metallb-)?(?:controller|speaker)$/], upstreamRepository: "metallb/metallb",
    purl: "pkg:golang/go.universe.tf/metallb",
  },
  {
    id: "valkey", name: "Valkey", aliases: [/^valkey$/],
    imageRepositories: [/(?:^|\/)valkey(?:-iamguarded)?$/, /(?:^|\/)valkey-sentinel(?:-iamguarded)?$/],
    upstreamRepository: "valkey-io/valkey", cpe: { vendor: "lfprojects", product: "valkey" },
    expectedAdvisorySources: ["Valkey Security Advisory"],
  },
  {
    id: "renovate", name: "Renovate", aliases: [/^renovate$/], imageRepositories: [/(?:^|\/)renovate(?:-fips)?$/],
    upstreamRepository: "renovatebot/renovate", purl: "pkg:npm/renovate",
  },
  {
    id: "keycloak", name: "Keycloak", aliases: [/^keycloak$/], imageRepositories: [/(?:^|\/)keycloak(?:-fips)?$/],
    upstreamRepository: "keycloak/keycloak", purl: "pkg:maven/org.keycloak/keycloak-core",
    cpe: { vendor: "redhat", product: "keycloak" }, expectedAdvisorySources: ["Red Hat Security Data"],
  },
  { id: "grafana", name: "Grafana", aliases: [/^grafana$/], imageRepositories: [/(?:^|\/)grafana(?:-fips)?$/], upstreamRepository: "grafana/grafana", purl: "pkg:golang/github.com/grafana/grafana" },
  { id: "loki", name: "Loki", aliases: [/^loki$/], imageRepositories: [/(?:^|\/)loki(?:-fips)?$/], upstreamRepository: "grafana/loki", purl: "pkg:golang/github.com/grafana/loki" },
  { id: "prometheus", name: "Prometheus", aliases: [/^prometheus$/], imageRepositories: [/(?:^|\/)prometheus(?:-fips)?$/], upstreamRepository: "prometheus/prometheus", purl: "pkg:golang/github.com/prometheus/prometheus" },
  { id: "alertmanager", name: "Alertmanager", aliases: [/^alertmanager$/], imageRepositories: [/(?:^|\/)alertmanager(?:-fips)?$/], upstreamRepository: "prometheus/alertmanager", purl: "pkg:golang/github.com/prometheus/alertmanager" },
  { id: "velero", name: "Velero", aliases: [/^velero$/], imageRepositories: [/(?:^|\/)velero(?:-fips)?$/], upstreamRepository: "vmware-tanzu/velero", purl: "pkg:golang/github.com/vmware-tanzu/velero" },
  { id: "istio", name: "Istio", aliases: [/^istio(?:-controlplane)?$/], imageRepositories: [/(?:\/|^)(?:pilot|proxyv2|istio-(?:pilot|proxy)-fips)$/], upstreamRepository: "istio/istio", purl: "pkg:golang/istio.io/istio" },
  { id: "falco", name: "Falco", aliases: [/^falco$/], imageRepositories: [/(?:^|\/)falco(?:-fips)?$/], upstreamRepository: "falcosecurity/falco" },
  { id: "vector", name: "Vector", aliases: [/^vector$/], imageRepositories: [/(?:^|\/)vector(?:-fips)?$/], upstreamRepository: "vectordotdev/vector" },
  { id: "metrics-server", name: "Metrics Server", aliases: [/^metrics-server$/], imageRepositories: [/(?:^|\/)metrics-server(?:-fips)?$/], upstreamRepository: "kubernetes-sigs/metrics-server", purl: "pkg:golang/sigs.k8s.io/metrics-server" },
  { id: "envoy-gateway", name: "Envoy Gateway", aliases: [/^envoy-gateway$/], imageRepositories: [/(?:^|\/)envoy-gateway(?:-fips)?$/], upstreamRepository: "envoyproxy/gateway", purl: "pkg:golang/github.com/envoyproxy/gateway" },
  { id: "authservice", name: "Authservice", aliases: [/^authservice$/], imageRepositories: [/(?:^|\/)authservice(?:-fips)?$/], upstreamRepository: "istio-ecosystem/authservice", purl: "pkg:golang/github.com/istio-ecosystem/authservice" },
  { id: "uds-portal", name: "UDS Portal", aliases: [/^(?:uds-)?portal$/], imageRepositories: [/(?:^|\/)uds-portal$/], upstreamRepository: "defenseunicorns/uds-portal" },
];

export function expectedAdvisorySources(productName: string) {
  return SECURITY_PRODUCT_PROFILES.find((profile) => profile.name === productName)?.expectedAdvisorySources ?? [];
}

export function supportsGithubRepositoryAdvisories(productName: string) {
  return SECURITY_PRODUCT_PROFILES.find((profile) => profile.name === productName)?.githubRepositoryAdvisories !== false;
}

export function normalizeAdvisoryVersion(value: string) {
  return value
    .replace(/^alpine-v(?=\d)/i, "")
    .replace(/^v(?=\d)/i, "")
    .replace(/-(?:jdk|java)\d+(?:[-.].*)?$/i, "")
    .replace(/-(?:jammy|debian|alpine|ubi\d*)(?:[-.].*)?$/i, "")
    .replace(/-(?:fips|distroless|full|community)(?:[-.].*)?$/i, "")
    .replace(/-rfcurated$/i, "")
    .replace(/-r\d+$/i, "");
}
