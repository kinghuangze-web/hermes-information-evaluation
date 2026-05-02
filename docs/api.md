# API Guide

## Health

`GET /api/v1/health`

Returns a simple health payload for local checks and process supervision.

## Process content

`POST /api/v1/hermes/process`

Example payload:

```json
{
  "rawText": "Please evaluate this source.",
  "links": ["https://example.com/article"],
  "images": [],
  "attachments": [],
  "sourcePlatform": "manual",
  "sourceType": "text"
}
```

## Feishu events

`POST /api/v1/hermes/feishu/events`

Use this endpoint for:

- Feishu `url_verification`
- Feishu message events that should trigger Hermes intake

## Monitor endpoints

- `GET /api/v1/hermes/monitor/overview`
- `GET /api/v1/hermes/monitor/runs`
- `GET /api/v1/hermes/monitor/runs/:runId`

These endpoints are intended for an optional standalone monitor UI, not a private personal dashboard.
