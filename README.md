# UDS Scout

[![CI](https://github.com/codydacosta-uds/uds-scout/actions/workflows/ci.yml/badge.svg)](https://github.com/codydacosta-uds/uds-scout/actions/workflows/ci.yml)
[![Security checks](https://github.com/codydacosta-uds/uds-scout/actions/workflows/security.yml/badge.svg)](https://github.com/codydacosta-uds/uds-scout/actions/workflows/security.yml)
[![Container security](https://github.com/codydacosta-uds/uds-scout/actions/workflows/container-security.yml/badge.svg)](https://github.com/codydacosta-uds/uds-scout/actions/workflows/container-security.yml)
[![Browser smoke tests](https://github.com/codydacosta-uds/uds-scout/actions/workflows/e2e.yml/badge.svg)](https://github.com/codydacosta-uds/uds-scout/actions/workflows/e2e.yml)
[![OpenSSF Scorecard](https://github.com/codydacosta-uds/uds-scout/actions/workflows/scorecard.yml/badge.svg)](https://github.com/codydacosta-uds/uds-scout/actions/workflows/scorecard.yml)
[![Policy coverage](./public/coverage.svg)](#validation-and-security-checks)

UDS Scout is a local-first engineering console for actionable operational visibility across a small, explicitly selected set of repositories. It brings review work, dependency updates, issues, pipeline failures, version alignment, infrastructure knowledge, and package-focused security context into one focused interface.

See [CHANGELOG.md](CHANGELOG.md) for released and upcoming user-facing changes.

The current release uses GitHub as the primary repository dashboard. GitLab is an optional integration for assigned work items and explicitly confirmed ticket creation; a separate full GitLab operations dashboard is planned rather than mixing providers into one view.

## Supporting UDS package maintainers

UDS Scout is designed to reduce the day-to-day toil of maintaining packages across multiple repositories. Instead of repeatedly opening each repository to reconstruct review state, pipeline health, dependency updates, ownership, and version alignment, maintainers get one prioritized queue built from the repositories they explicitly selected.

Scout helps maintainers:

- Start with work that needs a decision or handoff rather than manually checking every repository, with concise first-run guidance toward **My work today**, warning states, and focused Renovate review.
- Distinguish routine Renovate updates from dependency changes with failures, conflicts, direct requests, or other observable blockers.
- Find failed default-branch pipelines and checks blocking pull requests without searching across workflow pages.
- Track UDS Core and UDS Common alignment without manually comparing every package configuration.
- Keep detailed investigation in GitHub, GitLab, or the underlying tools while Scout handles collection, normalization, prioritization, and safe handoffs.

Scout does not replace maintainer judgment or silently mutate repositories. It aims to prevent repetitive status-gathering and coordination work so maintainers can spend more time reviewing, testing, and improving UDS packages.

## What UDS Scout can do

### Repository operations

- Monitor up to 25 explicitly selected GitHub repositories without expanding to every repository visible to the token.
- Build a personalized **My work today** queue from review requests, assignments, blockers, merge-ready pull requests, authored work waiting on others, unowned human pull requests, and assigned issues.
- Show pull request authors, assignees, requested reviewers, approvals, required checks, mergeability, conflicts, blockers, and who the work is waiting on.
- Summarize review requests, assignments, approvals, merges, pipeline failures, recoveries, and assigned issues in a concise **Since yesterday** briefing.
- Provide dedicated pull request, Renovate, repository, issue, and pipeline views with contextual right-side drawers.
- Refresh operational data every 60 seconds and on page load while retaining cached content during navigation and transient refresh failures.

### Pipelines and dependency updates

- Detect unresolved GitHub Actions failures across selected repositories.
- Prioritize default-branch failures and failures known to block an open pull request.
- Show failed jobs and steps when GitHub provides them, while leaving full logs in GitHub.
- Open failed pull-request checks in a controlled drawer with exact run links and a browser-local, checkable next-step queue for resuming investigation.
- Identify Renovate pull requests only when Renovate authored them from a `renovate/*` source branch.
- Separate routine Renovate updates from updates with observable blockers, direct requests, conflicts, failed required checks, or configured priority labels.
- Provide an operator-configurable weekly Renovate review table focused by default on failed or cancelled updates and major-version changes, with additional pipeline filters and a browser-local show/hide override for the current day.

### UDS and repository health

- Compare the UDS Core version configured by SONIC with the latest `defenseunicorns/uds-core` release using semantic versioning.
- Inspect root `tasks.yaml` files for UDS Common includes and identify current, outdated, missing, or unverifiable configurations.
- Show current Zarf, Pepr, and UDS CLI releases.
- Browse the UDS Packages organization through a searchable, sortable, paginated catalog with contributor totals.

### Security Intelligence

For every eligible tracked package repository, Scout progressively checks for valid Zarf package definitions by content rather than filename. The SONIC infrastructure/deployment repository is intentionally excluded from Security Intelligence. When package metadata is available, Scout can:

- Keep application findings separate from container dependency findings.
- Normalize package, component, flavor, image tag, and immutable OCI digest relationships internally without turning package flavors into separate maintainer queues.
- Identify upstream products conservatively from Zarf metadata, chart URLs, official GHCR ownership, image names, and reusable product profiles, while keeping helpers, test fixtures, and utility images as container evidence.
- Query OSV, GitHub Global and upstream-repository Security Advisories, NVD for verified application-product CPEs with local affected-range validation, and authoritative vendor feeds such as Jenkins advisories and GitLab patch releases where available.
- Inspect OCI referrers, GitHub artifact attestations, repository/release assets, published UDS Zarf OCI packages, and the public Defense Unicorns Registry catalog for remotely available SBOMs and vulnerability reports.
- Parse associated dependency inventories and classify container OS, language, and other findings.
- Lead with Critical and High upstream application decisions: affected version, fixed version, matching update pull request, and check state.
- Collapse repeated package, image, and flavor occurrences into unique CVE decisions; keep lower-severity and exact-image evidence available as secondary context.
- Elevate container dependency findings into the default queue only when Scout can correlate a Critical or High CVE with an open update pull request.
- Show full, partial, unknown, or unavailable visibility independently from finding totals.

Adding or removing a tracked repository requires no repository-specific security configuration. Scout automatically attempts to establish the upstream from package, chart, registry, and SBOM evidence. An unfamiliar or ambiguous product may still require one reusable Scout product profile or vendor adapter; until then Scout keeps its upstream identity or advisory-source gap explicit rather than guessing.

Authoritative upstream application sources are rechecked every 15 minutes while Scout is running. Expensive container inventory and dependency work remains on a longer cycle and reuses exact-digest evidence, so faster upstream awareness does not repeatedly rescan every image.

Security enrichment runs inside Scout with bounded concurrency and never requires Docker, Syft, Grype, Trivy, CI changes, an external Scout service, or manually uploaded SBOMs. When a registry requires unavailable credentials or no associated remote SBOM exists, Scout says coverage is unavailable instead of reporting zero vulnerabilities. Scout reports known remotely observable posture for maintainers; it does not replace enterprise or runtime security platforms.

### Infrastructure Explorer

When `nswccd-devsecops/sonic-swf-iac` is selected, the Infrastructure Explorer can:

- Present SONIC Terraform as a plain-English inventory instead of a raw HCL browser.
- Explain resource purpose, ownership, system, environments, inputs, outputs, and upstream/downstream relationships.
- Derive dependencies from parsed references rather than file proximity.
- Separate top-level deployed components, existing data references, and reusable local-module internals.
- Expose Terraform addresses, implementation details, and source links only when deeper inspection is needed.

### Optional GitLab integration

When a GitLab token is connected, UDS Scout can:

- Select explicit GitLab projects for assigned work-item visibility.
- Show open work assigned to the connected user, including project, type, custom workflow status, labels, due date, and confidentiality state.
- Link to the corresponding filtered GitLab work-item board.
- Stage up to 20 issue drafts locally and review the complete batch before anything is created.
- Submit a confirmed batch to exactly one selected project after revalidating Developer access and selected labels.
- Report each issue creation result without automatic retries.

GitLab is not yet a second repository-operations dashboard in this release. GitHub and GitLab data are not presented as a merged provider workspace.

## Safety and data boundaries

- GitHub access is limited to the configured repository selection. The only GitHub mutation is an explicitly confirmed re-run of a selected failed job or workflow.
- GitLab writes are limited to the staged, reviewed, and explicitly confirmed ticket-composer workflow.
- GitHub and GitLab tokens are read only by Next.js server code and are never returned in browser API responses.
- Tokens entered during setup remain in server memory for the current process; environment tokens remain outside persisted Scout settings.
- Only non-secret workspace preferences and normalized repository security cache data are stored locally.
- No database, webhook service, background worker, scanner installation, or application authentication system is required.
- Test Lab is not enabled or exposed in this release.
- The development server binds to `127.0.0.1`. Docker binds to `0.0.0.0` only inside the container and is published on `127.0.0.1` by the documented command.

## Technology

- Next.js 16 and React 19
- TypeScript
- AWS Cloudscape Design System
- GitHub REST and GraphQL APIs
- GitLab REST and GraphQL APIs
- Local in-memory request caching and an atomic on-disk security enrichment cache
- OSV, GitHub Global Security Advisories, OCI Distribution APIs, OCI referrers, and GitHub artifact attestations
- SPDX JSON, CycloneDX JSON, and Syft JSON normalization
- Terraform parsing with CDK for Terraform HCL-to-JSON tooling

## Run locally

### Prerequisites

- Node.js 22 recommended
- npm
- A GitHub token with read access to the repositories you intend to select
- Optional: Actions write permission on repositories where Scout should re-run failed jobs or workflows
- Organization authorization for the token when a selected repository enforces SSO
- Optional: a GitLab token for selected-project work items and ticket creation
- Optional: [Task](https://taskfile.dev/) (`brew install go-task` on macOS)

### Start with Task

```bash
task start
```

`task start` installs dependencies when needed, loads the shell environment from `~/.zshrc`, and starts UDS Scout on [http://127.0.0.1:3001](http://127.0.0.1:3001).

### Start with npm

```bash
npm install
npm run dev
```

The development server uses `127.0.0.1:3001`.

### Configure the workspace

On first boot:

1. Connect or confirm the required GitHub token.
2. Optionally connect GitLab.
3. Select the GitHub repositories Scout should monitor.
4. If GitLab is connected, select the GitLab projects used for assigned work items and choose an optional default ticket project.
5. Save the workspace and continue to the dashboard.

GitHub and GitLab credentials entered during setup are validated by the server and retained only for the current app process. GitLab remains optional even when `GITLAB_TOKEN` is present: setup and Workspace settings can disable GitLab for the current GitHub workspace without removing the server environment variable. Security Intelligence uses public Defense Unicorns Registry metadata and does not request or store private-registry credentials. Non-secret selections are stored with local-user permissions at:

```text
~/.config/uds-scout/settings.json
```

Existing `~/.config/d2d-operations/settings.json` settings continue to load when the new path does not yet exist. Use **Workspace settings** to manage connections and selections or **Run setup again** to replay setup without clearing the active workspace before a replacement selection is saved.

Repository quick-select groups are defined in [`config/repository-groups.json`](config/repository-groups.json) as a group name and a list of `owner/repository` values. Configured groups are read-only in Scout and are merged with any user-created groups saved in workspace settings. Restart or rebuild Scout after changing the repository config.

```json
{
  "Package maintainers": [
    "example/package-one",
    "example/package-two"
  ]
}
```

You can also copy `.env.local.example` to `.env.local`. Never commit `.env.local` or another file containing real credentials.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `GITHUB_TOKEN` | Yes, unless entered during setup | Server-only GitHub API token |
| `GH_TOKEN` | No | Fallback GitHub token name |
| `NVD_API_KEY` | No | Optional server-only NVD API key for faster application-product advisory refreshes; the rate-limited public API works without it |
| `GITLAB_TOKEN` | No | Server-only GitLab API token |
| `GITLAB_URL` | No | GitLab origin; defaults to `https://gitlab.sonic.mil` |
| `GITHUB_REPOSITORIES` | No | Comma-separated repository override that takes precedence over the saved selection |
| `UDS_SCOUT_SETTINGS_PATH` | No | Alternate location for non-secret local settings |
| `UDS_SCOUT_SECURITY_PATH` | No | Alternate location for the non-secret local security cache; defaults beside settings |

## Run with Docker

Docker runs the standalone production build as a non-root user and persists non-secret workspace settings in a named volume.

### First installation

Clone the repository once, then build and start Scout:

```bash
git clone https://github.com/codydacosta-uds/uds-scout.git
cd uds-scout
task docker:start
```

`task docker:start` automatically supplies `.env.local` to the container at runtime. Supported credentials exported in the host shell are also forwarded by variable name and override the corresponding file value. They are never included in the image build. GitHub can use the same file with `GITHUB_TOKEN`, or it can still be entered in Scout setup.

Open [http://127.0.0.1:3001](http://127.0.0.1:3001), enter the GitHub token in setup if it was not supplied at runtime, and choose repositories. The token remains only in the running container process. The legacy-named `d2d-operations-data` volume is intentionally retained so existing saved selections survive the UDS Scout rename.

### Update an existing installation

From a clean checkout on the `main` branch, run:

```bash
cd uds-scout
task update
```

The update task:

1. Verifies Git, Docker, the `origin` remote, a clean working tree, and the `main` branch.
2. Fetches `origin/main` and applies it only as a fast-forward update.
3. Rebuilds the Docker image from the updated source.
4. Replaces and starts the Scout container while preserving the settings volume.

The task stops instead of overwriting local changes or reconciling a diverged branch. Tokens entered through the setup screen are session-only and must be entered again after the container is replaced; saved non-secret workspace selections remain available.

Use another host port for either start or update when needed:

```bash
task docker:start PORT=3002
task update PORT=3002
```

Useful commands:

```bash
task docker:logs  # Follow container logs
task docker:stop  # Remove the container and preserve workspace settings
```

For unattended startup, keep tokens in the protected `.env.local` runtime file or export them through the host's secret mechanism before running `task docker:start` or `task update`. Do not pass credentials as image build arguments or bake them into the image.

## Application structure

- `components/OperationsConsole.tsx` — application shell, loading, navigation, caching, and route composition
- `components/OverviewPage.tsx` — operational overview, browser-local card ordering, repository status, and GitLab work items
- `components/OperationsDrawer.tsx` — contextual operational detail drawers
- `components/operations-ui.tsx` — shared status, identity, metric, and formatting components
- `components/GitLabTicketComposer.tsx` — staged and explicitly confirmed GitLab ticket batches
- `components/InfrastructureExplorer.tsx` — infrastructure inventory and dependency knowledge UI
- `lib/github.ts` and `lib/github-operations.ts` — GitHub API access, caching, and workflow inference
- `lib/gitlab.ts` — GitLab API access, caching, project validation, and controlled mutations
- `lib/security-service.ts` and `lib/security-*` — Zarf discovery, application/advisory normalization, OCI/SBOM inspection, caching, and progressive refresh
- `components/SecurityIntelligence.tsx` — global and repository-level security context
- `lib/terraform-explorer.ts` — Terraform analysis and dependency inference

## Server API routes

Primary routes include:

- `GET /api/setup/status` — connection and local workspace readiness
- `POST /api/setup/connect` — validate a session GitHub token
- `POST /api/setup/gitlab/connect` — validate a session GitLab token
- `GET|POST /api/setup/repositories` — list GitHub repositories and save workspace selections
- `GET /api/setup/gitlab/projects` — list or validate accessible GitLab projects
- `GET /api/github/overview` — aggregated GitHub operational dashboard
- `POST /api/github/workflow-rerun` — explicitly confirmed failed-job or workflow re-run for a tracked repository
- `GET /api/security[?repository=owner/repository]` — cached security state and progressive tracked-repository enrichment
- `GET /api/github/repository?repo=owner/repository` — one selected repository workspace
- `GET /api/github/infrastructure` — SONIC Terraform source analysis
- `GET /api/github/uds-packages` — UDS Packages repository catalog
- `GET /api/github/uds-packages/contributors` — cached contributor totals
- `GET /api/gitlab/work-items` — assigned work from selected GitLab projects
- `GET /api/gitlab/labels` — labels for one validated GitLab ticket target
- `POST /api/gitlab/tickets` — explicitly confirmed GitLab issue batch

Credentials are never included in these API responses.

## Validation and security checks

The coverage badge reports line coverage for the explicitly selected policy-critical modules and API boundaries in `vitest.config.mts`; it is not presented as whole-application coverage. CI enforces at least 70% statement, function, and line coverage and 60% branch coverage for that scope. The committed badge is regenerated and checked on every pull request so its score cannot silently become stale.

Run the complete local validation set with `task check`, or directly with:

```bash
npm run lint
npm run test:coverage
npm run coverage:badge
npm run test:runner
npm run build
```

Use `npm test` for fast unit tests, `npm run test:watch` while developing, and `npm run test:e2e` after installing Chromium with `npx playwright install chromium`.

Credential-free GitHub Actions workflows provide:

- Unit and API-boundary tests covering Test Lab allowlists, exact-SHA plans, fixed workflows and flavors, GitLab project/label/batch enforcement, setup-token non-disclosure, tracked repository scope, SBOM and OCI normalization, Terraform dependency inference, sensitive Terraform values, Renovate parsing, UDS Common parsing, and safe release-note Markdown.
- CodeQL extended JavaScript/TypeScript analysis when GitHub Advanced Security is available and the `GHAS_ENABLED` repository variable is set to `true`.
- Pull-request dependency review under the same GitHub Advanced Security gate, plus production `npm audit`, ShellCheck, forced-command runner policy checks, and Trivy source, secret, and configuration scanning.
- Production image builds followed by High/Critical vulnerability and secret scanning.
- Chromium smoke tests at desktop and narrow viewports with mocked setup data, including baseline response-header assertions.
- A private-repository-compatible OpenSSF Scorecard CLI scan that publishes the aggregate and per-check scores to the workflow summary and retains the JSON report for 14 days. The public numeric Scorecard badge is unavailable while the repository is private.

CI never receives application API tokens or the Zeus SSH key, never contacts Zeus, and never performs GitLab or GitHub mutations. Workflow permissions are read-only except for CodeQL's gated `security-events: write` result upload. Action dependencies and the downloaded Scorecard CLI archive are pinned and integrity-checked; Dependabot maintains action dependencies.

## Roadmap

The next major provider change is a separate, first-class GitLab operations dashboard with its own projects, merge requests, pipelines, work queues, navigation, caches, and user identity. It will remain distinct from the GitHub dashboard rather than combining both providers into one operational view.

The controlled Test Lab implementation remains disabled and unexposed until it is ready for a future release.
