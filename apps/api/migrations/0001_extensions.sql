-- P2-M001 — Extensions: PostGIS spatial types + pg_trgm for title similarity.
CREATE EXTENSION IF NOT EXISTS postgis;
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- Rollback: DROP EXTENSION IF EXISTS pg_trgm; DROP EXTENSION IF EXISTS postgis;
-- (Never run the rollback while dependent tables exist.)
