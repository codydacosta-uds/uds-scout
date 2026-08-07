# UDS Scout

UDS Scout is a local-first engineering console for actionable operational visibility across a small, explicitly selected set of repositories. It brings review work, dependency updates, issues, pipeline failures, version alignment, and infrastructure knowledge into one focused interface.

The current release uses GitHub as the primary repository dashboard. GitLab is an optional integration for assigned work items and explicitly confirmed ticket creation; a separate full GitLab operations dashboard is planned rather than mixing providers into one view.

## Supporting UDS package maintainers

UDS Scout is designed to reduce the day-to-day toil of maintaining packages across multiple repositories. Instead of repeatedly opening each repository to reconstruct review state, pipeline health, dependency updates, ownership, and version alignment, maintainers get one prioritized queue built from the repositories they explicitly selected.

Scout helps maintainers:

- Start with work that needs a decision or handoff rather than manually checking every repository.
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
- Identify Renovate pull requests only when Renovate authored them from a `renovate/*` source branch.
- Separate routine Renovate updates from updates with observable blockers, direct requests, conflicts, failed required checks, or configured priority labels.
- Provide an operator-configurable weekly Renovate review table with failed, running, passed, and no-check filters.

### UDS and repository health

- Compare the UDS Core version configured by SONIC with the latest `defenseunicorns/uds-core` release using semantic versioning.
- Inspect root `tasks.yaml` files for UDS Common includes and identify current, outdated, missing, or unverifiable configurations.
- Show current Zarf, Pepr, and UDS CLI releases.
- Browse the UDS Packages organization through a searchable, sortable, paginated catalog with contributor totals.

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

- GitHub access is read-only and limited to the configured repository selection.
- GitLab writes are limited to the staged, reviewed, and explicitly confirmed ticket-composer workflow.
- GitHub and GitLab tokens are read only by Next.js server code and are never returned in browser API responses.
- Tokens entered during setup remain in server memory for the current process; environment tokens remain outside persisted Scout settings.
- Only non-secret workspace preferences are stored locally.
- No database, webhook service, background worker, or application authentication system is required.
- Test Lab is not enabled or exposed in this release.
- The development server binds to `127.0.0.1`. Docker binds to `0.0.0.0` only inside the container and is published on `127.0.0.1` by the documented command.

## Technology

- Next.js 16 and React 19
- TypeScript
- AWS Cloudscape Design System
- GitHub REST and GraphQL APIs
- GitLab REST and GraphQL APIs
- Local in-memory request caching
- Terraform parsing with CDK for Terraform HCL-to-JSON tooling

## Run locally

### Prerequisites

- Node.js 22 recommended
- npm
- A GitHub token with read access to the repositories you intend to select
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
2. Optionally connect a GitLab token.
3. Select the GitHub repositories Scout should monitor.
4. If GitLab is connected, select the GitLab projects used for assigned work items and choose an optional default ticket project.
5. Save the workspace and continue to the dashboard.

Tokens entered in the browser are validated by the server and retained only for the current app process. Non-secret selections are stored with local-user permissions at:

```text
~/.config/uds-scout/settings.json
```

Existing `~/.config/d2d-operations/settings.json` settings continue to load when the new path does not yet exist. Use **Workspace settings** to manage connections and selections or **Run setup again** to replay setup without clearing the active workspace before a replacement selection is saved.

You can also copy `.env.local.example` to `.env.local`. Never commit `.env.local` or another file containing real credentials.

### Environment variables

| Variable | Required | Purpose |
| --- | --- | --- |
| `GITHUB_TOKEN` | Yes, unless entered during setup | Server-only GitHub API token |
| `GH_TOKEN` | No | Fallback GitHub token name |
| `GITLAB_TOKEN` | No | Server-only GitLab API token |
| `GITLAB_URL` | No | GitLab origin; defaults to `https://gitlab.sonic.mil` |
| `GITHUB_REPOSITORIES` | No | Comma-separated repository override that takes precedence over the saved selection |
| `UDS_SCOUT_SETTINGS_PATH` | No | Alternate location for non-secret local settings |

## Run with Docker

Docker runs the standalone production build as a non-root user and persists non-secret workspace settings in a named volume.

```bash
git clone https://github.com/codydacosta-uds/d2d-operations.git
cd d2d-operations
task docker:start
```

Open [http://127.0.0.1:3001](http://127.0.0.1:3001), enter the GitHub token in setup, and choose repositories. The token remains only in the running container process. The legacy-named `d2d-operations-data` volume is intentionally retained so existing saved selections survive the UDS Scout rename.

Use another host port when needed:

```bash
task docker:start PORT=3002
```

Useful commands:

```bash
task docker:logs  # Follow container logs
task docker:stop  # Remove the container and preserve workspace settings
```

For unattended startup, provide tokens to the container at runtime through a protected environment file or secret mechanism. Do not pass credentials as image build arguments or bake them into the image.

## Application structure

- `components/OperationsConsole.tsx` — application shell, loading, navigation, caching, and route composition
- `components/OverviewPage.tsx` — operational overview, browser-local card ordering, repository status, and GitLab work items
- `components/OperationsDrawer.tsx` — contextual operational detail drawers
- `components/operations-ui.tsx` — shared status, identity, metric, and formatting components
- `components/GitLabTicketComposer.tsx` — staged and explicitly confirmed GitLab ticket batches
- `components/InfrastructureExplorer.tsx` — infrastructure inventory and dependency knowledge UI
- `lib/github.ts` and `lib/github-operations.ts` — GitHub API access, caching, and workflow inference
- `lib/gitlab.ts` — GitLab API access, caching, project validation, and controlled mutations
- `lib/terraform-explorer.ts` — Terraform analysis and dependency inference

## Server API routes

Primary routes include:

- `GET /api/setup/status` — connection and local workspace readiness
- `POST /api/setup/connect` — validate a session GitHub token
- `POST /api/setup/gitlab/connect` — validate a session GitLab token
- `GET|POST /api/setup/repositories` — list GitHub repositories and save workspace selections
- `GET /api/setup/gitlab/projects` — list or validate accessible GitLab projects
- `GET /api/github/overview` — aggregated GitHub operational dashboard
- `GET /api/github/repository?repo=owner/repository` — one selected repository workspace
- `GET /api/github/infrastructure` — SONIC Terraform source analysis
- `GET /api/github/uds-packages` — UDS Packages repository catalog
- `GET /api/github/uds-packages/contributors` — cached contributor totals
- `GET /api/gitlab/work-items` — assigned work from selected GitLab projects
- `GET /api/gitlab/labels` — labels for one validated GitLab ticket target
- `POST /api/gitlab/tickets` — explicitly confirmed GitLab issue batch

Credentials are never included in these API responses.

## Validation

Run the same checks expected before merging or releasing:

```bash
task check
```

This runs:

```bash
npm run lint
npm run build
```

## Roadmap

The next major provider change is a separate, first-class GitLab operations dashboard with its own projects, merge requests, pipelines, work queues, navigation, caches, and user identity. It will remain distinct from the GitHub dashboard rather than combining both providers into one operational view.

The controlled Test Lab implementation remains disabled and unexposed until it is ready for a future release.
