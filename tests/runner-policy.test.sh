#!/usr/bin/env bash
set -euo pipefail

ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
RUNNER="$ROOT/scripts/d2d-test-lab-runner"
TEMP_HOME=$(mktemp -d)
trap 'rm -rf "$TEMP_HOME"' EXIT

run_command() {
  HOME="$TEMP_HOME" SSH_ORIGINAL_COMMAND="$1" bash "$RUNNER" 2>&1
}

capabilities=$(run_command "runner-capabilities")
[[ "$capabilities" == "flavor-selection-v1" ]] || { echo "Runner capabilities changed unexpectedly." >&2; exit 1; }

if run_command "runner-capabilities unexpected" >/dev/null; then
  echo "Runner accepted unexpected capability arguments." >&2
  exit 1
fi

if run_command "prepare attacker/repository main aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa bundle 1.0.0 deploy-only -" >/dev/null; then
  echo "Runner accepted a repository outside the fixed allowlist." >&2
  exit 1
fi

if run_command "prepare uds-packages/jenkins main not-a-sha bundle 1.0.0 deploy-only -" >/dev/null; then
  echo "Runner accepted an invalid commit SHA." >&2
  exit 1
fi

if run_command "prepare uds-packages/jenkins main aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa 'bad bundle' 1.0.0 deploy-only -" >/dev/null; then
  echo "Runner accepted unsafe or unexpected metadata arguments." >&2
  exit 1
fi

if run_command "arbitrary-command" >/dev/null; then
  echo "Runner accepted an arbitrary action." >&2
  exit 1
fi

if grep -Eq '(^|[[:space:]])eval([[:space:]]|$)' "$RUNNER"; then
  echo "Runner must not evaluate SSH_ORIGINAL_COMMAND as shell code." >&2
  exit 1
fi

cleanup_command="./uds remove \"\$artifact\" --confirm --no-progress"
grep -Fq "$cleanup_command" "$RUNNER" || {
  echo "Cleanup is not pinned to the recorded bundle artifact." >&2
  exit 1
}

echo "Restricted Test Lab runner policy checks passed."
