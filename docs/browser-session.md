# Browser Session Guide

## Why a dedicated browser session exists

Login-sensitive platforms such as X, WeChat article pages, Xiaohongshu, and Douyin often fail under anonymous fetchers.

Hermes supports a dedicated browser session so the system can:

- reuse a logged-in state
- recover after disconnects
- avoid treating snippet-level fallbacks as equivalent to full article extraction

## Included scripts

- `scripts/launch-hermes-browser.cmd`
- `scripts/restart-hermes-chrome-debug.ps1`
- `scripts/start-chrome-session-proxy.ps1`
- `scripts/recover-hermes-chrome-session.sh`
- `scripts/chrome-session-proxy.js`

## Before enabling it

Set these values in `.env`:

- `HERMES_CHROME_PROXY_URL`
- `HERMES_CHROME_DEBUG_PORT`
- `HERMES_CHROME_DEVTOOLS_FILE`
- `HERMES_CHROME_SESSION_RECOVER_COMMAND`

If you are using WSL, also confirm the Windows host is reachable from WSL before expecting auto-recovery to work.
