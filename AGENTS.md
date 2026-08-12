# UDS Scout — Agent Guide

This file defines the product and implementation conventions for AI coding agents working in this repository. Preserve these decisions unless the user explicitly requests a change.

## Product intent

UDS Scout is a local-first engineering console for actionable operational visibility across a small, explicitly selected set of GitHub repositories.

Prioritize information that helps an engineer decide what to do next:

- Open pull requests and review work
- Renovate dependency updates
- Open issues
- Failed or unhealthy pipelines
- Repository health and items requiring attention
- The UDS Core version used by the project, compared semantically with the latest `defenseunicorns/uds-core` release
- The infrastructure defined under `nswccd-devsecops/sonic-swf-iac/iac/swf`, presented as a plain-English inventory and dependency knowledge base

This is not an analytics dashboard. Avoid vanity metrics, charts, decorative widgets, activity feeds, and information that does not support an action.

## Visual language

Use the AWS Cloudscape Design System as the primary design reference. Cloudflare's dashboard may be used as a secondary reference for density and operational clarity.

The established dark theme is:

- Near-black application background
- Neutral charcoal/graphite containers and navigation
- Subtle neutral-grey borders
- Off-white primary text and muted-grey secondary text
- Neutral light-grey accents for links, selection, focus, and primary actions
- Semantic green, yellow, and red reserved for operational status
- Red reserved for actual failures and errors, plus the explicit **Major version** label and major-update overview count for Renovate updates; never use it for general interaction or routine review work

Use neutral contrast selectively so important actions remain clear without turning surfaces bright. Keep interaction colors black, graphite, and grey rather than reverting to Cloudscape's navy and blue defaults. Use the established dark mustard `#d6a514` for warning states and explicit completion actions such as **Done** in customization mode. Vertically center action buttons within Flashbar banners. Theme overrides belong in `app/globals.css`; never edit `node_modules`.

Keep the interface professional, calm, dense enough for engineering work, and easy to scan. Prefer clear hierarchy, alignment, spacing, and typography over visual decoration.

### Avoid

- Futuristic or sci-fi styling
- Glassmorphism, translucency, glow, neon, or heavy shadows
- Decorative gradients or excessive animation
- Graphs unless the user specifically asks for trend analysis
- Oversized marketing-style headings
- Excessive cards, badges, icons, or explanatory copy
- Using red for normal links, navigation, focus, or non-error actions other than the explicit Renovate **Major version** label and major-update count
- Borders or containers around the Doug logo

## Interaction model

Keep users in context:

- Prefer Cloudscape right-side drawers for summaries and detail inspection.
- Use dedicated routes for longer workflows and cross-repository work queues.
- Use Next.js client-side navigation; avoid full-page reloads and transition flashes.
- Link to GitHub only when deeper investigation or GitHub-native functionality is needed.
- Keep manual refresh icon-only and unobtrusive.
- Do not expose GitHub API quota details in the interface.

Drawers should provide useful operational detail, not merely repeat the title and summary already visible on the page.

Failed pipeline and check links should open a controlled Scout drawer before handing off to GitHub. Show only tracked-repository run, failed-job, and failed-step details. Workflow working notes are a browser-local, checkable next-step queue keyed by GitHub user, pipeline run, and selected failed check/job, saved in local storage until Scout site data is cleared. Show a one-time notice that notes are not shared or backed up and direct durable context to Notion or the GitHub pull request/workflow. Do not send notes to the server or treat them as durable records.

The Infrastructure Explorer is comprehension-first. Explain purpose, ownership, system, and upstream/downstream relationships before exposing Terraform addresses or HCL. When the user asks to refresh, rescan, or check SONIC infrastructure/deployment knowledge, load `.pi/skills/sonic-infrastructure-refresh/SKILL.md` and scan the current upstream repository rather than relying on cached assumptions. Keep Terraform mechanics in the expandable implementation section. Distinguish top-level deployed components, existing `data` references, and reusable local-module internals. Dependency claims must come from parsed references rather than file proximity alone.

### Test Lab

Test Lab at `/test-lab` deploys one explicitly selected package-repository branch to the existing Kubernetes cluster on remote host `zeus`, monitors UDS output and Kubernetes workloads, and removes the deployment afterward.

Preserve these safety boundaries:

