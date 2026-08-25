# Runbook — Roll back the API

## When

Any post-deploy regression: readiness failures, error-rate spike, wrong
business behavior. Roll back FIRST, investigate after — the schema is kept
forward-compatible so N-1 images run against N schemas.

## Steps

1. Find the last known-good image tag:
   ```bash
   gh run list --workflow=deploy-api --environment production --limit 5
   # tags look like ghcr.io/kyleqd/heat-api:<sha12>-production
   ```
2. Re-point traffic at it:
   ```bash
   ssh <host> 'sudo /opt/heat/bin/rolling-deploy ghcr.io/kyleqd/heat-api:<good-sha12>-production'
   ```
3. Confirm: `/v1/ready` 200, `/v1/metrics` error counters flat, sample one
   map/search request.

## Schema caveats

- Migrations are additive-by-default; rolling back CODE never needs a
  database change for the supported paths.
- If a bad migration already ran, use its documented rollback statement
  (every migration file ends with a `-- Rollback:` line) executed manually by
  the migrator identity — never automatic on boot.
- If data damage occurred beyond code, stop and go to `restore-db.md`.

## Escalation

If both current and previous images fail readiness: flip the load balancer
to maintenance mode, capture `/v1/metrics` output, then restore from backup.
