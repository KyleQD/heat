# HEAT-101: Flow public-event bridge pilot

Status: isolated staging sender/receiver and durable inbox; not registered with
the HEAT API or worker. No live events, accounts, infrastructure, or database
records are changed.

## Verified source baselines

- HEAT main: `933943318a1d70f89468d0176837444b88bc9b10`.
- Flow foundation draft PR: https://github.com/KyleQD/Flow/pull/1
- Flow contract commit: `2522e14f56c21bce1d0bc147d27985b21b03a05d`.
- `event-publication.schema.json` is an unchanged snapshot from that commit,
  source blob `346d4607df7cc12d237697ff24f6947e37c0934a`.

Run: `node --test integrations/flow/*.test.mjs` (Node 20+; CI Node 24).
The validator covers only the keywords of this pinned schema; it is not a
general JSON Schema engine. Updating the contract requires adapter review.

## Behavior

The reducer consumes an already trusted Tourify publication. It preserves a
namespaced source reference, validates the public field allowlist, detects
same-revision conflicts, ignores reordered/stale delivery, and retains revision
tombstones on cancellation/unpublishing. Withdrawn content is removed from the
projection. This source reference must later map to a HEAT event UUID: it does
not replace HEAT's canonical event identity or expose provider IDs to mobile.

Tests use synthetic data only. `receiver.mjs` now exposes a loopback-only staging
POST endpoint, authenticated with timestamped HMAC over exact body bytes,
method and path. The public API has no route to this receiver. The sender
validates public projections and blocks redirects and unencrypted non-loopback
destinations. It never queries Tourify or sends raw database rows.

`store.mjs` saves each projection using write/fsync/atomic rename/directory
fsync, serializes revisions, and keeps an exclusive writer lease. Orderly
restart preserves revisions and tombstones. After a process crash the stale
`.writer-lock` must be removed manually only after confirming no writer is
running. This is a single-host staging store, not the production PostGIS inbox.
The staging directory must be dedicated, private, persistent and outside git;
it must not be placed on a network filesystem. Public content is removed from
the current file on retraction; filesystem snapshots/backups may retain older
versions and need their own retention policy.

## Run the isolated staging bridge

Supply a dedicated test key (at least 32 bytes) and key ID using
`FLOW_BRIDGE_SECRET` and `FLOW_BRIDGE_KEY_ID`. Set `FLOW_BRIDGE_STATE_DIR` to a
dedicated directory outside this checkout. Then run:

```sh
node integrations/flow/serve.mjs
```

It listens only on `127.0.0.1:8790` (override `FLOW_BRIDGE_PORT`). Production mode
is refused. The only routes are GET `/health` and POST
`/internal/flow/event-publications`; there is no public event read endpoint.
Use `deliverPublication` from `sender.mjs` with an authorized contract payload.
The publisher must persist/retry its outbox separately; the helper performs one
attempt, classifies 429/5xx as retryable, and surfaces other failures for review.
Do not expose the staging receiver publicly or reuse a production secret.
HMAC authenticates the dedicated publisher service, not an end user's right to
publish. Publication consent/authorization must be enforced in Tourify first.

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

2026-10-26: initial 12 projection tests passed locally and in GitHub Node 24 CI.
Follow-up adds durable-inbox/HMAC tests plus real loopback HTTP lifecycle tests.
Local socket tests are blocked by sandbox `listen EPERM`; CI must certify them.
Full HEAT API CI at the initial PR commit failed on three high-severity dependency
findings (fast-uri, Fastify, Zod); no dependency audit gate was weakened.
Production PostGIS, Tourify publishing authorization, native shared login and
live sync remain unverified. No merge or deployment performed.

## Source authority discovered on 2026-10-26

`KyleQD/Tourify-platform` main at
`4f6e05c51fe940a5cf8bd7f492e784bf1e3bd14a` contains a recovery proposal, not
the serving application. Its reconciliation ledger identifies legacy
`KyleQD/Tourify` at `76d8389ebf939cee70f7070abf74a6bacc46f5de` as serving source
and says the new repository has no production Vercel linkage. This is recorded
source evidence; current provider/database state was not independently attested.
The discovery route combines `events`, `events_v2`, and `artist_events`, so a
publisher must establish canonical identity/ownership instead of exporting
the discovery JSON wholesale. Existing route payloads are not the allowlisted
Flow contract. The source Auth helper uses `NEXT_PUBLIC_SUPABASE_URL`; its actual
serving value and signing issuer are not established by the code.
