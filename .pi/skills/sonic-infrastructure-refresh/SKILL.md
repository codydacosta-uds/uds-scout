---
name: sonic-infrastructure-refresh
description: Rescans nswccd-devsecops/sonic-swf-iac and refreshes UDS Scout infrastructure, deployment, UDS configuration, environment, and bundle knowledge. Use when the user asks to check for SONIC repository changes, refresh or update the Infrastructure Explorer, validate deployment tasks, update UDS package/config information, or investigate stale infrastructure relationships.
compatibility: Requires network access and GITHUB_TOKEN or GH_TOKEN with read access to nswccd-devsecops/sonic-swf-iac.
---

# SONIC Infrastructure Refresh

Use this workflow whenever UDS Scout infrastructure knowledge may be stale. Do not trust a previous `/tmp` snapshot or hardcoded package/task assumptions.

## Source repository

- Repository: `nswccd-devsecops/sonic-swf-iac`
- Default branch: `main`
- Explorer API: `app/api/github/infrastructure/route.ts`
- Analyzer: `lib/terraform-explorer.ts`
- Deployment analyzer: `lib/sonic-deployment.ts`
- UI: `components/InfrastructureExplorer.tsx`

Read `AGENTS.md` before making changes.

## Refresh workflow

1. Fetch a fresh recursive Git tree for `main` through the GitHub API using the server-side token.
2. Record the returned tree/commit SHA so the analysis can be traced to a source revision.
3. Rescan all Terraform files under `iac/swf`, including local modules.
4. Rescan the deployment and UDS sources listed in [references/source-map.md](references/source-map.md).
5. Compare the live source structure with the current API output from `GET /api/github/infrastructure`.
6. Update analyzers and shared types when task, bundle, config, environment, module, or relationship structures changed.
7. Keep the browser API read-only and never expose the GitHub token, secret values, private keys, certificates, generated UDS config values, or sensitive tfvars.
8. Update plain-English summaries only when supported by executable configuration or clearly labeled documentation.

## Source precedence

When sources disagree, use this order:

1. Executable task definitions in `tasks.yaml` and `tasks/*.yaml`
2. Terraform and provider configuration under `iac/`
3. `bundles/swf/uds-bundle.yaml` and local Zarf package definitions
4. Environment files under `iac/env/`
5. Documentation as supporting context

Documentation marked draft, unverified, aspirational, or stale must not silently override executable configuration. Surface meaningful drift as a notice in the explorer.

## Terraform analysis requirements

- Distinguish root-managed resources/modules from `data` references and local-module internals.
- Rebuild dependencies from parsed HCL references, including explicit `depends_on` and expression references.
- Re-evaluate categories, logical systems, repeated patterns, providers, variables, outputs, tags, and environment discovery.
- Treat external module internals as module-managed unless their source is intentionally fetched and analyzed.
- Do not claim static block counts are live deployed instance counts.

## Deployment and UDS requirements

- Verify the root deployment order and the actual UDS wrapper tasks.
- Verify environment selection, plan/apply commands, backend behavior, UDS config publication, kubeconfig setup, and bundle build/deploy tasks.
- Parse bundle package names, order, versions, repositories, optional components, and local package status.
- Rebuild UDS config section names and infrastructure references from `iac/swf/uds-config.tf` without returning values.
- Verify the handoff: Terraform → Secrets Manager → `grab-uds-config` → local environment file → `UDS_CONFIG` → `uds deploy`.
- Confirm which environments are active versus vestigial from both executable configuration and operator documentation.

## Validation

After a refresh:

```bash
npm run lint
npm run build
```

Also verify:

1. `GET /api/github/infrastructure` returns HTTP 200 with no parser warnings.
2. Metrics, package counts, config-section counts, environment statuses, and source paths are plausible.
3. Every generated source link references a file present in the fresh Git tree and has a positive line number.
4. Architecture system selection displays focused components plus one-hop shared dependencies.
5. Deployment and UDS configuration tabs render at desktop and narrow widths.
6. Resource, task, package, environment, and config links open the intended GitHub source.
7. Drawers explain purpose and relationships before implementation details.

Use browser screenshots or automated browser interaction for changed tabs and graphs; do not rely only on compilation.

## Reporting

Tell the user:

- Which source revision was scanned
- What changed in infrastructure, tasks, environments, UDS config, or bundle packages
- Any source conflicts or uncertain inferences
- Validation performed
