# HEAT — Launch Readiness (evidence-based)

Every claim below links to an executable gate. If a gate cannot run, the claim
does not exist. Last verified: Phase D completion commit, 2026-08-25
(backend 100/100 local; CI PR #1 all four required checks green).

## Executable gates

| Gate | Command / location | Current state |
|---|---|---|
| Backend correctness + DB integration | `cd apps/api && npx vitest run` — **100 tests** incl. R2 regressions, ingestion replay, env isolation, worker telemetry | ✅ local green · gated in CI job `api` |
| Spatial index guard (TC-P2-004) | asserted inside `apps/api/test/enhancements.test.ts` | ✅ automated |
| Privacy boundary (no coordinate keys in analytics) | `test/remediation2.test.ts` + `integration.test.ts` | ✅ automated |
| Actor-scoped idempotency (R2-003) | `test/remediation2.test.ts` | ✅ automated |
| Personalized cache isolation (R2-002) | `test/remediation2.test.ts` | ✅ automated |
| Search lifecycle policy (R2-011) | `test/remediation2.test.ts` | ✅ automated |
| Route correlation (R2-013) | `test/remediation2.test.ts` | ✅ automated |
| iOS core logic | `cd apps/ios/HeatKit && swift test` + `swift run heatkit-check` (49 checks incl. R2-001/003/005 regressions) | ✅ local green · gated in CI job `ios-core` |
| Real app target builds & unit tests | CI job `ios-app` (`xcodegen generate` → `xcodebuild build`/`test`, simulator) | ✅ GREEN on GitHub (run 32877123837) |
| Staging archive validation (HEAT-B008) | CI job `ios-archive`: https non-placeholder API URL, staging identity, versions, MinOS 17, icon, privacy manifest | ✅ GREEN on GitHub |
| Dependency audit (prod, high+) | `npm audit --omit=dev --audit-level=high` | ✅ 0 vulnerabilities (fastify 5.12) · CI-gated |
| Migration rollback smoke | backend CI step: `migrateCli down` + re-`up` on newest migration | ✅ automated |
| Multi-replica cache contract (HEAT-C003) | `apps/api/test/envIsolation.test.ts` (shared epoch adopted per op) | ✅ automated |
| Scheduled-job telemetry (HEAT-C010) | `apps/api/test/worker.test.ts` against real PostGIS | ✅ automated |
| Environment isolation (HEAT-C011) | production rejects missing AND loopback DATABASE_URL | ✅ automated |
| Ingestion correctness (Phase D) | cancellation propagation, URL allowlist, pagination/retry, fixture guard — `test/ingestion.test.ts` | ✅ automated |
| Backup restore drill (HEAT-C008) | `scripts/db-backup.sh` → `scripts/db-restore-verify.sh`; log in `docs/runbooks/restore-db.md` | ✅ drilled 2026-08-25 (219 events restored clean) |
| Live vertical-slice narrative | `scripts/demo.sh` | ✅ reproducible |

## Status per target

- **Internal engineering demo:** READY (gates above).
- **Internal real-device pilot:** READY pending signing identity + first
  TestFlight upload (release.yml secrets: App Store Connect key, team,
  production URL). Everything else — staging config, archive validation,
  pipeline — is in place and CI-proven.
- **Closed beta:** platform code complete (Phase C/D); remaining external
  steps: provision managed PostGIS+Redis per `docs/runbooks/provision-environment.md`,
  run deploy-api with real secrets, Ticketmaster key, moderation ops
  (Phase F) before broad community creation.
- **Public beta:** additionally requires Phases E–H evidence and calibrated
  SLOs.

## Known non-gates (tracked, not claimed)

Managed instance provisioning itself (C001 partial — checklist ready),
entity-resolution review tooling beyond the audit trail (E008–E010),
moderation operations UI (F), HEAT calibration against field observations (G).
No readiness claims are made for them here.
