# HEAT — Map-first event discovery

> Open HEAT in Las Vegas → see seeded events → select → star → switch to
> Starred → GO → preview route → launch Maps → create a new event → see it appear.
>
> Works **without any external event providers** (vertical slice VS-1).

This repository implements the HEAT handoff suite (v0.4), phases 0–6 vertical
slice plus client-visible intelligence-slice groundwork (HEAT/confidence/trend
display, heat overlay, marker priority, clusters).

---

## Repository layout

```
heat/
├── apps/
│   ├── api/                 # Fastify + TypeScript canonical API (phases 0-6)
│   │   ├── migrations/      # Ordered PostGIS SQL migrations w/ documented rollbacks
│   │   ├── seeds/           # Deterministic Las Vegas fixtures (dev/staging only)
│   │   ├── src/             # Modular monolith: map/events/stars/routing/create/search/config
│   │   └── test/            # Vitest unit + DB integration suites
│   └── ios/                 # Native iOS app (SwiftUI, iOS 17+)
│       ├── Heat/            # App shell, MapKit canvas, sheets, overlays
│       ├── HeatKit/         # Pure-Swift domain core: API client, state machines, formatters
│       ├── HeatKit/Tests    # XCTest suite (Xcode)
│       └── project.yml      # XcodeGen manifest (generates Heat.xcodeproj)
├── packages/
│   ├── domain/              # Canonical enums/types (provider-independent)
│   ├── api-contracts/       # zod schemas = the /v1 boundary; stable error codes
│   └── config/              # Feature flags + city configs + tonight-window math
├── infra/docker-compose.yml # postgis/postgis:16-3.4 on :5433
├── docs/adr/                # ADRs 0001–0006 (+0012 tonight window)
└── .github/workflows/ci.yml
```

## Quick start

```bash
# 1. Database
docker compose -f infra/docker-compose.yml up -d --wait

# 2. Migrate + seed Las Vegas fixtures
npm install
npm run db:migrate && npm run db:seed

# 3. Run the API (http://localhost:8787)
npm run dev:api

# 4. iOS app
cd apps/ios
xcodegen generate          # already generated once; re-run after adding files
open Heat.xcodeproj        # Cmd+R in Simulator
```

The app boots to a dark map centered on Las Vegas with seeded markers,
heat field, NOW/TONIGHT windows, starring, starred filter, GO route preview and
native creation — all against your local API.

### Tests

```bash
npm test                                    # API: 42 unit+integration tests (needs docker db up)
cd apps/ios/HeatKit && swift build && swift run heatkit-check   # 32 core-logic checks, no Xcode needed
```

## Product rules honored (non-negotiable list)

- Map is the primary surface; one root route; bottom-sheet detail only.
- Canonical `events.id` is the only identity mobile sees; provider IDs stay evidence.
- Stars = interest (copy says *interested*), never attendance; optimistic UI with rollback;
  one active star per user/event enforced by partial unique index; history preserved.
- HEAT score / confidence / attendance are three separate concepts; confidence is a label,
  never inferred from score color; unknown attendance renders "estimate unavailable", never invented numbers.
- Exact route origin is transient: only ~5km bucket reaches storage (DB-enforced shape).
- Foreground-only location; no background permission anywhere.
- Paid promotion cannot alter HEAT; marker priority is server-computed and auditable.
- Provider secrets never reach mobile; `/v1` responses contain zero raw provider payloads.

## Key endpoints (implemented & integration-tested)

| Method | Path | Auth | Notes |
|---|---|---|---|
| GET | `/v1/health`, `/v1/config` | – | flags + city config |
| POST | `/v1/auth/session` | – | anonymous session-on-action |
| GET | `/v1/map/events` | optional | bbox+zoom+window; bounded; clusters + heatPoints |
| GET | `/v1/events/:id` | optional | canonical detail, no raw payloads |
| PUT/DELETE | `/v1/events/:id/star` | required | idempotent, reconciled counts |
| GET | `/v1/me/starred-events` | required | sync |
| POST | `/v1/routes/preview` | optional | origin never persisted |
| POST | `/v1/routes/navigation-start` | optional | handoff intent telemetry |
| POST | `/v1/events/duplicate-check` | optional | pre-publish candidates |
| POST | `/v1/events` | required | idempotency-key; duplicate guard 409 + override header |
| GET | `/v1/search` | optional | events then venues |

Stable error codes: `INVALID_REQUEST, AUTH_REQUIRED, FORBIDDEN, RATE_LIMITED,
EVENT_NOT_FOUND, VENUE_NOT_FOUND, DUPLICATE_EVENT_LIKELY, ROUTE_UNAVAILABLE,
PROVIDER_UNAVAILABLE, LOCATION_REQUIRED, IDEMPOTENCY_CONFLICT, INTERNAL_ERROR`.

## What ships next (per suite roadmap)

Phases 7–12 attach provider ingestion, the resolution engine and the real HEAT
engine behind feature flags that already exist (`ticketmaster_enabled`,
`seatgeek_enabled`, `predicthq_enabled` …). Phases 13–17 add moderation,
privacy hardening and pilot/beta operations. The mobile contract above does not
change when those land — score/model versions ride server config.

See `docs/IMPLEMENTATION_REPORT.md` for the phase-by-phase gate status and
known issues.
