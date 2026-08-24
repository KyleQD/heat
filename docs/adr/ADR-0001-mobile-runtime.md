# ADR-0001 — Mobile runtime: native iOS (SwiftUI) first

**Status:** Accepted (2026-08-24)

## Context
Doc suite leaves mobile runtime open (React Native vs native iOS+Android vs Flutter).
This engagement targets an **iOS app** explicitly; the handoff also lists
"iOS-first" as an open question.

## Options considered
1. React Native (suite default recommendation, pending map spike)
2. Native iOS + Android
3. Flutter

## Decision
**Native iOS (SwiftUI, iOS 17+) first.** Rationale:
- Map-first product with bottom-sheet-heavy interaction benefits from UIKit/MKMapView maturity.
- No JS bridge in the hottest render path (markers/heat overlay).
- Product rule "one root route + overlays" maps cleanly to a single SwiftUI surface.

## Consequences
Android parity deferred (explicitly allowed: open question in Phase 0 spec).
Business logic lives in `HeatKit` (pure Swift package, platform-independent,
fully unit-tested) so a future Android client reimplements only UI + transport.

## Reversibility
HeatKit isolates domain logic; API contracts are provider/runtime independent.
Reversing this decision costs the app shell only.

## Validation
- HeatKit check harness: 32/32 assertions green.
- Backend integration suite exercises every endpoint the app consumes.
