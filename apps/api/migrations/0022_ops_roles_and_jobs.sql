-- Phase C — operational roles (HEAT-C002) and scheduled-job telemetry (HEAT-C010).
--
-- Role model (least privilege):
--   heat_migrator  DDL — migrations only, never the runtime API identity
--   heat_api       DML on domain tables — the API's runtime identity
--   heat_worker    DML on ops tables (ingestion runs, job runs) + read domain
--   heat_readonly  SELECT — dashboards/ad-hoc analytics
--
-- Idempotent: safe to re-run on databases where some roles already exist.

DO $$
BEGIN
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'heat_migrator') THEN
    CREATE ROLE heat_migrator NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'heat_api') THEN
    CREATE ROLE heat_api NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'heat_worker') THEN
    CREATE ROLE heat_worker NOLOGIN;
  END IF;
  IF NOT EXISTS (SELECT FROM pg_roles WHERE rolname = 'heat_readonly') THEN
    CREATE ROLE heat_readonly NOLOGIN;
  END IF;
END
$$;

CREATE TABLE IF NOT EXISTS job_runs (
  id             UUID PRIMARY KEY,
  job_name       TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'running'
                 CHECK (status IN ('running','success','failed','skipped')),
  started_at     TIMESTAMPTZ NOT NULL DEFAULT now(),
  finished_at    TIMESTAMPTZ,
  processed      INTEGER NOT NULL DEFAULT 0,
  failed         INTEGER NOT NULL DEFAULT 0,
  error_summary  TEXT
);

CREATE INDEX IF NOT EXISTS idx_job_runs_name_time ON job_runs (job_name, started_at DESC);

-- Grants: apply to every current table/sequence; new migrations should
-- re-run this grant block (or rely on default privileges below).
DO $$
DECLARE
  t TEXT;
BEGIN
  -- Migrator owns schema evolution.
  EXECUTE 'GRANT ALL PRIVILEGES ON SCHEMA public TO heat_migrator';

  -- API: full DML on everything that exists today.
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE, DELETE ON %I TO heat_api', t);
  END LOOP;

  -- Worker: reads domain data, writes ops rows; may upsert events/sources
  -- through the ingestion path.
  FOR t IN
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public'
      AND tablename IN ('events','venues','event_sources','venue_sources',
                        'event_resolution_decisions','ingestion_runs','job_runs')
  LOOP
    EXECUTE format('GRANT SELECT, INSERT, UPDATE ON %I TO heat_worker', t);
  END LOOP;
  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO heat_worker';
  EXECUTE 'GRANT INSERT, UPDATE ON job_runs TO heat_worker';
  EXECUTE 'GRANT INSERT, UPDATE ON ingestion_runs TO heat_worker';

  EXECUTE 'GRANT SELECT ON ALL TABLES IN SCHEMA public TO heat_readonly';

  -- Sequences follow the table grants.
  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO heat_api';
  EXECUTE 'GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO heat_worker';
END $$;

-- Future tables created BY THE MIGRATOR inherit sane defaults.
ALTER DEFAULT PRIVILEGES FOR ROLE heat_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO heat_api;
ALTER DEFAULT PRIVILEGES FOR ROLE heat_migrator IN SCHEMA public
  GRANT SELECT ON TABLES TO heat_readonly;
ALTER DEFAULT PRIVILEGES FOR ROLE heat_migrator IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE ON TABLES TO heat_worker;

-- Rollback: DO $$ BEGIN END $$; ALTER DEFAULT PRIVILEGES FOR ROLE heat_migrator IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM heat_api; ALTER DEFAULT PRIVILEGES FOR ROLE heat_migrator IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM heat_readonly; ALTER DEFAULT PRIVILEGES FOR ROLE heat_migrator IN SCHEMA public REVOKE ALL PRIVILEGES ON TABLES FROM heat_worker; DO $$ DECLARE r TEXT; BEGIN FOR r IN SELECT rolname FROM pg_roles WHERE rolname IN ('heat_readonly','heat_worker','heat_api','heat_migrator') LOOP EXECUTE format('REVOKE ALL PRIVILEGES ON SCHEMA public FROM %I', r); EXECUTE format('REVOKE ALL PRIVILEGES ON ALL TABLES IN SCHEMA public FROM %I', r); EXECUTE format('REVOKE ALL PRIVILEGES ON ALL SEQUENCES IN SCHEMA public FROM %I', r); END LOOP; END $$; DROP TABLE IF EXISTS job_runs; DROP ROLE IF EXISTS heat_readonly; DROP ROLE IF EXISTS heat_worker; DROP ROLE IF EXISTS heat_api; DROP ROLE IF EXISTS heat_migrator;