- The authoritative existing Zeus cluster and context are `uds` and `k3d-uds`. Never create, start, replace, or delete a cluster from Test Lab.
- Exclude SONIC. Eligible repositories are the five `uds-packages/*` repositories in `lib/tracked-repositories.ts`.
- Offer only two fixed workflow modes: deploy-only runs `uds run dev`; deploy-and-test runs `uds run create-dev-package` followed by `uds run create-deploy-test-bundle`. Do not add command input or a general task selector.
- Read package flavors from `components[].only.flavor` in the selected branch's root `zarf.yaml`. When flavors are declared, require the operator to choose exactly one per run, pass that same allowlisted flavor to every fixed UDS workflow command with `--set flavor=<selected>`, and lock it with the active session. Never batch or automatically sequence flavors; cleanup must complete before the operator can choose another.
- Resolve the selected branch through GitHub, record its exact SHA internally, and require the remote checkout and flavor declaration to match before execution.
- Validate `tasks.yaml` and `tasks/test.yaml` before preparation and again on Zeus. Reject K3d/cluster-setup references, unknown nested tasks, and actions outside the explicit workflow allowlist. Direct commands are permitted only inside the repository-defined test tasks reached by the fixed `test:all` action; users can never enter a command or task name.
- Derive bundle name/version from the selected branch's `bundle/uds-bundle.yaml`. Cleanup must use the exact tarball generated by that session with `uds remove <artifact> --confirm --no-progress`.
- Do not clear or replace a deployed session, or a failed session that produced a bundle artifact, until cleanup succeeds.
- UDS writes normal progress to stderr. Show it as command output while running and only style it as error output when the session state is `failed`.
- Poll session status rather than tying deployment lifetime to an HTTP request. Sessions and logs persist on Zeus across browser reloads and app restarts. Preserve the remote phase metadata used to distinguish package building, bundle deployment, repository testing, and cleanup in the UI.
- Keep container-image inspection on demand. Scope pods by the `zarf.dev/package` labels matching package names in the exact selected bundle, show original image tags and runtime digests, paginate the result, and use the pre-deployment pod baseline to distinguish session-created/replaced pods from existing dependencies. Never expose a general cluster-wide image browser or arbitrary label selector.
- Eligible package pull requests may link into Test Lab with the base repository and same-repository source branch preselected. Default this handoff to deploy-and-test, validate normally, and open the existing confirmation dialog; navigation must never start a deployment automatically. Do not offer the action for SONIC, unconfigured repositories, or fork-owned source branches.

Remote access uses the `d2d-test-lab` SSH alias and its forced-command key. The allowlisted runner is maintained in `scripts/d2d-test-lab-runner` and installed at `/home/zeus/.local/bin/d2d-test-lab-runner`. Its fixed `host-status` action may report only aggregate CPU/load, memory, root/home filesystem usage, aggregate `/tmp` directory size, hostname, and uptime in Test Lab; do not turn it into a general host, process, file, or command browser. Test Lab uses a dedicated kubeconfig at `/home/zeus/.config/d2d-test-lab/kubeconfig`; do not depend on or overwrite browser-provided credentials. Never store a password in the app or repository. Before changing Test Lab or starting a new run, query the current remote session and preserve any required cleanup path.

## Content and copy

Use concise, direct engineering language. Keep required state and actions visible, and move optional explanatory copy into the shared AWS-style `InfoPopover` link from `components/info-ui.tsx`. Do not introduce ad hoc information icons or repeat explanatory text beside self-explanatory controls.

Lead with state and action:

- Good: `1 repository has a failing pipeline`
- Good: `Review available updates`
- Avoid: `Here you can see information about your repositories`

Status wording should be consistent across overview cards, tables, repository pages, and drawers. Repository attention reasons must lead to the focused pull-request, workflow, ownership, or configuration queue that can resolve them rather than only repeating the status in a repository drawer. An outdated UDS Common repository status must link directly to the repository `tasks.yaml` used to determine that status. Pull request lists must identify the author. When comparing UDS Core versions, ignore the local `-unicorn` suffix and upstream `v` prefix, compare major/minor/patch, and link differing upstream versions to their GitHub release. Show the latest UDS Core or UDS Common release notes in version drawers only when a tracked version is behind that latest release; do not show release notes for current, ahead, unknown, or merely missing configurations.

The product name is always **UDS Scout**. The first-run overview welcome is browser-local per GitHub user, concise, uses the unframed Doug logo, and directs users to My work today, red or warning states, and the Renovate review beacon.

The top navigation keeps a browser-local countdown labeled `Next SONIC maintenance window` visible across all pages, with only `SONIC` highlighted in yellow, anchored to August 11, 2026 at 5:00 PM. At the target time, show the window as active and do not begin the next 14-day countdown until 11:59 PM that Tuesday.

## Technical constraints

