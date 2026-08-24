-- P2-M007/P5 — Spatial, trigram and lifecycle indexes.
-- Viewport queries MUST hit GIST(events.location) (TC-P2-004).

CREATE INDEX IF NOT EXISTS idx_events_location_gist ON events USING GIST (location);
CREATE INDEX IF NOT EXISTS idx_venues_location_gist ON venues USING GIST (location);

CREATE INDEX IF NOT EXISTS idx_events_starts_at ON events (starts_at);
CREATE INDEX IF NOT EXISTS idx_events_status_starts_at ON events (status, starts_at);
CREATE INDEX IF NOT EXISTS idx_events_visibility_starts_at ON events (visibility_status, starts_at);
CREATE INDEX IF NOT EXISTS idx_events_venue_starts_at ON events (venue_id, starts_at);
CREATE INDEX IF NOT EXISTS idx_events_normalized_title_trgm ON events USING GIN (normalized_title gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_venues_normalized_name_trgm ON venues USING GIN (normalized_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_venues_normalized_name ON venues (normalized_name);

CREATE INDEX IF NOT EXISTS idx_event_sources_event ON event_sources (event_id);
CREATE INDEX IF NOT EXISTS idx_venue_sources_venue ON venue_sources (venue_id);

CREATE INDEX IF NOT EXISTS idx_stars_event_created ON event_stars (event_id, created_at);
CREATE INDEX IF NOT EXISTS idx_stars_user_removed ON event_stars (user_id, removed_at);
CREATE INDEX IF NOT EXISTS idx_stars_event_removed_created ON event_stars (event_id, removed_at, created_at);

CREATE INDEX IF NOT EXISTS idx_interactions_event_time ON event_interactions (event_id, occurred_at);
CREATE INDEX IF NOT EXISTS idx_interactions_type_time ON event_interactions (interaction_type, occurred_at);

CREATE INDEX IF NOT EXISTS idx_route_requests_event ON event_route_requests (event_id, created_at);
CREATE INDEX IF NOT EXISTS idx_heat_snapshots_event_time ON event_heat_snapshots (event_id, calculated_at DESC);
CREATE INDEX IF NOT EXISTS idx_heat_snapshots_time ON event_heat_snapshots (calculated_at);

-- Rollback: DROP INDEX statements for each index above.
