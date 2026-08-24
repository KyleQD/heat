
---
# BUILD STATUS UPDATE — 2026-08-24 (vertical slice implementation)

| Phase | Status | Evidence |
|---|---|---|
| 0 Foundation | ✅ COMPLETE | monorepo, PostGIS via docker, env validation, flags, city config, analytics taxonomy, logging/request IDs, CI, deterministic seeds, ADRs 0001–0006 |
| 1 Map | ✅ COMPLETE | SwiftUI map screen + MKMapView wrapper, permission/fallback flows, debounce+cancel viewport, controls, empty/offline overlays |
| 2 Canonical platform | ✅ COMPLETE | migrations 0001–0014, GIST-verified viewport query, detail API, LV fixtures |
| 3 Native creation | ✅ COMPLETE | full state machine, duplicate preview/guard/override, idempotent publish, native source evidence |
| 4 Selection/sheet | ✅ COMPLETE | compact+expanded sheet, detail cache, attendance/confidence copy rules, ticket CTA |
| 5 Stars | ✅ COMPLETE | partial unique index, idempotent API, optimistic UI w/ rollback, starred mode, aggregates |
| 6 GO/routing | ✅ COMPLETE | provider interface + estimate adapter, preview endpoint (bucketed origin), polyline, Apple/Google handoff, fallbacks |

**VS-1 gate: PASS** — demo narrative runs end-to-end without external providers.
Tests: backend 42 passed · HeatKit check 32/32 · spatial index verified via EXPLAIN.

Original tracker follows.
---
# HEAT — Development Progress Tracker

Use this file as the living implementation checklist.

Status convention:
- [ ] Not started
- [~] In progress (convert manually when used in systems that support it)
- [x] Complete

---

## Phase 0 — Foundation
- [ ] Lock V1 scope
- [ ] Select mobile architecture
- [ ] Compare Google Maps vs Mapbox/native options
- [ ] Select backend framework
- [ ] Provision PostgreSQL
- [ ] Enable PostGIS
- [ ] Establish auth
- [ ] Create dev/staging/prod
- [ ] Configure secrets
- [ ] CI
- [ ] lint/typecheck/test pipeline
- [ ] analytics event naming spec
- [ ] feature flag framework
- [ ] provider terms/licensing tracker
- [ ] Las Vegas bounds config

**Gate:** [ ] Foundation approved

---

## Phase 1 — Map
- [ ] Map shell
- [ ] foreground location permission
- [ ] current location marker
- [ ] recenter
- [ ] pan
- [ ] zoom
- [ ] no-location fallback
- [ ] search affordance
- [ ] Now filter
- [ ] Tonight filter
- [ ] Starred affordance
- [ ] Create button
- [ ] map crash/error telemetry
- [ ] accessibility labels

**Gate:** [ ] Stable location-aware map

---

## Phase 2 — Canonical data
- [ ] venues table
- [ ] venue_sources table
- [ ] events table
- [ ] event_sources table
- [ ] categories
- [ ] PostGIS indexes
- [ ] event lifecycle
- [ ] map query endpoint
- [ ] event detail endpoint
- [ ] Las Vegas seed data
- [ ] query performance tests

**Gate:** [ ] Canonical events render by viewport

---

## Phase 3 — Native creation
- [ ] enter create mode
- [ ] venue search
- [ ] current location
- [ ] drop pin
- [ ] title
- [ ] category
- [ ] start/end
- [ ] optional details
- [ ] duplicate check
- [ ] publish API
- [ ] idempotency
- [ ] edit own event
- [ ] native trust badge
- [ ] creation analytics

**Gate:** [ ] User-created event appears on map

---

## Phase 4 — Event selection
- [ ] selected marker
- [ ] compact bottom sheet
- [ ] expanded sheet
- [ ] HEAT display placeholder
- [ ] confidence display
- [ ] attendance range
- [ ] ticket action
- [ ] verification badge
- [ ] report action placeholder
- [ ] long-title QA
- [ ] canceled state
- [ ] ended state

**Gate:** [ ] Event can be evaluated without leaving map

---

## Phase 5 — Stars
- [ ] event_stars schema
- [ ] unique active constraint
- [ ] star API
- [ ] unstar API
- [ ] optimistic UI
- [ ] star count
- [ ] star metrics
- [ ] starred filter
- [ ] auth-on-action
- [ ] telemetry
- [ ] rate limit
- [ ] abuse rule baseline

**Gate:** [ ] Stars reliably persist and filter

---

## Phase 6 — GO
- [ ] route abstraction
- [ ] route provider
- [ ] route preview API
- [ ] route preview UI
- [ ] drive
- [ ] walk
- [ ] transit handling
- [ ] bike handling
- [ ] polyline
- [ ] ETA
- [ ] distance
- [ ] navigation handoff
- [ ] route analytics
- [ ] exact-origin nonretention audit

**Gate:** [ ] Select → GO → external navigation works

---

