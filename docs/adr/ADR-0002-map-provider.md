# ADR-0002 — Map provider: Apple MapKit behind a wrapper (reversible default)

**Status:** Accepted (2026-08-24)

## Context
Suite requires evaluating Google Maps SDK vs Mapbox with a spike. Both require
commercial API keys/billing not available in this environment. Doc 17 says:
choose reversible defaults when necessary and document rather than guess silently.

## Decision
**Apple MapKit**, wrapped strictly inside `MapCanvas.swift` (+ marker view files).
No other layer imports MapKit. Capabilities demonstrated against requirements:
- Custom markers w/ heat states incl. surging pulse → EventMarkerView
- Clustering → MKAnnotationView clustering + server clusters (zoom-tap only)
- Weighted heat field → custom MKOverlay radial-gradient renderer
- Selected-marker emphasis, camera fly-to, polyline rendering, dark styling → implemented
- Licensing/cost: no additional key or per-load billing

## Consequences
Third-party map swap (if spikes later prove Mapbox superior for 500+ markers)
is confined to one file family; viewport contract (`ViewportRegion`) is
provider-neutral.

## Reversibility
High — enforced by import boundary. Documented trade-off accepted for V1.
