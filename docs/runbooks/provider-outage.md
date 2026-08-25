# Runbook — Provider outage (Ticketmaster)

## Detect

- `job_runs`: `provider_refresh` rows flip to failed with transport errors;
- `/v1/admin/ingest/ticketmaster {"dryRun":true}` starts timing out;
- user-visible signal: event supply for NEW dates stops growing (existing
  canonicals keep working — ingestion is additive).

## Respond

1. Confirm scope: is the provider down, rate-limiting us, or returning
   garbage? Check their status page + one manual curl.
2. If degraded but serving: do nothing yet — the orchestrator records
   failures per candidate into `ingestion_runs.error_summary` and continues.
3. If hard-down: disable refresh without touching code —
   ```bash
   curl -X PUT /v1/admin/flags \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H 'content-type: application/json' \
     -d '{"key":"ticketmaster_enabled","enabled":false,"reason":"provider outage"}'
   ```
   The scheduled job then marks every run `skipped`.
4. Watch staleness: `/v1/ready` reports `worker: stale` past 6h without a
   successful run — expected during outages; note it in status updates.
5. On recovery: re-enable the flag; run one manual ingest; compare
   `records_created/attached/updated` against pre-outage baselines before
   declaring healthy.

## Data-integrity notes

- Canonical events are never deleted by ingestion; an outage cannot erase
  existing content.
- After recovery, canceled/postponed statuses flow in on the next refresh
  (D009 semantics) — spot-check one known-rescheduled event.
