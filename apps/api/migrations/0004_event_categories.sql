-- P2-M002 — Canonical event categories.
CREATE TABLE IF NOT EXISTS event_categories (
  id         SERIAL PRIMARY KEY,
  key        TEXT NOT NULL UNIQUE,
  label      TEXT NOT NULL,
  parent_id  INTEGER REFERENCES event_categories(id),
  active     BOOLEAN NOT NULL DEFAULT TRUE,
  sort_order INTEGER NOT NULL DEFAULT 100
);

-- Rollback: DROP TABLE IF EXISTS event_categories;
