-- Staging proposal only. Not part of the production migration runner.
-- Run against a disposable HEAT database after its existing migrations.
CREATE SCHEMA IF NOT EXISTS flow_bridge;
REVOKE ALL ON SCHEMA flow_bridge FROM PUBLIC;

-- Bindings are installed by a reviewed server-side resolver/control plane,
-- never by the HTTP publisher. One source controls at most one dedicated row.
CREATE TABLE IF NOT EXISTS flow_bridge.event_bindings (
  source_event_id uuid PRIMARY KEY,
  heat_event_id uuid NOT NULL UNIQUE REFERENCES public.events(id),
  source_venue_id uuid NOT NULL,
  heat_venue_id uuid NOT NULL REFERENCES public.venues(id),
  expected_event_updated_at timestamptz NOT NULL
);
CREATE TABLE IF NOT EXISTS flow_bridge.inbox (
  source_event_id uuid PRIMARY KEY,
  revision bigint NOT NULL CHECK (revision > 0),
  state jsonb NOT NULL,
  hidden_by_bridge boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);
REVOKE ALL ON ALL TABLES IN SCHEMA flow_bridge FROM PUBLIC;
