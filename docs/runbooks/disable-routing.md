# Runbook — Disable routing

## When

The GO/route-preview path degrades (routing provider outage, abusive origin
probing, cost spike). Discovery and detail must keep working.

## Degradation ladder (prefer the lowest rung that fixes it)

1. **Single bad route provider**: switch `ROUTING_PROVIDER` env to
   `estimate_v1` (deterministic haversine fallback) on API replicas. No user
   feature is lost — ETA becomes estimate-grade.
2. **Route previews abused/expensive**: disable via flag —
   ```bash
   curl -X PUT /v1/admin/flags \
     -H "Authorization: Bearer $ADMIN_TOKEN" \
     -H 'content-type: application/json' \
     -d '{"key":"go_routing_enabled","enabled":false,"reason":"<reason>"}'
   ```
   Clients fall back to direct external launch (Apple/Google Maps) which
   needs no server route.
3. **Emergency**: block `/v1/routes/*` at the load balancer (rate-limit to
   zero). Fastest lever; use when the API itself is struggling.

## Verify

- `POST /v1/routes/preview` behaves per chosen rung (200 estimate / 409
  disabled);
- navigation-start telemetry still records (intent data survives outages).

## Restore

Reverse in order, one rung at a time, watching latency + error rates for at
least 15 minutes between steps.
