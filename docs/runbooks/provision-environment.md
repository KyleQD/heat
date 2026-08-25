# Runbook — Provision an environment (staging / production)

One checklist per environment. Nothing here should depend on a developer's
laptop (Phase C gate).

## 1. Managed PostGIS (HEAT-C001)

- [ ] PostgreSQL 16-compatible + PostGIS 3.4
- [ ] Automated daily backups AND point-in-time recovery enabled
- [ ] Private networking / IP allowlist; TLS required
- [ ] Two instances minimum: staging and production are NEVER shared
- [ ] Logins created for roles from migration 0022:
      `heat_migrator`, `heat_api`, `heat_worker`, `heat_readonly`
      (grant each a LOGIN password; record in the secrets manager)

## 2. Redis (HEAT-C003)

- [ ] Managed Redis w/ TLS, same private network as the API
- [ ] `maxmemory-policy allkeys-lru`; ≥128 MB for beta scale
- [ ] Separate instance per environment

## 3. Host(s)

- [ ] Linux + Docker, reachable by GitHub Actions over SSH
- [ ] `/opt/heat/bin/rolling-deploy <image>` installed (pull → restart each
      replica behind LB → wait for `/v1/ready`)
- [ ] Runtime identity uses the `heat_api` login (`DATABASE_URL`) — never
      migrator, never superuser
- [ ] Worker service runs `npx tsx apps/api/src/worker.ts` with its own
      `heat_worker` login

## 4. Secrets (HEAT-C005) — in the platform's secrets store only

| Secret | Used by |
|---|---|
| `DEPLOY_DATABASE_URL` | CI migrations (migrator login) |
| `DATABASE_URL` | runtime host (api login) |
| `REDIS_URL` | runtime host |
| `ADMIN_TOKEN` | runtime host |
| `TICKETMASTER_API_KEY` | runtime host (worker + ingest endpoint) |

Staging and production namespaces are fully separate; rotation per
`rotate-provider-key.md`.

## 5. GitHub wiring

- [ ] Environments `staging` and `production` created; production requires
      manual approval
- [ ] Secrets above attached to their environment
- [ ] Var `HEAT_PUBLIC_BASE_URL` set per environment

## 6. Acceptance (environment is "real" when…)

- [ ] `deploy-api` workflow completes green end-to-end
- [ ] `/v1/ready`: database ok, cache ok, worker fresh
- [ ] One backup created AND restore-drilled (`restore-db.md` log updated)
