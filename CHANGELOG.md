# Changelog

All notable user-facing changes to UDS Scout are documented here. This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic version tags.

## [Unreleased]

### Changed

- Removed the SONIC maintenance-window countdown from the global navigation.
- Clarified My work today counts, next actions, repository names, and dashboard copy; removed the unexplained Slack taco shortcut.
- Temporarily removed GitLab from the Scout user experience so the GitHub repository-operations workflow remains focused.

### Added

- Added a server-side Security monitor that starts with Scout, checks configured repositories without requiring a browser Security page to be open, and refreshes advisory data every 15 minutes.
- Added latest available package versions and update status to the SONIC bundle package table, with architecture-qualified registry links. Updates sort first, unknown results follow, and current packages sort last; status filtering is also available.
- SONIC package comparisons now preserve and display the bundle-selected flavor and architecture, and only compare against releases for that same flavor.
- Replaced pink-toned error accents with the established neutral red error color.
- Added PNG export for the currently displayed Infrastructure Explorer dependency graph, with a clean export header and editor controls removed.
- Added Copy Markdown for the current Infrastructure Explorer graph, including a Slack-friendly resource table with ownership and source links.
- Added a browser-local light mode toggle to the top navigation using Cloudscape light-mode defaults and Scout-owned light surface overrides.
- Infrastructure Explorer now retains its last successful snapshot during background refreshes and route changes instead of replacing it with a loading state.
- Reorganized the side navigation into My work, Work queues, Infrastructure, Tracked repositories, External workspaces, and workspace tools.
- Added automatic Slack webhook alerts for High and Critical vulnerabilities in package versions currently deployed by SONIC, using Grafana-style attachments with severity-based deduplication windows.
- Added a Latest release card to `uds-packages` repository pages, linking the current stable GitHub release tag.

- Added a SONIC bundle versions panel to the tracked repository page, with architecture-qualified links to registry packages such as Artifactory `7.161.16-uds.0-upstream-amd64`.

- Added a compact `BOT` indicator for pull requests authored by Renovate across pull-request tables, work queues, and detail drawers.

- Added a policy-focused Vitest suite with enforced coverage for Test Lab, GitLab mutation, token-handling, repository-scope, security normalization, SBOM/OCI, Terraform, Renovate, UDS Common, local-settings, and release-note safety boundaries, plus restricted-runner shell checks and desktop/narrow Playwright smoke tests.
- Added credential-free CI, GitHub Advanced Security-gated CodeQL and dependency review, production dependency audit, ShellCheck, Trivy source/secret/configuration and production-image scanning workflows, with commit-pinned actions, Dependabot updates, coverage and workflow badges, and retained failure reports.
- Added a private-repository-compatible OpenSSF Scorecard scan with a checksum-verified CLI, workflow summary scores, retained JSON reports, and a README workflow badge.
- Added baseline browser security headers covering framing, content-type sniffing, referrer handling, browser capabilities, and opener isolation.
- Added zero-configuration Security Intelligence for tracked Zarf repositories, with content-based package discovery, application and image normalization, immutable OCI digest resolution, remote SBOM discovery, public Defense Unicorns Registry scan metadata, batched OSV and GitHub advisory matching, curated NVD application-product CVE coverage, Jenkins and GitLab vendor advisory matching, maintainer-focused application decisions with CVE inspection drawers and directly linked authoritative advisories, explicit per-source coverage, progressive local caching, repository Security tabs, a repository-oriented global view, and explicit exclusion of the SONIC infrastructure/deployment repository.
- Added reusable security product profiles and a repeatable Security Intelligence enrichment skill for auditing newly selected repositories, validating product coordinates and advisory ranges, and adding vendor coverage without repository-specific CVE rules.
- Added `task update` for safely fast-forwarding a clean `main` checkout, rebuilding the Docker image, and replacing the running Scout container while preserving saved workspace settings.
- Added pipeline-state filtering to the full Renovate updates page for failed or cancelled, running, passed, and no-check updates.
- Added a browser-local daily control to show or hide the overview Renovate review without changing its configured weekly schedule.
- Added a versioned browser-local personal-work queue that combines Scout recommendations with pull requests, issues, workflows, and security findings added from source tables or detail drawers, including source/type filters, sorting, bulk add/remove, private follow-up notes, undo, cross-tab synchronization, hidden-recommendation review, deduplication, and confirmed lifecycle cleanup.
- Added major-version detection from Renovate pull-request metadata and version changes, with a dedicated overview count, red table labels, filtering, and version details in the pull-request drawer.
- Added a controlled failed-check drawer with exact GitHub run links, failed job and step details, confirmed job or workflow re-run actions, and a browser-local, checkable next-step queue scoped to the GitHub user, workflow run, and selected failure.
- Added a one-time notice explaining that workflow notes are an unshared browser scratchpad and directing durable context to Notion or GitHub.
- Added shared action and save components with consistent loading, disabled, and primary-action presentation.
- Added repository-configured quick-select groups, including UDS Foundry Maintainers, using the simple group-name and repository-list format in `config/repository-groups.json`.
- Added an explicit setup and Workspace settings option to use Scout without GitLab, including when `GITLAB_TOKEN` is supplied by the server environment.
- Added a concise first-run welcome with Doug, guidance to begin with My work today and warning states, and a direct Renovate review handoff.
- Added dismissible green acknowledgement banners after successful workspace, repository, Gitlab project, Renovate schedule, quick-select group, connection, ticket, and Test Lab actions.

