---
name: security-intelligence-enrichment
description: Audits and strengthens UDS Scout CVE, application identity, advisory-source, SBOM, OCI, package/flavor, and security coverage for newly selected or existing repositories. Use when a user adds repositories, asks to improve or verify CVE/security data, reports unknown application coverage, requests a new product/vendor integration, or wants confidence that package security intelligence is accurate.
compatibility: Requires a running UDS Scout instance plus network and GitHub access for live repository/advisory validation. Private package and image validation may require the server-side registry credentials documented by Scout.
---

# Security Intelligence Enrichment

Use this workflow whenever selected repositories or shipped products change. A user should only select repositories; product intelligence belongs in Scout and must be reusable across repositories, flavors, and users.

Read `AGENTS.md` and [references/research-guide.md](references/research-guide.md) before changing code.

## Safety and accuracy rules

- Never hardcode CVE IDs, findings, severities, fixed versions, or current application versions.
- Product profiles are reusable coordinates, never repository allowlists.
- Prefer an explicit identity or source gap over a guessed product, guessed CPE, or false zero.
- Keep direct application advisories separate from container dependency findings.
- Treat each same-CVE package/flavor occurrence as evidence, but use unique CVEs for maintainer-level summaries.
- Keep GitHub and registry credentials server-only. Send Defense Unicorns registry credentials only to `registry.defenseunicorns.com`.
- Do not require a scanner, worker, database, CI job, Docker, manual SBOM upload, or additional service.
- Do not make GitHub mutations.

## Initial audit

From the repository root, with Scout running on `127.0.0.1:3001`:

```bash
node .pi/skills/security-intelligence-enrichment/scripts/audit-security-coverage.mjs
```

Use `--refresh` only when the user requested fresh data or after changing identity/advisory behavior:

```bash
node .pi/skills/security-intelligence-enrichment/scripts/audit-security-coverage.mjs --refresh
```

Record for every selected repository:

1. Zarf package applicability and source revision.
2. Canonical applications and versions by flavor.
3. Unidentified or merely probable applications.
4. Full, partial, unknown, and missing direct-advisory sources.
5. Full, partial, and unavailable image inventories.
6. Unique direct CVEs versus dependency occurrences.
7. Resolution errors, stale data, and provider failures.

Adding and removing selected repositories must work without code changes. Removed repositories may remain in the private local cache but must not be returned, refreshed, summarized, or rendered.

## Repository and product discovery

For each gap, inspect the current default-branch source through GitHub rather than relying only on cache data:

1. Find every YAML document containing a valid `ZarfPackageConfig`, regardless of path or filename.
2. Inventory package names, descriptions, upstream URLs, components, flavors, charts, chart versions, and image references.
3. Separate primary applications from helpers, init containers, exporters, CLIs, test fixtures, and base images.
4. Group images that ship one product version. For example, controller/webhook images may represent one cert-manager release, while a database sidecar may be a separate product.
5. Compare flavor versions independently; do not collapse different shipped versions.
6. Confirm versions against chart `appVersion`, image tags, OCI labels, release metadata, and upstream releases. Preserve the shipped version in the UI while normalizing packaging suffixes only for advisory matching.

## Identity resolution

Use this precedence:

1. SBOM PURL/CPE and authoritative product metadata associated with the exact artifact digest.
2. OCI source/revision/version labels from the exact image.
3. Zarf package upstream URL and chart metadata.
4. Conservative reusable product profile in `lib/security-products.ts`.
5. Probable display identity with explicit unknown direct-advisory coverage.

A product profile may define canonical name, conservative image/chart patterns, upstream repository, PURL, CPE, and expected vendor sources. Verify every coordinate against an authoritative source and at least one live current artifact. One profile must cover the product across repositories and flavors.

Do not add a profile merely to suppress an unknown state. Utility images should remain container evidence unless they are independently maintained applications requiring a direct-product decision.

## Advisory enrichment

Attempt generic sources before writing a custom adapter:

1. OSV using a verified PURL and normalized product version.
2. GitHub global advisories for supported package ecosystems.
3. Published GitHub repository security advisories for a verified upstream repository and valid affected-version ranges.
4. NVD using a verified CPE vendor/product and version-range evaluation.
5. Authoritative vendor data when generic coordinates cannot establish complete product coverage.

Create a vendor adapter only when necessary. It must:

- Consume an authoritative, stable source.
- Parse affected and fixed ranges rather than matching advisory text.
- Link findings to the authoritative advisory section.
- Cache requests and honor source rate limits.
- Normalize aliases and deduplicate CVE/GHSA/OSV identities.
- Report provider failure or unavailable coverage explicitly.
- Include fixtures or repeatable live validation for range edge cases.

Never treat NVD alone as complete for a vendor-managed commercial product when the vendor publishes its own authoritative advisories.

## SBOM and container coverage

For every image and flavor, verify digest-first resolution and try the existing bounded resolver chain:

1. OCI referrers.
2. GitHub attestations.
3. Repository or release SBOM assets.
4. Published Zarf package `sboms.tar` inventories.
5. Exact-reference private Defense Unicorns Registry inventory fallback.

Confirm that any fallback remains partial when Scout cannot independently resolve the image digest. Inspect failures by host and reason without printing credentials or returning them to the browser.

## Implementation discipline

- Put reusable product definitions in `lib/security-products.ts`.
- Put generic and vendor advisory adapters in `lib/security-advisories.ts` or a focused provider module when large.
- Keep normalized browser contracts in `components/security-types.ts`.
- When identity or advisory semantics change, increment `SECURITY_ANALYSIS_VERSION` and `SERVICE_IMPLEMENTATION_VERSION` in `lib/security-service.ts` so selected repositories refresh while digest inventories remain cached.
- Keep refresh bounded, asynchronous, persistent, and non-blocking.
- Update all global, repository, drawer, loading, empty, partial-error, and stale-data views when contracts change.
- Add a concise `CHANGELOG.md` entry under **Unreleased**.

## Validation

After implementation:

```bash
npm run lint
npx tsc --noEmit --pretty false
npm run build
git diff --check
node .pi/skills/security-intelligence-enrichment/scripts/audit-security-coverage.mjs --refresh
```

Wait for selected repositories to finish refreshing, then rerun the audit without `--refresh`. Verify:

1. Every selected repository is present exactly once and excluded repositories remain absent.
2. Primary product grouping is plausible and support images do not inflate application counts.
3. Every `full` application has all expected providers checked.
4. Every missing coordinate, vendor source, SBOM, digest, or credential is an explicit gap.
5. At least one known affected and one known unaffected version boundary is validated for each new provider.
6. Findings use live advisory data and include authoritative links and fixed versions when published.
7. Update PR correlation uses the actual proposed version and current checks/review state.
8. Global and repository Security views remain usable at desktop and narrow widths.
9. A repository can be removed and re-added without stale summaries, duplicate applications, or leaked cached data.

## Reporting

Tell the user:

- Repositories and source revisions evaluated.
- Products newly identified or regrouped.
- Generic and vendor sources checked.
- Direct-CVE and container-inventory coverage gained.
- Remaining gaps and why they cannot be inferred safely.
- Validation performed and any provider rate-limit delay.
