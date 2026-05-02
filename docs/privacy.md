# Privacy Guide

## Never commit

- `.env`
- real Feishu app credentials
- browser profile folders
- `DevToolsActivePort`
- personal logs
- real runtime data under `data/*.json`
- private dashboards or local-only control panels

## Safe-to-publish approach

- commit code
- commit templates
- commit redacted sample payloads
- keep production traces and user data outside the repo

## Redaction rules used for this public repo

- local user paths were removed or replaced with environment variables
- personal dashboards were excluded
- runtime JSON storage was replaced with empty sample files
