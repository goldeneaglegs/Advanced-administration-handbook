-- Least-privilege grants for the application's database role.
--
-- NOT run by `prisma migrate deploy`. An operator applies this once, as the
-- database owner, after the migrations. It is kept out of the migration chain
-- deliberately: the role name is environment-specific, and a migration that
-- assumes a role exists fails on a fresh database.
--
-- This is layer 2 of the append-only enforcement described in
-- 20261006120200_append_only_audit. Layer 1 (triggers) is already active.
--
-- Usage:
--   psql "$ADMIN_DATABASE_URL" -v app_role=gegs_app -f prisma/production-grants.sql
--
-- The role must already exist and have a password set out of band. This file
-- contains NO credentials and must never be given any.

\set app :app_role

-- Connect and read the schema.
GRANT CONNECT ON DATABASE :"DBNAME" TO :"app";
GRANT USAGE ON SCHEMA public TO :"app";

-- Ordinary tables: full data access, no DDL.
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO :"app";
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO :"app";

-- Audit tables: INSERT and SELECT only. No UPDATE, no DELETE, no TRUNCATE.
-- Phase 1 §2.3: tamper-resistance is a privilege, not a promise.
REVOKE ALL ON audit_log FROM :"app";
REVOKE ALL ON document_access_log FROM :"app";
GRANT SELECT, INSERT ON audit_log TO :"app";
GRANT SELECT, INSERT ON document_access_log TO :"app";

-- The application never performs DDL. Migrations run as the owner, in a
-- separate, reviewed deployment step (Phase 1 §15.2).
REVOKE CREATE ON SCHEMA public FROM :"app";

-- Future tables inherit the same shape. Without this, a table added by a later
-- migration would silently be unreachable by the application.
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO :"app";
