# HEAT — Launch Readiness (evidence-based)

Every claim below links to an executable gate. If a gate cannot run, the claim
does not exist. Last verified: Remediation Round 2 completion commit.

## Executable gates

| Gate | Command / location | Current state |
|---|---|---|
| Backend correctness + DB integration | `cd apps/api && npx vitest run` (73+ tests incl. remediation2 regressions) | ✅ local run green · gated in CI job `api` |
| Spatial index guard (TC-P2-004) | asserted inside `apps/api/test/enhancements.test.ts` | ✅ automated |
| Privacy boundary (no coordinate keys in analytics) | `test/remediation2.test.ts` + `integration.test.ts` | ✅ automated |
| Actor-scoped idempotency (R2-003) | `test/remediation2.test.ts` | ✅ automated |
| Personalized cache isolation (R2-002) | `test/remediation2.test.ts` | ✅ automated |
| Search lifecycle policy (R2-011) | `test/remediation2.test.ts` | ✅ automated |
| Route correlation (R2-013) | `test/remediation2.test.ts` | ✅ automated |
| iOS core logic | `cd apps/ios/HeatKit && swift test` + `swift run heatkit-check` (49 checks incl. R2-001/003/005 regressions) | ✅ local green · gated in CI job `ios-core` |
| Real app target builds & unit tests | CI job `ios-app` (`xcodegen generate` → `xcodebuild build`/`test`, simulator) | ✅ defined; must be green on GitHub before any release claim |
| Live vertical-slice narrative | `scripts/demo.sh` | ✅ reproducible |

## Status per target

- **Internal engineering demo:** READY (gates above).
- **Internal real-device pilot:** requires Phase B signing/TestFlight + device QA pass.
- **Closed beta:** additionally requires Phase C platform + Phase D ingestion.
- **Public beta:** additionally requires Phases E–H evidence and calibrated SLOs.

## Known non-gates (tracked, not claimed)

Production hosting, managed Postgres/Redis, provider keys (Ticketmaster),
entity-resolution engine, moderation operations tooling, HEAT calibration —
all remain open per handoff v1.1 phases C–G. No readiness claims are made for
them here.
