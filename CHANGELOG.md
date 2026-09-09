# Changelog

All notable user-facing changes to UDS Scout are documented here. This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic version tags.

## [Unreleased]

## [0.2.0] - 2026-09-08

### Added

- Added repository-level Security context for Critical and High upstream application advisories, with CVE inspection drawers, authoritative advisory links, correlated update pull requests, and explicit per-source coverage instead of misleading zero-vulnerability states.
- Added server-side security monitoring that refreshes advisory data every 15 minutes, plus deduplicated Slack webhook alerts for High and Critical vulnerabilities in package versions deployed by SONIC.
- Added public Defense Unicorns Registry scan metadata, published Zarf SBOM discovery, immutable OCI digest resolution, OSV, GitHub advisory, NVD, Jenkins, and GitLab vendor-advisory enrichment without collecting private-registry credentials.
- Added independent SONIC bundle security evaluation for recognized products, including explicit Critical, High, Checked, Coverage incomplete, and Not evaluated states when a package repository is not selected in Scout.
- Added SONIC bundle package version comparisons that preserve flavor and architecture, link to architecture-qualified registry packages, prioritize available updates, and expose status filtering.
- Added explicitly confirmed single and bulk SONIC package update pull requests with exact source-line and flavor validation, shared-reference deduplication, stale-update and duplicate-PR protection, conventional commits, and a `scout` label.
- Added Renovate configuration-health analysis, including UDS Common preset inheritance, local overrides, automerge state, grouping, dependency dashboard, schedules, release age, digest pinning, labels, and toil-reduction recommendations.
- Added major-version detection for Renovate pull requests, focused status and pipeline filters, and consistent update details across overview and full review tables.
- Added a browser-local personal-work queue for Scout recommendations, pull requests, issues, workflows, and security findings, with filtering, sorting, bulk actions, private notes, undo, cross-tab synchronization, and confirmed cleanup.
- Added controlled failed-workflow drawers with tracked run, failed-job, and failed-step details; confirmed job or workflow reruns; and browser-local checkable working notes with a one-time durability notice.
- Added live rerun polling that reports waiting, queued, running, passed, or failed attempts and refreshes Scout when the new attempt completes.
- Added an explicitly confirmed action to update eligible pull-request branches from `main`, along with updated branch-state feedback and Copy PR URL actions.
- Added PNG and Slack-friendly Markdown exports for the current Infrastructure Explorer dependency graph, and retained the last successful graph while background refreshes run.
- Added a browser-local light theme, a single-panel searchable navigation with grouped work queues and status counts, and current UI screenshots.
- Added latest stable release cards to UDS package repository pages and a compact `BOT` marker for Renovate-authored pull requests.
- Added shared action, confirmation, save, and acknowledgement components for consistent user-initiated workflows.
- Added repository-configured quick-select groups and a concise browser-local first-run welcome.
- Added `task update` to fast-forward a clean `main` checkout, rebuild the image, and replace the Scout container while preserving saved workspace settings.
- Added policy-focused Vitest, restricted-runner, and desktop/narrow Playwright coverage, enforced coverage thresholds, browser security-header checks, CI, dependency auditing, ShellCheck, CodeQL gating, Trivy scans, Dependabot, and OpenSSF Scorecard workflows.

### Changed

