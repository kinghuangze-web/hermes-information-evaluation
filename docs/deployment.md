# Deployment Guide

## Local-first setup

1. Install Node.js 18 or later.
2. Run `npm install`.
3. Run `npm run setup:local`.
4. Keep `HERMES_AGENT_EXECUTION_MODE=local_modules` for the first run.
5. Start the API with `npm start`.

After the first successful request, you should see runtime JSON files appear inside `./data`.

## First-run expectations

- No WSL required
- No Feishu credentials required
- No browser login required
- No external monitor required

If you only want to prove the repo can run, stay in this mode first.

## Production-like setup

Add these layers one by one:

1. Hermes Profiles in WSL
2. Dedicated browser session with remote debugging
3. Chrome session proxy
4. Feishu event webhook
5. Feishu Bitable writer

Do not enable all of them at once on a fresh machine.

## Data layout

- Runtime data lives in `./data` by default.
- Override it with `HERMES_DATA_DIR`.
- Do not commit runtime JSON files.

## Optional monitor

This public repo ships the core API only.

If you want a separate status page or control panel, deploy it as a standalone module that talks to:

- `GET /api/v1/hermes/monitor/overview`
- `GET /api/v1/hermes/monitor/runs`
- `GET /api/v1/hermes/monitor/runs/:runId`
