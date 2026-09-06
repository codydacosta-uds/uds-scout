# Repository security context

UDS Scout treats security as part of repository health. For eligible selected package repositories, the server progressively gathers public evidence and attaches the resulting context to the repository workspace and operational views.

## Coverage states

Security coverage is independent from vulnerability counts:

- **Full** — the relevant package/image evidence and sources were evaluated.
- **Partial** — some relevant evidence was evaluated, but a source or artifact was unavailable.
- **Unknown** — Scout identified a possible product or artifact but could not establish enough evidence.
- **Unavailable** — required public metadata, registry access, or an associated SBOM/advisory source was not available.

Unavailable evidence is not treated as zero vulnerabilities.

## Evidence and sources

Scout can use:

- Zarf package definitions and component metadata
- Package, chart, registry, repository, and release identity
- OCI manifests, immutable digests, referrers, and public registry metadata
- Public SBOMs and GitHub artifact attestations
- OSV, GitHub Global Security Advisories, NVD for verified application-product CPEs, and authoritative vendor advisories where available
- Public Defense Unicorns Registry metadata

Scout validates product identity conservatively. It keeps helpers, test fixtures, utility images, and ambiguous products as explicit container evidence rather than guessing an upstream application.

## Maintainer-facing decisions

The repository view should answer:

- Is the package or application version affected?
- Which package, flavor, image, or digest is affected?
- Is a fixed version available?
- Is there already an update pull request?
- Are its checks passing?
- What evidence supports the conclusion?

Application findings remain separate from container dependency findings. Critical and High upstream application findings lead the maintainer-facing decision. Container findings become operationally prominent when Scout can correlate them with an open update pull request.

Repeated package, image, and flavor occurrences are collapsed into unique CVE decisions while exact-image evidence remains available as supporting context.

## Refresh and credentials

Authoritative upstream application sources are refreshed while Scout is running. Expensive container inventory and dependency work uses longer-lived exact-digest evidence to avoid repeatedly rescanning unchanged images.

Security enrichment runs inside Scout and does not require Docker, Syft, Grype, Trivy, an external Scout service, or manually uploaded SBOMs. Scout uses public Defense Unicorns Registry metadata and does not request or store private-registry credentials.

The feature supplements package-level security decisions. It does not replace enterprise vulnerability management, runtime security monitoring, or maintainer judgment.
