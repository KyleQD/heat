# ADR-0003 — Database: PostgreSQL 16 + PostGIS 3.4

**Status:** Accepted (matches suite default)

## Decision
PostGIS geography points; GIST spatial indexes on events/venues; pg_trgm for
title similarity. Verified via EXPLAIN that the viewport query hits
`idx_events_location_gist` (TC-P2-004). Migrations are ordered SQL files with
documented rollbacks applied by an auditable runner.

## Rollback philosophy
Additive-first; seed data never ships as migration; destructive changes require
backup + documented rollback (each migration file carries one).