### Changed

- Unified operational and Security refresh warnings in the AppLayout notification area above page content instead of rendering separate banners beneath individual page headers.
- Reduced the Security context card value size for easier scanning.
- Constrained My work today to a scrollable table so long personal queues do not make the overview page excessively tall.
- Removed visible external-link arrow icons throughout the application while preserving external-link behavior and accessibility labels.
- Reduced the Latest release card version text size for easier scanning.
- Stacked simultaneous footer acknowledgement toasts in one bottom-right notification area so new messages remain visible instead of overlapping.
- Moved settings-save and dashboard-update acknowledgements to the bottom-right footer toast treatment; operational errors remain in the notification area.
- Removed the overview Flashbar that announced repositories needing UDS Common attention; UDS Common alignment remains available through the version card and repository status details.
- Refocused Security Intelligence on Critical and High upstream application advisories, unique CVE decisions, and correlated update pull requests; package flavors and repeated image occurrences now remain internal evidence instead of separate maintainer queues.
- Removed the repository-wide release/flavor security panel, reduced container findings to secondary context, and now refreshes lightweight upstream advisory sources every 15 minutes without repeating full image analysis.
- Expanded automatic upstream identification with Zarf package URLs, chart URLs, official GHCR ownership, and reusable product profiles, while preserving explicit gaps for ambiguous products.
- Docker startup now loads optional server credentials from a protected `.env.local` runtime file and forwards supported exported token variables without including them in the image.
- Made the full Renovate updates table and scheduled overview review table use the same update details, labels, check status, approval status, pull-request status, age, and check-priority ordering.
- Focused Renovate tables by default on failed or cancelled updates and major-version changes, with failures ahead of healthy major updates and the complete list still available.
- Made the major Renovate overview card open a focused pull-request list, and linked outdated UDS Common statuses directly to the repository `tasks.yaml` that requires an update.
- Made repository attention reasons open the focused blocked-PR, review, ownership, workflow, or UDS Common queue needed to resolve them, with the same next action available in repository drawers.
- Refocused the pull-request table on ownership, pipeline health, status, and recency, with repository and author filters and direct failed-check handoffs.
- Consolidated repeated primary-button and success-banner patterns so equivalent actions behave consistently across settings, setup, drawers, ticket creation, and Test Lab.
- Quick pipeline re-run acknowledgements now appear as temporary lower-right notifications that fade away without shifting drawer content.
- CodeQL and dependency review now remain skipped unless the `GHAS_ENABLED` repository variable explicitly confirms that GitHub Advanced Security is available.
- Infrastructure Explorer navigation, page content, and API access now require the SONIC repository to be selected in the current workspace.
- OpenSSF Scorecard CLI downloads now retry transient GitHub release availability failures while retaining checksum verification.
- Added a GitHub mark in the top navigation linking directly to the UDS Scout source repository.
- Removed private Defense Unicorns Registry credential collection and authenticated package lookups; Security Intelligence retains the public Registry scan metadata currently supplying package SBOM and vulnerability evidence.
- Standardized optional explanations on the AWS-style **Info** link and popover, reducing always-visible setup and overview copy.
- Simplified the full Renovate page hierarchy by removing the redundant nested review heading.

### Fixed

- The overview UDS Common attention banner can now be dismissed and stays hidden until the underlying repository attention state changes.
- The production container now removes npm, Corepack, and Yarn after the standalone application is copied, reducing unused tooling and eliminating vulnerabilities inherited only from base-image package managers.
- Terraform Explorer now hides values for sensitive outputs as well as sensitive variable defaults.
- OCI inspection now rejects additional private, loopback, link-local, carrier-grade NAT, multicast, and private IPv6 registry addresses and uses a restricted DNS dispatcher so registry and redirect connections cannot resolve to private addresses.
- Test Lab plan validation now recursively rejects missing, invalid, or cluster-managing nested repository test tasks and requires `test:all` to delegate instead of running direct commands.
- Security Intelligence now discovers SBOMs from published `uds-packages/*` Zarf OCI releases and public Defense Unicorns Registry scans, reports unevaluated scopes as not established instead of displaying misleading zero-CVE counts, distinguishes mixed repository coverage from fully unavailable coverage, and shows upstream, Registry1, and unicorn coverage separately.
- Security Intelligence now groups release-coupled product images, excludes test and helper images from application counts, rejects untrusted mirror package versions, validates NVD CPE bounds locally, and honors OSV custom affected ranges to prevent historical or unrelated direct-CVE false positives.
- Docker startup now waits for Scout to become reachable from the host and prints recent container logs when readiness fails.
- Docker startup accounts for a briefly retained OrbStack loopback forwarding entry when replacing the container.
- GitHub DNS, timeout, refused-connection, reset, and unreachable-network failures now return actionable connection guidance instead of a generic server error.

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

[Unreleased]: https://github.com/codydacosta-uds/d2d-operations/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/codydacosta-uds/d2d-operations/releases/tag/v0.1.0
