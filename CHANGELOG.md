# Changelog

All notable user-facing changes to UDS Scout are documented here. This project follows [Keep a Changelog](https://keepachangelog.com/en/1.1.0/) and uses semantic version tags.

## [Unreleased]

### Added

- Added `task update` for safely fast-forwarding a clean `main` checkout, rebuilding the Docker image, and replacing the running Scout container while preserving saved workspace settings.
- Added pipeline-state filtering to the full Renovate updates page for failed or cancelled, running, passed, and no-check updates.
- Added a browser-local daily control to show or hide the overview Renovate review without changing its configured weekly schedule.
- Added major-version detection from Renovate pull-request metadata and version changes, with a dedicated overview count, red table labels, filtering, and version details in the pull-request drawer.
- Added a controlled failed-check drawer with exact GitHub run links, failed job and step details, and a browser-local, checkable next-step queue scoped to the GitHub user, workflow run, and selected failure.
- Added a one-time notice explaining that workflow notes are an unshared browser scratchpad and directing durable context to Notion or GitHub.
- Added shared action and save components with consistent loading, disabled, and primary-action presentation.
- Added repository-configured quick-select groups, including UDS Foundry Maintainers, using the simple group-name and repository-list format in `config/repository-groups.json`.
- Added an explicit setup and Workspace settings option to use Scout without GitLab, including when `GITLAB_TOKEN` is supplied by the server environment.
- Added a concise first-run welcome with Doug, guidance to begin with My work today and warning states, and a direct Renovate review handoff.
- Added dismissible green acknowledgement banners after successful workspace, repository, Gitlab project, Renovate schedule, quick-select group, connection, ticket, and Test Lab actions.

### Changed

- Made the full Renovate updates table and scheduled overview review table use the same update details, labels, check status, approval status, pull-request status, age, and check-priority ordering.
- Focused Renovate tables by default on failed or cancelled updates and major-version changes, with failures ahead of healthy major updates and the complete list still available.
- Made the major Renovate overview card open a focused pull-request list, and linked outdated UDS Common statuses directly to the repository `tasks.yaml` that requires an update.
- Made repository attention reasons open the focused blocked-PR, review, ownership, workflow, or UDS Common queue needed to resolve them, with the same next action available in repository drawers.
- Refocused the pull-request table on ownership, pipeline health, status, and recency, with repository and author filters and direct failed-check handoffs.
- Consolidated repeated primary-button and success-banner patterns so equivalent actions behave consistently across settings, setup, drawers, ticket creation, and Test Lab.
- Standardized optional explanations on the AWS-style **Info** link and popover, reducing always-visible setup and overview copy.
- Simplified the full Renovate page hierarchy by removing the redundant nested review heading.

### Fixed

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
