# Product and advisory research guide

Use this guide to create evidence-backed, reusable Scout security coverage.

## Product evidence worksheet

Record the following without secrets:

```text
Canonical product:
Maintainer/vendor:
Current upstream repository:
Zarf package/component/flavors:
Primary images:
Supporting images:
Shipped versions by flavor:
Chart name/version/appVersion:
OCI source/version/revision labels:
SBOM product package/PURL/CPE:
Verified PURL:
Verified CPE vendor/product:
Authoritative advisory source:
Generic advisory sources supported:
Affected-version test case:
Unaffected-version boundary:
Fixed-version source:
Known limitations:
```

## Identity checks

A reliable identity should agree across at least two strong signals when possible:

- Exact image repository owned by the upstream vendor/project.
- OCI `org.opencontainers.image.source` and version labels.
- Exact-digest SBOM metadata with product package coordinates.
- Zarf package upstream URL and chart `appVersion`.
- Official upstream release artifact or documentation.

Mirrored paths may contain vendor/product names but are not independently authoritative. Confirm Registry1, Chainguard, and curated mirror names against the upstream image before creating a profile.

## Coordinate validation

### PURL

- Confirm ecosystem and package/module name from the upstream package manifest or SBOM.
- Do not invent PURLs for products without a supported package ecosystem.
- Verify that OSV or GitHub uses the same package name and version scheme.
- Inspect OSV `ecosystem_specific.custom_ranges`; an unbounded generated `SEMVER` range can otherwise return a newer version as a false positive even when the custom range has an older fixed boundary.
- Account for Go module major-version suffixes and non-semver release tags.

### CPE

- Confirm vendor and product in the NVD CPE dictionary.
- Check current and historical names; do not select a similarly named plugin or unrelated product.
- Validate that NVD configurations actually use the coordinate and independently evaluate matching `cpeMatch` start/end boundaries for the installed version. A vendor/product API match alone does not prove the version is affected.
- Ensure packaging suffixes are removed only for the advisory query, not from the shipped-version display. Reject mirror or distribution package versions that cannot be mapped safely to an upstream product version.
- NVD success with zero matches is not proof of complete vendor coverage.

### Upstream repository

- Confirm it is the product source, not only a chart, mirror, package wrapper, or deployment configuration repository.
- Check whether published repository security advisories use ranges that can be evaluated against the shipped version.
- A 404 or inaccessible advisory endpoint is a provider gap, not a clean result.

## Application grouping checks

Group images when they are release-coupled parts of one product and receive the same direct product advisory, such as service-role images from one GitLab release. Keep separate applications when they have independent release/advisory lifecycles, such as Vault, Vault Kubernetes, and Vault CSI Provider.

Do not create direct applications for:

- Base OS images
- Shell/curl/kubectl utilities
- Init-only certificate helpers
- Exporters maintained as separate dependencies unless the repository owns their update decision
- Test fixtures and example workloads
- Package-build helper images

These remain visible through container dependency evidence.

## Advisory-source quality

Preferred order:

1. Vendor/project structured advisory API or repository.
2. Official vendor security bulletin with structured affected/fixed ranges.
3. GitHub repository security advisories maintained by the product owner.
4. OSV/GitHub global package advisories.
5. NVD as a baseline and alias/reference source.

Reject or mark partial when a source requires guessing from prose, search-result snippets, dates, or repository-name similarity.

## Range test matrix

For every adapter, test:

- Exact vulnerable version
- Version immediately before fixed
- Exact fixed version
- Version immediately after fixed
- Parallel supported release lines when applicable
- Prerelease and vendor packaging suffixes
- Unknown/non-semver versions
- Withdrawn/rejected advisories
- Multiple advisories sharing CVE/GHSA/OSV aliases

## Coverage interpretation

- `full`: every provider expected for that identified product completed for the version.
- `partial`: at least one reliable provider completed, but an expected provider, digest association, or package coordinate remains missing.
- `unknown`: no reliable direct-product advisory coordinate/provider completed, or identity/version is not established.
- `unavailable` container coverage: no trustworthy inventory could be associated with the image.

Never translate partial or unknown coverage into “0 vulnerabilities.”
