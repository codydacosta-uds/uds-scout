# SONIC source map

Scan these paths from a fresh `nswccd-devsecops/sonic-swf-iac@main` tree.

## Infrastructure definitions

- `iac/swf/**/*.tf` — primary SWF root and local modules
- `iac/bootstrap/**/*.tf` — remote state foundation
- `iac/account/**/*.tf` — account-level access foundation
- `iac/transit-gateway/**/*.tf` — post-SWF network attachment and routes
- `iac/env/*/tfvars/*.tfvars` — environment behavior; do not return sensitive values
- `iac/env/*/backends/*` — backend presence and environment readiness

## Executable deployment workflow

- `tasks.yaml` — public UDS task interface and wrappers
- `tasks/main.yaml` — orchestration and root-specific tasks
- `tasks/deploy.yaml` — apply implementation
- `tasks/destroy.yaml` — destroy implementation
- `tasks/utility.yaml` — backend, plan, config, kubeconfig, and CLI implementation
- `tasks/swf.yaml` — Zarf creation, config retrieval, and UDS bundle deployment

## UDS and application delivery

- `iac/swf/uds-config.tf` — generated shared/package configuration and infrastructure bindings
- `bundles/swf/uds-bundle.yaml` — package order, versions, repositories, overrides, and optional components
- `zarf/**/zarf.yaml` — local package composition

## Supporting documentation

- `README.md`
- `iac/swf/README.md`
- `docs/00-overview/deploy-flow.md`
- `docs/00-overview/environments.md`
- `docs/10-operators/prerequisites.md`
- `docs/10-operators/deploy-walkthrough.md`
- `docs/10-operators/post-deploy-validation.md`
- `docs/opentofu.md`

Documentation status labels matter. Draft or not-live-verified statements should appear as confidence notices instead of unquestioned facts.

## Expected conceptual flow

Validate this against current executable files every time:

```text
select stg/prd
  → bootstrap remote state
  → account access foundation
  → plan/apply SWF
  → Transit Gateway attachment
  → publish UDS config to Secrets Manager
  → configure private EKS access
  → retrieve UDS config
  → create local Zarf packages
  → build and deploy UDS bundle
  → validate
```

Do not preserve this sequence if current tasks contradict it; report and model the discrepancy.
