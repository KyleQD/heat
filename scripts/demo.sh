#!/usr/bin/env bash
# HEAT demo — runs the VS-1 acceptance narrative against a live local stack.
# Usage: scripts/demo.sh          (assumes docker + deps installed)
set -euo pipefail
cd "$(dirname "$0")/.."

if [[ "${1:-}" == "--reset" ]]; then
  echo "Resetting previously demo-created events…"
  docker exec heat-db psql -U heat -d heat -c "DELETE FROM events WHERE title LIKE 'Demo Rooftop%'" >/dev/null
  echo "Done."
fi

BASE=${BASE:-http://localhost:8787/v1}
BBOX="north=36.33&south=35.98&east=-114.94&west=-115.38"

step() { printf "\n\033[1;33m▸ %s\033[0m\n" "$1"; }

step "0. Health + scoring model"
curl -s $BASE/health | python3 -c "import json,sys;d=json.load(sys.stdin);print('   API:',d['status'])"
curl -s $BASE/config | python3 -c "import json,sys;print('   engine:',json.load(sys.stdin)['scoringModelVersion'])"

step "1. Open HEAT in Las Vegas — seeded events on the map"
curl -s "$BASE/map/events?$BBOX&zoom=10&window=now" | python3 -c "
import json,sys
d=json.load(sys.stdin)
print(f\"   {len(d['events'])} events · {len(d['clusters'])} clusters · {len(d['heatPoints'])} heat points\")
for e in sorted(d['events'], key=lambda x: -x['heatScore'])[:5]:
    bar='█'*int(e['heatScore']//8)
    print(f\"   {e['heatScore']:5.1f} {bar} {e['title'][:44]} @ {e['venueName'] or 'TBA'}\")"

EVENT=$(curl -s "$BASE/map/events?$BBOX&zoom=10&window=now" | python3 -c "import json,sys;print(json.load(sys.stdin)['events'][0]['id'])")

step "2. Anonymous session (auth-on-action) + STAR the hottest event"
TOKEN=$(curl -s -X POST $BASE/auth/session | python3 -c "import json,sys;print(json.load(sys.stdin)['token'])")
echo "   session: ${TOKEN:0:14}…"
curl -s -X PUT -H "Authorization: Bearer $TOKEN" $BASE/events/$EVENT/star | python3 -c "
import json,sys;d=json.load(sys.stdin);print(f\"   starred={d['starred']} count={d['starCount']}\")"
curl -s -X PUT -H "Authorization: Bearer $TOKEN" $BASE/events/$EVENT/star > /dev/null

step "3. Starred filter shows it; double-star stayed idempotent"
curl -s "$BASE/map/events?$BBOX&zoom=10&window=now&starredOnly=true&includeStarredState=true" -H "Authorization: Bearer $TOKEN" | python3 -c "
import json,sys
evs=[e for e in json.load(sys.stdin)['events'] if e['starred']]
print(f'   {len(evs)} starred:', ', '.join(e['title'][:28] for e in evs))"

step "4. GO — route preview (drive/walk/transit), origin stays transient"
curl -s -X POST $BASE/routes/preview -H 'Content-Type: application/json' \
  -d "{\"eventId\":\"$EVENT\",\"origin\":{\"lat\":36.1147,\"lng\":-115.1728},\"modes\":[\"drive\",\"walk\",\"transit\"]}" | python3 -c "
import json,sys;d=json.load(sys.stdin)
print('   destination locked:', tuple(round(v,4) for v in d['destination'].values()))
for r in d['routes']:
    print(f\"   {r['mode']:<7} {r['durationSeconds']//60:>3} min · {r['distanceMeters']/1609:.1f} mi ({r['provider']})\")"

step "5. Create a new event from the map (idempotent publish)"
# Dev rate limit: 10 creates/hour per IP. Restart the API to reset.
HTTP() { curl -s -w "\n%{http_code}" "$@"; }
RUNTAG="$(date +%H%M%S)"
IDEM="demo-$RUNTAG"
NEW=$(HTTP -X POST $BASE/events -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $IDEM" -H "Content-Type: application/json" \
  -d '{"title":"Demo Rooftop Party '$RUNTAG'","category":"party","startsAt":"'$(date -u -v+3H +%Y-%m-%dT%H:%M:%SZ)'","endsAt":"'$(date -u -v+6H +%Y-%m-%dT%H:%M:%SZ)'","location":{"lat":36.11,"lng":-115.16}}')
CODE=$(echo "$NEW" | tail -1)
BODY=$(echo "$NEW" | head -1)
if [[ "$CODE" == "429" ]]; then
  echo "   [!] Create rate limit reached (10/hour by design). Restart the API"
  echo "       (npm run dev:api) to reset, then rerun: scripts/demo.sh --reset"
  exit 0
fi
NEWID=$(echo "$BODY" | python3 -c "import json,sys;print(json.load(sys.stdin)['event']['id'])")
echo "   created [$CODE]: Demo Rooftop Party $RUNTAG ($NEWID)"
RETRY=$(curl -s -o /dev/null -w "%{http_code}" -X POST $BASE/events -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: $IDEM" -H "Content-Type: application/json" \
  -d '{"title":"Demo Rooftop Party '$RUNTAG'","category":"party","startsAt":"'$(date -u -v+3H +%Y-%m-%dT%H:%M:%SZ)'","endsAt":"'$(date -u -v+6H +%Y-%m-%dT%H:%M:%SZ)'","location":{"lat":36.11,"lng":-115.16}}')
echo "   network-retry same key → HTTP $RETRY (replay, no duplicate)"

step "6. New event visible on TONIGHT map + duplicate guard works"
curl -s "$BASE/map/events?$BBOX&zoom=10&window=tonight" | python3 -c "
import json,sys;d=json.load(sys.stdin)
hit=[e['title'] for e in d['events'] if e['id']=='$NEWID']
print('   tonight window:', len(d['events']), 'events — includes new event:' , bool(hit))"
SEEDED_START=$(docker exec heat-db psql -U heat -d heat -tAc "SELECT EXTRACT(EPOCH FROM starts_at)::bigint FROM events WHERE title='Red Rocks Revue' LIMIT 1")
curl -s -o /dev/null -w "   re-create near-duplicate of seeded event → HTTP %{http_code} (409 = DUPLICATE_EVENT_LIKELY)\n" \
  -X POST $BASE/events -H "Authorization: Bearer $TOKEN" -H 'Content-Type: application/json' \
  -d "{\"title\":\"Red Rocks Revue\",\"category\":\"music\",\"startsAt\":\"$(date -u -r $SEEDED_START +%Y-%m-%dT%H:%M:%SZ)\",\"endsAt\":\"$(date -u -r $((SEEDED_START+7200)) +%Y-%m-%dT%H:%M:%SZ)\",\"location\":{\"lat\":36.1521,\"lng\":-115.2014}}"

step "7. Privacy + observability proof"
docker exec heat-db psql -U heat -d heat -tAc \
  "SELECT CASE WHEN origin_geo_bucket IS NULL THEN 'no origin stored' ELSE 'bucketed origin: '||origin_geo_bucket END FROM event_route_requests ORDER BY created_at DESC LIMIT 1;" | sed 's/^/   /'
curl -s $BASE/metrics | grep -E "^http_requests_total" | sort -t'"' -k2 | tail -4 | sed 's/^/   /'

printf "\n\033[1;32m✔ VS-1 narrative complete — map → event → star → GO → create, no external providers.\033[0m\n"
