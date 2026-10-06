-- Baseline migration: extensions only. No business tables.
--
-- citext backs users.email in the approved Phase 1 §2.2 schema. Email
-- addresses are case-insensitive in practice, and enforcing that in the column
-- type means a UNIQUE constraint cannot be defeated by changing capitalisation
-- — a real account-takeover vector if left to application-level lowercasing.
CREATE EXTENSION IF NOT EXISTS citext;

-- pgcrypto supplies gen_random_bytes() for server-side token generation.
CREATE EXTENSION IF NOT EXISTS pgcrypto;
