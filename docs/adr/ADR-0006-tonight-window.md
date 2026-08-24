# ADR-0012 — "Tonight" window definition

**Status:** Accepted (proposed value ratified)

## Decision
Tonight = **16:00 local → 06:00 next day**, evaluated in the city's IANA
timezone via calendar arithmetic (DST-safe), stored as explicit UTC bounds in
city_configs and mirrored in @heat/config + HeatKit TimeWindowResolver.
Both server and client compute identical windows (property-tested on both sides).
Configurable per city before expansion (no hard-coded Las Vegas logic).
