# HEAT-101: Flow public-event bridge pilot

Status: offline adapter only; not registered with the API or worker. No live
events, accounts, infrastructure, or database records are changed.

## Verified source baselines

- HEAT main: `933943318a1d70f89468d0176837444b88bc9b10`.
- Flow foundation draft PR: https://github.com/KyleQD/Flow/pull/1
- Flow contract commit: `2522e14f56c21bce1d0bc147d27985b21b03a05d`.
- `event-publication.schema.json` is an unchanged snapshot from that commit,
  source blob `346d4607df7cc12d237697ff24f6947e37c0934a`.

Run: `node --test integrations/flow/publication.test.mjs` (Node 20+; CI Node 24).
The validator covers only the keywords of this pinned schema; it is not a
general JSON Schema engine. Updating the contract requires adapter review.

## Behavior

The reducer consumes an already trusted Tourify publication. It preserves a
namespaced source reference, validates the public field allowlist, detects
same-revision conflicts, ignores reordered/stale delivery, and retains revision
tombstones on cancellation/unpublishing. Withdrawn content is removed from the
projection. This source reference must later map to a HEAT event UUID: it does
not replace HEAT's canonical event identity or expose provider IDs to mobile.

Tests use synthetic data only. In-memory state is not restart-safe, and this
module deliberately exposes no ingest endpoint or authentication shortcut.

## Next implementation sequence

1. Locate the active Tourify source repository, production Auth issuer, user
   namespace, and public-event ownership. Flow main still contains legacy app
   code; the draft foundation is not a running shared-services backend.
2. Add a reviewed spatial contract/venue resolver. Current Flow v1 has no
   coordinates, timezone, or event category. Published projections therefore
   report `needs-spatial-enrichment`; they must not appear on the map yet.
3. Implement a Tourify transactional outbox that emits only explicitly public,
   authorized fields and monotonically increasing aggregate revisions.
4. Implement authenticated service transport with bounded payloads, retries,
   dead-letter handling, and revocation. Parsing this schema proves no rights.
5. Add a HEAT staging inbox with atomic per-source revision checks, durable
   tombstones, event/venue reference mappings and a replay audit. Run real
   PostGIS integration tests before wiring the API/worker and map cache.
6. Demonstrate publish -> update -> cancel/unpublish -> delayed replay in
   staging, including process restart and recovery. Test that private events
   never leave Tourify and removed records disappear from detail/search/map.
7. Build identity linking after issuer verification. HEAT currently creates
   anonymous users and opaque sessions (`apps/api/src/plugins/auth.ts`). Link
   accounts using proof of both identities and preserve stars/history; never
   merge by email or accept a client-supplied Flow user ID as proof.

## Validation recorded

2026-10-26: 12 offline tests passed on Node v20.19.0. Full HEAT API, PostGIS,
iOS, transport and SSO tests were not run. No merge or deployment performed.
