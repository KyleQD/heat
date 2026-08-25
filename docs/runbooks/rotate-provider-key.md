# Runbook — Rotate a provider key

Providers: Ticketmaster (primary), SeatGeek / PredictHQ (future), routing
provider. Keys live only in the runtime environment of the API/worker —
never in the repo, never in the iOS bundle.

## Routine rotation (quarterly or on demand)

1. Issue the new key in the provider's developer portal.
2. Update the secret in the environment's process manager
   (`TICKETMASTER_API_KEY=...`), keeping the old value noted.
3. Restart one API replica + the worker; confirm:
   - `POST /v1/admin/ingest/ticketmaster {"dryRun":true}` with the worker's
     identity succeeds (transport reaches the provider);
   - no new `ingestion_runs.error_summary` rows appear after the next
     scheduled `provider_refresh` job.
4. Revoke the old key at the provider.
5. Record rotation date + operator in the secrets register.

## Suspected leak

1. Revoke immediately at the provider — availability loses to safety.
2. Follow routine rotation with a fresh key.
3. Audit access logs for abuse attributable to the leaked key window.
4. If the key ever touched a machine that is not the deploy host or CI
   secrets store, treat it compromised regardless of evidence.

## Never

- commit keys or put them in issue text/screenshots;
- share keys between staging and production namespaces (HEAT-C005).
