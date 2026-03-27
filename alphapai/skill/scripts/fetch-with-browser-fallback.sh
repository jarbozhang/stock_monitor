#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
SCRAPER="$SCRIPT_DIR/scraper.mjs"
REFRESH="$SCRIPT_DIR/refresh-auth-via-agent-browser.sh"

TMP_LOG="$(mktemp)"
cleanup() { rm -f "$TMP_LOG"; }
trap cleanup EXIT

set +e
node "$SCRAPER" "$@" 2>&1 | tee "$TMP_LOG"
status=${PIPESTATUS[0]}
set -e

if [[ $status -eq 0 ]]; then
  exit 0
fi

if grep -Eq 'unauthorized|认证失败|缺少或失效' "$TMP_LOG"; then
  echo "[alphapai-reader] auth failed, refreshing via agent-browser..." >&2
  "$REFRESH" "${ALPHAPAI_PHONE:-}" "${ALPHAPAI_PASSWORD:-}"
  echo "[alphapai-reader] retrying scraper after browser login..." >&2
  exec node "$SCRAPER" "$@"
fi

exit $status
