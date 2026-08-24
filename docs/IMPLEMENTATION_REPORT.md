# HEAT — Implementation Report (vertical slice build)

Date: 2026-08-24 · Builder: autonomous engineering agent · Suite: HEAT_HANDOFF_SUITE v0.4

## Completed

### Phase 0 — Foundation
- P0-001 monorepo (`heat/`): apps/api, apps/ios, packages/{domain,api-contracts,config}, infra, docs, CI.
- P0-002 env validation with fail-fast `SAFE_CONFIG_ERROR` (production requires DATABASE_URL).
- P0-003 PostGIS dev database via docker compose (postgis/postgis:16-3.4, port 5433).
- P0-006 ADR-0001 mobile runtime → native SwiftUI iOS-first (this engagement's target).
- P0-007 ADR-0002 map provider → MapKit behind single-file wrapper (reversible; no keys available for Google/Mapbox spike; documented trade-off).
- P0-008/ADR-0005 auth-on-action: anonymous server sessions + client pending-action resume.
- P0-009 city configuration table + config package (Las Vegas seeded; no hard-coded city logic in domain code).
- P0-010 feature flag layer (10 required flags) served by `/v1/config`, offline-safe defaults on device.
- P0-011 analytics taxonomy (doc 29 names) typed in HeatKit `AnalyticsClient` — payload surface cannot accept coordinates.
- P0-012 structured logging w/ request IDs + auth header redaction + latency/auth state per request.
- P0-013 CI workflow (api job w/ PostGIS service container; swift check job).
- P0-014 deterministic seed framework: stable sha1-derived UUIDs; 17 venues / 27 events covering every runbook case.

### Phase 1 — Location-aware map
- P1-001..P1-015 implemented in SwiftUI/MKMapView: boot→permission→fallback-city machine, camera command layer,
  follow-user semantics, debounced viewport fetches with cancellation, top/bottom/floating controls,
  empty/error/offline overlays preserving the map, accessibility labels incl. non-color heat glyphs.
- MAP-AC scenarios verified in integration tests (bbox correctness, tonight window, rapid-pan coalescing).

### Phase 2 — Canonical geospatial platform
- Migrations 0001–0014 per doc 31 order (+users/sessions, +heat snapshot history).
- Viewport query uses GIST index (verified via EXPLAIN — TC-P2-004 pass).
- Time-overlap window logic handles null ends_at via category-default duration in service layer only.
- Map response = bounded marker records + clusters + confidence-damped heat points. No raw payloads anywhere.
- GEO-AC-001..006 covered by tests.

### Phase 3 — Native creation
- Full create state machine (location modes: venue search/current/drop-pin), required+optional details,
  duplicate preview endpoint + review UX ("This may already be on HEAT."), publish with Idempotency-Key
  (retry-safe: same key ⇒ same canonical event, TC-P3-004 pass), native source evidence rows,
  submission audit trail, rate limits, residential-warning hook point flagged for Phase 13 policy decision.
- CRT-AC-001..006 covered by tests.

### Phase 4 — Event selection & decision surface
- Single `selectedEventId` source of truth; detail cache with aggressive-but-bounded refresh.
- Compact sheet fits all required fields above fold; expanded adds confidence label, star velocity phrase,
  price, age restriction, address, verification badge, report entry, claim entry (flag-gated).
- Attendance copy rules enforced server-side (`~12.4K–15.8K expected`) and mirrored as client fallback;
  unknown renders "Attendance estimate unavailable" — no invented numbers (EVT-AC-005).
- Ticket CTA only when URL exists; click tracked once per action.
- Canceled events render dimmed + explicit status chip (GEO-AC-004/EVT-AC-004).

### Phase 5 — Stars
- Partial unique active-star index; soft-delete history; idempotent PUT/DELETE returning reconciled counts;
  optimistic UI with rollback and per-event race guard; starred map mode via server filter (de-emphasis choice
  per doc 23 §5.7 recommendation); aggregate metrics (15m/1h/6h/24h velocity) powering "+N in the last hour".
- STAR-AC-001..006 covered by tests; privacy test asserts no user identity ever serializes to public responses.

### Phase 6 — GO/routing
- RoutingProvider interface + deterministic estimate_v1 adapter (haversine × circuity × mode speeds);
  route preview endpoint persists ONLY bucketed origin + metrics (ADR-0007); partial mode degrade;
  polyline rendering on canvas; mode chips; Start Route handoff to Apple Maps / Google Maps (web fallback);
  preview failure keeps GO usable via direct external launch (GO-AC-005).
- GO-AC-002..005 covered by tests.

## Verification

| Command | Result |
|---|---|
| `npm run db:migrate && npm run db:seed` | 14 migrations applied · 17 venues · 27 events |
| `EXPLAIN` viewport query | Index Scan using idx_events_location_gist ✔ |
| `npm test` (apps/api) | **42 passed** (unit + DB integration) |
| `swift run heatkit-check` | **32/32 assertions pass** |
| `xcodegen generate` | Heat.xcodeproj builds open-ready project (full compile requires Xcode) |
| Live curl E2E vs running API | session→star×2(idempotent)→unstar→star→starredOnly filter→detail→route preview(partial)→navigation-start→duplicate-check(0.94 match)→create(201)→retry(200 same id)→map shows new event ✔ |

## Acceptance gates

- G0..G6 phase gates: PASS (see tables above; evidence = automated suites + live E2E).
- VS-1 demo narrative executes end-to-end against local stack without external providers. PASS.

## Known issues

| Severity | Issue | Owner |
|---|---|---|
| Low | Full iOS UI compile/test requires full Xcode (CLT environment here type-checks HeatKit + parses app sources). | mobile |
| Low | Route geometry is estimate-grade (straight-line circuity) until a commercial routing key is provisioned (ADR-0002 pattern applies). | backend |
| Medium | Trend thresholds are seed hypotheses; must move into versioned scoring config before HEAT engine lands (P11). | data-science |

## Next-phase dependencies

- Phase 7+: provider credentials + commercial terms confirmation (stop-condition per master prompt).
- Phase 13: report endpoint wiring exists client-side; backend `/v1/events/:id/reports` lands with moderation module.
- Claim flow UI stubbed behind `event_claims_enabled=false`; enable after verification service design.

## Tracker

Canonical tracker updated in `docs/PROGRESS_TRACKER.md`.

---

# Enhancement Round — 2026-08-24 (optimization + intelligence groundwork)

## Completed

### HEAT engine v0.1 (P11 groundwork) — live scores replace static seeds
- `src/modules/heat/engine.ts`: typed-signal scoring (stars 15m/1h/6h/active,
  selects/ticket-clicks/route-previews/navigation-starts per hour), lifecycle
  phase weights per doc 43, **unknown Presence renormalized (never zero)**,
  log-normalized Expected so stadiums don't consume the scale, intent ladder
  `view < select < star < ticket/route < navigation`, momentum vs 6h baseline.
- Independent confidence model: evidence classes from verification level +
  source count + sample size; **anomaly penalty** when prediction > 3× capacity.
- Attendance ranges preserve uncertainty (±25% forecast band, intent-nudged).
- Every calculation writes an inspectable snapshot row (components, phase,
  model version); canonical columns update atomically.
- Recalculation scheduler: star mutations mark events dirty; a coalescing
  sweeper flushes every 20s (no global recompute per star). Model version now
  reported by `/v1/config` as `heat-v0.1-engine`.
- Verified live: star → score 68.2→74.9, confidence 70.8→72.4, snapshots stored.

### Map query cache (doc 48 semantics)
- TTL LRU keyed by ~1.1km quantized viewport cell × zoom band × window ×
  filters; user-specific (star-state) responses are never cached; epoch bump
  invalidates on canonical create/edit. NOW=15s, TONIGHT=60s.

### New endpoints
| Method | Path | Behavior |
|---|---|---|
| PATCH | `/v1/events/:id` | creator-only native edit (title/desc/time/ticket URL), server-side ownership check (403 FORBIDDEN), time validation |
| POST | `/v1/events/:id/reports` | 12-reason enum per moderation spec §13.3, confirmation-only body, stricter rate limit |
| POST | `/v1/analytics/batch` | privacy-enforced ingestion: payloads containing coordinate keys rejected outright; event-scoped taxonomy mapped into interaction telemetry and fed to HEAT recalc |

### Hardening
- Idempotency-Key reuse with a *different* payload now returns stable
  `IDEMPOTENCY_CONFLICT` (payload hash stored on submissions).
- Viewport SQL: correlated star-velocity subquery replaced with indexed
  LATERAL join; new covering index `idx_stars_velocity_active`.
- TC-P2-004 automated: EXPLAIN must hit `idx_events_location_gist` at
  pilot-scale density (test seeds/cleans 3k synthetic rows).

### iOS enhancements
- Fixed latent compile blockers: added missing `PolylineDecoder` (spec-correct:
  chars offset −63 before bit extraction — round-trip tested), removed invalid
  camera call, DI for ReportSheet.
- Deep links `heat://event/<id>` (+ https heat.app host): parse → select → fly →
  open sheet, foreign hosts/bad UUIDs rejected.
- Keychain session persistence (`KeychainTokenStore`), analytics batching to the
  new endpoint (silent-failure by design), star haptics, selected-event 30s
  staleness refresh (P4-010), flag-gated GO/star buttons, venue search inline in
  create-location mode.

## Verification

| Check | Result |
|---|---|
| Backend suites | **66 passed** (24 new: engine scenarios ×10, cache ×3, reports ×2, PATCH ×1, batch ×3, idempotency ×2, query-plan ×1, wiring ×2) |
| HeatKit harness | **41/41** (+polyline round-trip, deep-link parsing incl. hostile inputs) |
| Live E2E | star+telemetry → recalc delta observed in snapshots; reports 201; coord-key rejection 400 |
| Typechecks / UI parse / xcodegen | clean |

## Known issues (updated)

| Severity | Issue | Owner |
|---|---|---|
| Low | Full Xcode still required for final iOS binary (CLT environment). | mobile |
| Medium | Engine weights are seed hypotheses; move to DB-backed config rows before shadow-model rollout (doc 46). | data-science |
| Low | Cache is single-instance in-memory; horizontal deployments need Redis or sticky map nodes. | backend |
