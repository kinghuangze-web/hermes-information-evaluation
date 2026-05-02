# Hermes Information Evaluation System

A Feishu-first multi-agent system for content intake, evaluation, and action routing.

## What This Repo Includes

- Hermes intake and orchestration API
- Content enrichment for links, screenshots, and browser-backed extraction
- Multi-agent execution pipeline for content, evaluation, and action workers
- Feishu event intake and optional Feishu Bitable writeback
- Browser session proxy and recovery scripts for login-sensitive sites

## What This Repo Does Not Include

- Any private local dashboard or personal control panel
- Real Feishu credentials, browser profiles, or production traces
- Personal workspace data, logs, or local deployment shortcuts

## Quick Start

```bash
npm install
cp .env.example .env
npm start
```

Health check:

```bash
curl http://127.0.0.1:3000/api/v1/health
```

Example process request:

```bash
curl -X POST http://127.0.0.1:3000/api/v1/hermes/process \
  -H "Content-Type: application/json" \
  -d @examples/sample-process-payload.json
```

## Repo Layout

- `hermes/`: orchestration, enrichment, writers, and worker logic
- `routes/`: public HTTP routes
- `scripts/`: browser session, WSL, and recovery helpers
- `data/`: local runtime storage
- `docs/`: deployment, browser session, and privacy notes
- `examples/`: safe sample payloads

## Recommended Naming

- GitHub repository: `hermes-information-evaluation`
- Display name: `Hermes Information Evaluation System`

## Deployment Notes

- Start with local module mode first.
- Add Hermes Profiles, WSL bridge, and Feishu writeback only after the local flow works.
- Treat browser session automation as an optional production-like layer, not a hard requirement for first boot.

See:

- [Deployment Guide](./docs/deployment.md)
- [Browser Session Guide](./docs/browser-session.md)
- [API Guide](./docs/api.md)
- [Privacy Guide](./docs/privacy.md)

## Verification

```bash
npm run verify
```