- Next.js 16, React 19, and TypeScript
- AWS Cloudscape components as the default component library
- Server-only GitHub REST API access using `GITHUB_TOKEN`
- Never send the GitHub token to browser code or API responses
- GitHub behavior is read-only except for explicitly confirmed re-runs of a selected failed job or workflow in a tracked repository. Revalidate the completed failed run and job relationship server-side, require Actions write permission, and never retry automatically or add other GitHub mutations implicitly.
- Gitlab mutations are limited to the dedicated ticket composer and projects explicitly selected from the authenticated Gitlab user’s accessible-project catalog. Persist only non-secret project paths, require exactly one server-allowlisted target per batch, revalidate Developer access and any operator-selected project labels before every submission, stage drafts locally, require a full batch review and explicit confirmation, enforce a maximum of 20 issues on the server, and report each creation result without automatic retries. Do not add other Gitlab writes implicitly.
- No database, authentication system, webhooks, or workers unless explicitly requested
- Refresh GitHub data every 60 seconds and on page reload
- Preserve the in-memory and client-side caching that prevents unnecessary requests and route-transition flashing
- Bind local servers to `127.0.0.1`; development uses port `3001`
- Docker may bind to `0.0.0.0` inside the container only when the documented host publish remains `127.0.0.1:3001:3001`
- Supply tokens to containers only at runtime, never through image build arguments or committed files; persist non-secret workspace settings under `/data`
- GitLab remains optional when `GITLAB_TOKEN` is present. A workspace-level opt-out may ignore the environment token and must clear selected GitLab projects without mutating the server environment.
- Keep custom CSS focused on theme tokens, layout refinements, and attention states

## Repository scope

Only surface repositories explicitly configured in `lib/tracked-repositories.ts`. Do not automatically expand to every repository accessible to the GitHub token.

The current set is:

- `nswccd-devsecops/sonic-swf-iac`
- `uds-packages/artifactory`
- `uds-packages/jira`
- `uds-packages/xray`
- `uds-packages/confluence`
- `uds-packages/jenkins`

Renovate updates must be authored by Renovate and use a `renovate/*` source branch. The overview's scheduled Renovate review can be manually shown or hidden for the current browser-local day without changing the configured weekly schedule.

## Important files

- `components/OperationsConsole.tsx` — application shell, data loading, navigation, and route composition
- `components/OverviewPage.tsx` — operational overview cards, browser-local card ordering, repository status, and GitLab work items
- `components/OperationsDrawer.tsx` — contextual operational detail drawers
- `components/operations-ui.tsx` — shared operational status, metric, identity, and formatting components
- `components/operations-types.ts` — shared console navigation and drawer selection contracts
- `components/ReleaseNotes.tsx` — safe GitHub release-note Markdown presentation
- `components/info-ui.tsx` — shared AWS-style Info link and explanatory popover
- `components/GitLabTicketComposer.tsx` and `app/api/gitlab/tickets/route.ts` — staged, explicitly confirmed GitLab issue creation
- `components/types.ts` — shared client data contracts
- `lib/github.ts` — GitHub client, aggregation, and server cache
- `lib/tracked-repositories.ts` — explicit repository configuration
- `config/repository-groups.json` — repository quick-select groups as group names mapped to `owner/repository` lists
- `app/api/github/overview/route.ts` — overview API
- `app/api/github/repository/route.ts` — repository detail API
- `app/api/github/infrastructure/route.ts` — Terraform source retrieval and analysis API
- `lib/terraform-explorer.ts` — Terraform inventory, categorization, summaries, and dependency inference
- `components/InfrastructureExplorer.tsx` — infrastructure knowledge-base UI and resource drawer
- `components/TestLab.tsx` — repository/branch deployment workflow, session monitoring, and cleanup UI
- `components/test-lab-types.ts` — shared Test Lab contracts
- `lib/test-lab.ts` — GitHub validation and restricted SSH session orchestration
- `app/api/test-lab/route.ts` — Test Lab catalog, status, deploy, cleanup, and reset API
- `app/api/zeus/status/route.ts` — read-only aggregate Zeus resource telemetry API
- `scripts/d2d-test-lab-runner` — forced-command remote allowlist installed on Zeus
- `app/globals.css` — neutral dark theme and focused custom styles
- `app/layout.tsx` — global Cloudscape visual-refresh and dark-mode classes
- `Dockerfile` and `.dockerignore` — non-root standalone production image and build-context exclusions

## Change discipline

Before adding a new pattern, check whether an existing Cloudscape component or established drawer/table/card pattern can be reused. Extend incrementally rather than redesigning unrelated areas.

When changing data contracts, update shared types and all relevant overview, repository, and drawer views together. Preserve loading, empty, partial-error, and stale-data behavior.

Use the shared action components in `components/action-ui.tsx` for primary, save, confirmation, and workflow-execution actions. Every successful user-initiated save must show the shared dismissible green acknowledgement banner; use task-specific success content while preserving the shared presentation.

Maintain `CHANGELOG.md` with concise user-facing entries under **Unreleased** as features and fixes are added. At release time, move those entries into a versioned section with the release date so the section can be used directly as GitHub release notes.

For every visual change, audit the equivalent pattern across overview cards, repository pages, tables, drawers, modals, desktop, and narrow layouts. Reuse shared components and color tokens so button hierarchy, links, status placement, spacing, alignment, hover, focus, loading, and empty states remain uniform. Fix adjacent instances in the same change rather than waiting for a second report.

After implementation, run:

```bash
npm run lint
npm run build
```

If visual behavior changes, inspect the running application at `http://127.0.0.1:3001` at desktop and narrow viewport sizes. Verify route transitions, drawers, loading states, overflow, and contrast.
