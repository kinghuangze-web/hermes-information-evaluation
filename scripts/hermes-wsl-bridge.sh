#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
BITABLE_CONFIG_PATH="${FEISHU_BITABLE_CONFIG_WSL_PATH:-}"
DEFAULT_HERMES_ROOT="/home/${USER:-user}/hermes-agent"

export HERMES_AGENT_EXECUTION_MODE="${HERMES_AGENT_EXECUTION_MODE:-hermes_profiles}"
export HERMES_AGENT_FALLBACK_LOCAL="${HERMES_AGENT_FALLBACK_LOCAL:-false}"
export HERMES_AGENT_WSL_DISTRO="${HERMES_AGENT_WSL_DISTRO:-Ubuntu-24.04}"
export HERMES_AGENT_ROOT="${HERMES_AGENT_ROOT:-$DEFAULT_HERMES_ROOT}"
export HERMES_CONTENT_PROFILE="${HERMES_CONTENT_PROFILE:-hermes-content-worker}"
export HERMES_EVALUATION_PROFILE="${HERMES_EVALUATION_PROFILE:-hermes-evaluation-worker}"
export HERMES_ACTION_PROFILE="${HERMES_ACTION_PROFILE:-hermes-action-worker}"
export HERMES_CHROME_SESSION_ENABLED="${HERMES_CHROME_SESSION_ENABLED:-true}"
export HERMES_X_ARTICLE_BROWSER_FALLBACK="${HERMES_X_ARTICLE_BROWSER_FALLBACK:-true}"
export HERMES_CHROME_SESSION_AUTORECOVER="${HERMES_CHROME_SESSION_AUTORECOVER:-true}"
export HERMES_CHROME_SESSION_RECOVER_COMMAND="${HERMES_CHROME_SESSION_RECOVER_COMMAND:-$SCRIPT_DIR/recover-hermes-chrome-session.sh}"
export HERMES_CHROME_DEBUG_PORT="${HERMES_CHROME_DEBUG_PORT:-9223}"

if [[ -z "${HERMES_CHROME_PROXY_URL:-}" ]]; then
  windows_host="$(ip route 2>/dev/null | awk '/default/ { print $3; exit }' || true)"
  if [[ -z "$windows_host" ]]; then
    windows_host="$(awk '/nameserver/ { print $2; exit }' /etc/resolv.conf 2>/dev/null || true)"
  fi
  if [[ -n "$windows_host" ]]; then
    export HERMES_CHROME_PROXY_URL="http://${windows_host}:3456"
  fi
fi

has_writer_type_arg=false
has_non_flag_arg=false
skip_next=false
for arg in "$@"; do
  if [[ "$skip_next" == "true" ]]; then
    skip_next=false
    continue
  fi

  if [[ "$arg" == "--stdin" ]]; then
    break
  fi

  if [[ "$arg" == "--data-dir" ]]; then
    skip_next=true
    continue
  fi

  if [[ "$arg" == --data-dir=* ]]; then
    continue
  fi

  if [[ "$arg" == "--writer-type" ]]; then
    has_writer_type_arg=true
    skip_next=true
    continue
  fi

  if [[ "$arg" == --writer-type=* ]]; then
    has_writer_type_arg=true
    continue
  fi

  if [[ "$arg" != --* ]]; then
    has_non_flag_arg=true
    break
  fi
done

writer_type_args=()
if [[ "$has_writer_type_arg" != "true" ]]; then
  if [[ "${HERMES_FORCE_LOCAL_WRITER:-false}" == "true" ]]; then
    writer_type_args=(--writer-type local)
  elif [[ -n "${HERMES_WRITER_TYPE:-}" ]]; then
    writer_type_args=(--writer-type "$HERMES_WRITER_TYPE")
  elif [[ -f "$BITABLE_CONFIG_PATH" ]]; then
    writer_type_args=(--writer-type bitable)
  fi
fi

if [[ "$has_non_flag_arg" == "true" ]]; then
  exec node "$SCRIPT_DIR/hermes-bridge-cli.js" "${writer_type_args[@]}" "$@"
fi

exec node "$SCRIPT_DIR/hermes-bridge-cli.js" "${writer_type_args[@]}" --stdin "$@"