## Phase 7 — Ticketmaster
- [ ] credentials
- [ ] adapter
- [ ] paging
- [ ] time/geo query
- [ ] normalize event
- [ ] normalize venue
- [ ] raw payload storage
- [ ] source mapping
- [ ] refresh scheduling
- [ ] quota monitoring
- [ ] ticket URL
- [ ] status updates
- [ ] stale source handling

**Gate:** [ ] Real events ingest cleanly

---

## Phase 8 — SeatGeek
- [ ] adapter
- [ ] normalize
- [ ] venue mapping
- [ ] event matching
- [ ] price signals
- [ ] listing count
- [ ] popularity signal
- [ ] rate monitoring

**Gate:** [ ] Enriches without duplicate pins

---

## Phase 9 — PredictHQ
- [ ] access/licensing confirmed
- [ ] adapter
- [ ] predicted attendance
- [ ] local impact/rank
- [ ] freshness
- [ ] matching
- [ ] expected-score signal integration

**Gate:** [ ] Attendance estimates available where supported

---

## Phase 10 — Resolution
- [ ] normalize titles
- [ ] venue resolver
- [ ] candidate search
- [ ] match scoring
- [ ] exact ID rules
- [ ] anti-merge rules
- [ ] decision audit
- [ ] ambiguity review
- [ ] manual merge
- [ ] split/reversal
- [ ] Las Vegas truth corpus
- [ ] precision metrics
- [ ] recall metrics

**Gate:** [ ] Duplicate quality target achieved

---

## Phase 11 — HEAT
- [ ] signal observations
- [ ] Expected score
- [ ] Intent score
- [ ] Presence score baseline
- [ ] Momentum score
- [ ] lifecycle weighting
- [ ] confidence
- [ ] attendance low/high
- [ ] trend state
- [ ] snapshots
- [ ] model config
- [ ] model versioning
- [ ] shadow scoring support
- [ ] scoring diagnostics

**Gate:** [ ] Reproducible HEAT score + confidence

---

## Phase 12 — Heat map
- [ ] heat point generation
- [ ] marker priority
- [ ] cluster behavior
- [ ] zoom thresholds
- [ ] weighted heat overlay
- [ ] selected marker layering
- [ ] starred styling
- [ ] surging animation
- [ ] dense Strip performance
- [ ] accessibility fallback

**Gate:** [ ] City feels alive and readable

---

## Phase 13 — Trust/moderation
- [ ] event_reports
- [ ] report UI
- [ ] event_claims
- [ ] claim UI
- [ ] verification workflow
- [ ] admin moderation
- [ ] hide/remove
- [ ] scam link review
- [ ] creator trust
- [ ] audit log

**Gate:** [ ] Bad data can be corrected safely

---

## Phase 14 — Privacy/security
- [ ] public API data audit
- [ ] location retention audit
- [ ] RLS/access control audit
- [ ] admin role audit
- [ ] rate limits
- [ ] provider secret audit
- [ ] ticket URL validation
- [ ] account deletion
- [ ] star deletion behavior
- [ ] app permission disclosure
- [ ] security tests

**Gate:** [ ] No critical privacy/security blockers

---

## Phase 15 — Las Vegas internal
- [ ] venue truth set
- [ ] Strip coverage
- [ ] Downtown coverage
- [ ] Arts District coverage
- [ ] AREA15 coverage
- [ ] nightly data QA
- [ ] duplicate review
- [ ] missing-event review
- [ ] HEAT observation sessions
- [ ] route field testing
- [ ] crash/performance dashboards

**Gate:** [ ] Internal pilot usable on real night out

---

## Phase 16 — Closed beta
- [ ] beta cohort
- [ ] onboarding
- [ ] event-decision dashboard
- [ ] feedback collection
- [ ] score tuning
- [ ] moderation coverage
- [ ] defect triage
- [ ] retention analysis

**Gate:** [ ] Clear user utility validated

---

## Phase 17 — Public beta
- [ ] app store readiness
- [ ] privacy policy
- [ ] terms
- [ ] support process
- [ ] incident response
- [ ] public moderation
- [ ] provider SLA monitoring
- [ ] launch dashboard
- [ ] city expansion gate defined

**Gate:** [ ] Las Vegas public beta launched

---
# ENHANCEMENT ROUND UPDATE — 2026-08-24

- P11 groundwork: HEAT engine v0.1 live (typed signals, lifecycle weights,
  independent confidence, anomaly penalties, snapshot history, dirty-set sweeper).
- Doc 48 cache semantics implemented; create/edit invalidation.
- P3-014 creator edit shipped; P13 report endpoint live behind V1 baseline;
  analytics ingestion boundary rejects raw coordinates.
- Idempotency conflict detection; viewport LATERAL optimization + covering index.
- iOS: deep links, Keychain sessions, haptics, auto-refresh policy, polyline
  decoder fix, venue search in creation.
- Suites: backend 66 ✓ · HeatKit 41 ✓ · live recalculation demonstrated.
