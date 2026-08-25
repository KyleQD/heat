# Runbook — Deploy the API

Environments: `staging` → `production` (GitHub Environments; secrets scoped
per environment). The pipeline is `.github/workflows/deploy-api.yml`.

## One-time provisioning per environment

1. **Managed PostGIS** (HEAT-C001): PostgreSQL 16-compatible with PostGIS
   3.4, automated backups + PITR, private networking. Candidates: Neon,
   Supabase (direct connection), RDS PostGIS fork, self-managed on a VPS.
2. **Redis** (HEAT-C003): managed Redis with TLS, same network as the API.
3. **Roles** (HEAT-C002): migration 0022 creates them. Provision logins:
   - `heat_migrator` login → `DEPLOY_DATABASE_URL`
   - `heat_api` login → runtime `DATABASE_URL` on the host
   - `heat_readonly` login → dashboards only
4. **Host**: any Linux box / VM running Docker with `/opt/heat/bin/rolling-deploy`
   installed (pulls image, restarts replicas behind the local LB one at a
   time, waits for each `/v1/ready` before continuing).
5. **GitHub secrets/vars**: `DEPLOY_DATABASE_URL`, `DEPLOY_HOST`,
   `DEPLOY_USER`, `DEPLOY_SSH_KEY`, var `HEAT_PUBLIC_BASE_URL`.

## Standard deploy

```text
Actions → deploy-api → Run workflow → environment
```

The pipeline enforces this fixed order:

1. build immutable `ghcr.io/kyleqd/heat-api:<sha>-<env>` image;
2. apply migrations from that image using the migrator identity;
3. rolling restart onto the new image;
4. `/v1/ready` smoke must return 200 before traffic is enabled.

## Verifying

- `/v1/ready` → all parts ok/fresh, version = git sha;
- `/v1/metrics` scrape shows request counters moving after smoke traffic.

## See also

- rollback: `rollback-api.md`
- migration policy: `14_DATABASE_MIGRATION_STRATEGY.md` (handoff suite)
