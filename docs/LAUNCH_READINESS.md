# HEAT — Launch Readiness Assessment

Date: 2026-08-24 · Scope: public Las Vegas beta readiness (suite phases 0–17 gates)

## Verdict

**Ready for internal pilot / closed beta. Public beta has 4 open items** — all
ops/configuration, none structural: production hosting, real-device QA pass,
App Store assets/review notes, and calibrated SLO baselines.

---

## Map surface (primary product) — PASS with notes

| Requirement | Source | Status |
|---|---|---|
| App opens directly to map; overlays never replace it | 02 §17 | ✅ single root route; sheets are overlays |
| Event decision fits compact sheet | 02 §7 | ✅ heat/trend/title/venue/time/attendance/distance/star/GO/ticket above fold |
| Star & GO one primary interaction each | 02 §17 | ✅ |
| Layer ordering L1 heat < L2 markers < L3 clusters < L4 selected < L5 route | 47 §layers | ✅ renderer z-order + selected zPosition=1000 |
| Cluster tap zooms only, never selects an event | 47 | ✅ both server + client clusters |
| No flash on refresh; dataset crossfade-safe | 47 §refresh | ✅ diffed annotation sync; overlay throttled 0.8s |
| Heat not color-only | 02 §16 / a11y | ✅ glyph tiers + legend + VoiceOver pattern text |
| Score & confidence announced separately | 02 §16 | ✅ marker + list + sheet labels |
| List fallback for map interaction | 02 §16 | ✅ Nearby list sheet (distance-sorted) |
| Empty state preserves map + 3 actions | 19 §1.8 | ✅ Tonight / Expand area / Create |
| Offline keeps last data + banner | 19 §1.9 | ✅ NWPathMonitor → stale pill + banner |
| Manual pan breaks user-follow; recenter restores | 19 §1.4 | ✅ follow-user state machine |
| Rapid pan cancels obsolete queries | 19 §1.5 | ✅ debounce + Task cancellation + server single-flight |
| World-size bbox rejected | 48 acceptance | ✅ absolute caps + implied-zoom consistency check |
| Cache keys never leak starred state | 48 acceptance | ✅ user-specific requests bypass shared cache; test-enforced |
| TTL shorter for NOW than TONIGHT; invalidation on create/cancel/HEAT-change | 48 §TTL | ✅ 15s/60s; epoch bump on create/edit/material score change |
| Server simplifies rather than oversizing | 48 §budgets | ✅ zoom-aware event budgets 140/220/400; ≤200 clusters |

## Backend reliability & SLO posture

| Item | Source | Status |
|---|---|---|
| Statement timeout bounds runaway spatial queries | 76 | ✅ 8s per query, 15s idle-in-tx |
| Rate limits on every public route | 76 alerts | ✅ presets in `lib/limits.ts`; map 240/min/IP |
| Metrics endpoint (requests, latency buckets, cache hit ratio, recalc gauge) | 76/84 | ✅ `/v1/metrics` Prometheus text |
| Graceful degradation without providers | 76 dependency table | ✅ no external providers required anywhere in slice |
| Session hygiene | 62 | ✅ expiry cleanup hourly; last_seen throttled to 1/min/token |
| Error budget visibility | 76 | ⚠️ counters exist; dashboards/alerting = deploy-phase task |

## Privacy & security (beta blockers from doc 62/65)

- [x] Foreground location only; purpose string; no background permission
- [x] Exact origin transient — DB stores ~5km bucket only; analytics rejects coordinate keys at boundary (test-enforced)
- [x] Tokens in Keychain; logs redact auth headers; request IDs stable
- [x] Ownership enforced server-side (PATCH 403); moderation states filter hidden events from all reads
- [x] `PrivacyInfo.xcprivacy` manifest (no tracking, precise-location-for-functionality)
- [ ] Production secret rotation + staging/prod credential split (deploy task)

## Quality gates

| Suite | Result |
|---|---|
| Backend vitest (unit + integration + engine + enhancements) | **66 passed** |
| HeatKit check harness | **41/41** |
| Typecheck (all workspaces) / Swift build / UI parse sweep / xcodegen | clean |
| Automated query-plan guard (TC-P2-004) | GIST index asserted at 3k-row density |
| Idempotency replay + conflict | test-enforced |

## Open items before public beta

1. **Deploy**: containerized API + managed Postgres (staging→prod), CI deploys, domain/TLS.
2. **Real-device QA pass** on the iOS app (this environment type-checks logic; full Xcode build/simulator/device run remains).
3. **App Store assets**: screenshots, demo review notes (seeded LV account), age rating answers.
4. **SLO baselines**: capture p95/p99 from staging traffic, then set alert thresholds (doc 76 says don't commit SLAs pre-baseline).

## Deliberate deferrals (documented ADRs / suite scope)

- Turn-by-turn stays external (ADR-0009); provider ingestion behind flags until Phase 7+ rights confirmed; Redis-backed cache when horizontal scaling begins; snapshot retention pruning job before long-lived prod (30d default proposed).
