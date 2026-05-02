#!/usr/bin/env bash
set -euo pipefail

CMD_BIN="${HERMES_WINDOWS_CMD:-/mnt/c/Windows/System32/cmd.exe}"
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
DEFAULT_LAUNCHER_WIN="$(wslpath -w "$SCRIPT_DIR/launch-hermes-browser.cmd")"
HERMES_BROWSER_LAUNCHER_WIN="${HERMES_BROWSER_LAUNCHER_WIN:-$DEFAULT_LAUNCHER_WIN}"

"$CMD_BIN" /c "$HERMES_BROWSER_LAUNCHER_WIN"
