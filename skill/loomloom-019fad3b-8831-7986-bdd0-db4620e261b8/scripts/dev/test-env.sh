#!/usr/bin/env bash
# Wrapper for the LoomLoom controlled test environment.
# The token is read from the environment and passed through the environment,
# not through argv, so it does not appear in process listings or shell history.
set -euo pipefail

: "${LOOMLOOM_TOKEN_SHENGSUANYUN_TEST:?export LOOMLOOM_TOKEN_SHENGSUANYUN_TEST=<your test key>}"

TOKEN="$LOOMLOOM_TOKEN_SHENGSUANYUN_TEST"
SERVER="${LOOMLOOM_TEST_SERVER:-https://loomloom-test.shengsuanyun.com/loom/v1}"
PROFILE="${LOOMLOOM_TEST_PROFILE:-shengsuanyun-test}"
CLI="${LOOMLOOM_CLI:-loomloom}"

usage() {
  cat <<'TXT'
usage: test-env.sh <command> [args]

  doctor
  check <template.json>
  create <template.json> [version-note]
  create-version <template-id> <template.json> [version-note]
  upload <rows.jsonl>
  run <template-id> <version-id> <input-file-id> [request-id]
  watch <run-id>
  results <run-id>
  artifacts <run-id>
TXT
}

call() { LOOMLOOM_SERVER="$SERVER" LOOMLOOM_TOKEN="$TOKEN" "$CLI" "$@"; }

action="${1:-doctor}"
shift || true

case "$action" in
  doctor)
    if [ "${LOOMLOOM_TEST_SAVE_PROFILE:-0}" = "1" ]; then
      call doctor --name "$PROFILE"
    else
      call doctor
    fi
    ;;
  check)
    spec="${1:?template.json is required}"
    call template-spec check "$spec"
    ;;
  create)
    spec="${1:?template.json is required}"
    note="${2:-v4 three-statement DCF code node}"
    call template-spec create "$spec" --version-note "$note"
    ;;
  create-version)
    template_id="${1:?template id is required}"
    spec="${2:?template.json is required}"
    note="${3:-preflight gate + model update}"
    call template-spec create-version "$template_id" "$spec" --version-note "$note"
    ;;
  upload)
    rows="${1:?rows.jsonl is required}"
    call orchestration-input upload "$rows"
    ;;
  run)
    template_id="${1:?template id is required}"
    version_id="${2:?version id is required}"
    input_file_id="${3:?input file id is required}"
    request_id="${4:-$(uuidgen 2>/dev/null || date +%s)}"
    call template-spec run "$template_id" --version-id "$version_id" --input-file-id "$input_file_id" --client-request-id "$request_id"
    ;;
  watch)
    run_id="${1:?run id is required}"
    call run watch "$run_id"
    ;;
  results)
    run_id="${1:?run id is required}"
    call run result-rows "$run_id" --output json
    ;;
  artifacts)
    run_id="${1:?run id is required}"
    call artifact list "$run_id"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    usage
    exit 1
    ;;
esac
