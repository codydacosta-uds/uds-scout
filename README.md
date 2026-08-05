# D2D Operations

A local-first, read-only engineering console for explicitly selected GitHub repositories, with optional GitLab and repository-specific operational integrations.

## Stack

- **Next.js 16** — frontend and backend in one local process
- **React 19 + TypeScript** — dashboard UI and type safety
- **GitHub REST API** — live repository, issue, PR, and Actions data
- **GitLab REST API** — optional open work items assigned to the connected GitLab user
- **AWS Cloudscape Design System** — accessible console components and layout patterns
- **Minimal custom CSS** — limited to layout adjustments and attention states
- **In-memory cache** — 60-second GitHub and GitLab API cache; no database required

GitHub and GitLab tokens are read only by Next.js server routes. They are never included in browser JavaScript or API responses. When `GITHUB_TOKEN` is not set, the local setup screen can validate a token and retain it in server memory for the current app session. The server binds to `127.0.0.1` by default so private work data is not exposed to the local network.

## Run locally

The project uses [Task](https://taskfile.dev/) through `Taskfile.yml`. On macOS, install the correct CLI with:

```bash
brew install go-task
```

Start D2D Operations with:

```bash
task start
```

The task installs dependencies when needed, loads `GITHUB_TOKEN` and `GITLAB_TOKEN` from `~/.zshrc`, and starts the development server. Open [http://127.0.0.1:3001](http://127.0.0.1:3001). Use `Ctrl+C` to stop it and `task --list` to see all available tasks.

D2D Operations opens the two-step local setup flow on first boot. If `GITHUB_TOKEN` is already available, the first step confirms **GitHub token found** without exposing its value; the operator then continues to repository selection. Tokens entered in the browser are held only in server memory and must be entered again after the app process restarts. Repository selections are stored at `~/.config/d2d-operations/settings.json` with local-user permissions. Open **Workspace settings** from the side navigation to change the selection or use **Run setup again** to replay the first-run workflow without clearing the active workspace until a new selection is saved.

To run the underlying commands manually:

```bash
source ~/.zshrc
npm install
npm run dev
```

Port 3001 is used because port 3000 is occupied locally.

Alternatively, copy `.env.local.example` to `.env.local` and enter the token there. Never commit `.env.local`.

## Current MVP

- Explicit operator-selected managed repositories with no default tracked repository list
- Local first-run setup with server-only GitHub token validation and explicit managed-repository selection
- Action-oriented operational overview with a time-based greeting and browser-local card ordering
- Latest Zarf and Pepr release cards with direct release details
- Optional assigned GitLab work item table with direct links to each item and the filtered GitLab board
- UDS Packages repository count card and searchable, sortable, paginated organization catalog with contributor totals
- Open pull request and issue totals
- Pipeline health and failure alerts
- Current UDS Core version detection
- Cross-repository Renovate inbox for open `renovate/*` pull requests
- Per-repository Renovate counts with 60-second auto-refresh
- Dedicated repository pages with pull requests, updates, issues, pipelines, infrastructure, and related resources
- At-a-glance aggregate host health in Test Lab through a restricted, read-only runner
- Branch-driven Test Lab for eligible UDS package repositories, with fixed deploy-only and deploy-and-test modes, required single-flavor selection, live UDS output and workloads, bundle-scoped image inspection, and exact-bundle cleanup
- Context-aware operator help covering features, system connection points, refresh behavior, status semantics, and safety responsibilities
- Eligible package pull requests can open Test Lab with the source branch preselected and the deploy-and-test confirmation ready
- Capability-based Infrastructure Explorer for supported repositories, including Terraform inventory, ownership, parsed dependencies, plain-English resource details, reusable patterns, providers, environments, inputs, and outputs
- Optional deployment knowledge derived from repository-defined UDS tasks, including order, operator commands, environment status, source links, and outcomes
- Optional UDS configuration and bundle explorer connecting Terraform outputs to generated configuration and ordered packages without exposing secret values
- Responsive Cloudscape console interface

All features are read-only. Deeper investigation links back to GitHub or GitLab.

## Frontend structure

- `components/OperationsConsole.tsx` owns the application shell, data loading, navigation, and route composition.
- `components/OverviewPage.tsx` owns overview cards, card ordering, repository status, and GitLab work items.
- `components/OperationsDrawer.tsx` owns contextual detail drawers.
- `components/operations-ui.tsx` contains shared operational presentation helpers.
- `components/operations-types.ts` contains shared console and drawer contracts.
- `components/ReleaseNotes.tsx` renders GitHub release notes safely.

Keep feature-specific UI in its focused module instead of growing the application shell. Prefer Cloudscape properties and theme tokens over selectors targeting generated Cloudscape class names.

## API routes

- `GET /api/setup/status` — local setup readiness without exposing credentials
- `POST /api/setup/connect` — validate and retain a session-only GitHub token
- `GET|POST /api/setup/repositories` — list available repositories and save the managed selection
- `GET /api/github/overview`
- `GET /api/github/repository?repo=owner/repository`
- `GET /api/github/infrastructure`
- `GET /api/github/uds-packages` — repositories visible in the `uds-packages` organization
- `GET /api/github/uds-packages/contributors` — cached contributor totals for the organization catalog
- `GET /api/gitlab/work-items` — open work assigned to the current GitLab token user
- `GET /api/test-lab` — repositories, branches, validated deployment plans, and live session status
- `POST /api/test-lab` — start an allowlisted `dev` deployment, remove its generated bundle, or clear a completed session

## Build checks

```bash
task check
```

The task runs `npm run lint` followed by `npm run build`.

## Incremental roadmap

Good next pieces, each independently buildable:

1. Saved repository groups and favorites
2. Organization-wide PR inbox with reviewer filters
3. Failing workflow queue
4. Release and dependency health
5. Local SQLite preferences and snapshots
6. Optional GitHub write actions with explicit confirmation