- Focused UDS Scout on GitHub repository operations by removing GitLab setup, work-item, ticket-composer, navigation, and API functionality.
- Removed the standalone Security Intelligence destination; security findings now remain in repository context, and `/security` redirects to the overview.
- Removed the SONIC maintenance-window countdown and the unexplained Slack taco shortcut from global navigation.
- Restricted SONIC navigation, Infrastructure Explorer content, and infrastructure API access to workspaces that explicitly select the SONIC repository.
- Replaced the previous Cloudscape sidebar with a denser MUI-inspired single-panel navigation and aligned operational tables around quiet headers, thin row rules, subtle hover states, and neutral selection surfaces.
- Added browser-local stale-while-refresh setup, viewer, overview, repository-navigation, and Infrastructure Explorer caching so successful data remains visible during reloads and background refreshes.
- Refocused the overview and My work today content on ownership, pipeline health, next actions, warning states, and concise repository names; long personal queues now scroll instead of expanding the page.
- Expanded Workflow failures to include default-branch failures and managed non-default workflow branches with three or more failed runs.
- Made repository attention reasons lead to focused pull-request, review, workflow, ownership, or UDS Common queues, and linked outdated UDS Common status directly to the determining `tasks.yaml`.
- Refocused pull-request and Renovate tables on ownership, pipeline status, approval state, age, update severity, and direct failed-check handoffs.
- Unified operational and security refresh warnings in the application notification area and moved successful save acknowledgements into stacked bottom-right toasts.
- Removed visible external-link arrow icons while preserving external behavior and accessible labels, standardized optional explanations on the shared AWS-style Info popover, and improved light-theme drawer and secondary-text contrast.
- Removed authenticated Defense Unicorns Registry lookups and credential collection while retaining public Registry scan evidence.
- Updated Docker runtime credential loading and reduced the production image by removing npm, Corepack, and Yarn after the standalone application is copied.
- Reworked the README around UDS package maintainer workflows and moved SONIC-specific documentation into `docs/sonic/`.

### Fixed

- Corrected UDS Common latest-version selection to use the newest exact `vMAJOR.MINOR.PATCH` tag instead of appended release tags.
- Corrected SONIC architecture variants that share one bundle source reference so they produce one underlying update and reject conflicting requested versions.
- Corrected NVD and OSV affected-range evaluation, including UDS version suffix handling, flavor-aware matching, local CPE-bound validation, and historical or unrelated CVE false positives.
- Corrected Security context coverage so missing, mixed, and unevaluated evidence remains explicit instead of appearing vulnerability-free.
- Removed stale workflow failures and replaced obsolete failed-step presentation with the current live rerun attempt state.
- Hardened OCI inspection against private, loopback, link-local, carrier-grade NAT, multicast, private IPv6, DNS rebinding, and unsafe redirect targets.
- Hardened Test Lab validation to recursively reject missing, invalid, unknown, or cluster-managing nested tasks and require `test:all` delegation.
- Hid sensitive Terraform output values as well as sensitive variable defaults.
- Improved Docker replacement readiness checks and handling of briefly retained OrbStack loopback forwarding entries.
- Improved GitHub DNS, timeout, refused-connection, reset, and unreachable-network errors with actionable connection guidance.
- Patched vulnerable Alpine packages and removed package-manager-only vulnerabilities from the final production image.

## [0.1.0] - 2026-08-07

### Added

- Released the initial UDS Scout local-first operations console for an explicit set of tracked GitHub repositories.
- Added the personalized **My work today** queue, daily operational briefing, pull-request workflow details, repository status, issue visibility, and pipeline-failure prioritization.
- Added Renovate detection and separation of routine dependency updates from updates requiring manual attention, including a configurable weekly review table.
- Added UDS Core semantic version comparison, UDS Common configuration checks, current Zarf, Pepr, and UDS CLI releases, and the UDS Packages repository catalog.
- Added the SONIC Infrastructure Explorer with plain-English Terraform inventory, ownership, environments, and parsed upstream/downstream relationships.
- Added optional Gitlab work-item visibility and explicitly confirmed ticket batches limited to selected projects.
- Added local workspace setup, server-only token handling, browser and in-memory caching, 60-second refreshes, and a non-root Docker deployment with persisted non-secret settings.

### Security

- Limited GitHub access to read-only operations against explicitly selected repositories.
- Kept GitHub and Gitlab tokens in server-only memory or runtime environment variables and excluded them from browser API responses and persisted settings.
- Limited Gitlab writes to reviewed ticket batches with server-side project, permission, label, and batch-size validation.

[Unreleased]: https://github.com/codydacosta-uds/uds-scout/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/codydacosta-uds/uds-scout/compare/v0.1.0...v0.2.0
[0.1.0]: https://github.com/codydacosta-uds/uds-scout/releases/tag/v0.1.0
