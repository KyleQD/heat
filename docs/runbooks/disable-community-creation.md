# Runbook — Disable community creation

## When

Spam wave, abusive content surge, moderation backlog beyond SLA, or legal
takedown pressure. Provider ingestion and read paths stay UP — only native
creation pauses.

## Steps

```bash
curl -X PUT /v1/admin/flags \
  -H "Authorization: Bearer $ADMIN_TOKEN" \
  -H 'content-type: application/json' \
  -d '{"key":"community_creations_enabled","enabled":false,"reason":"<short reason>"}'
```

- The flag flows to clients via `/v1/config`; iOS hides the create entry
  point (offline defaults keep the LAST known value, so expect up to one
  config TTL of lag).
- Server-side enforcement: the create route rejects with
  `FEATURE_DISABLED` even if a stale client tries — client UI is a courtesy,
  never the control.

## Verify

- `POST /v1/events` → 409 `FEATURE_DISABLED`;
- map/search/detail unaffected;
- announcement in support channel referencing the reason string.

## Restore

Same call with `"enabled": true`. Review the moderation queue first —
re-enabling into an unreviewed spam pile repeats the incident.
