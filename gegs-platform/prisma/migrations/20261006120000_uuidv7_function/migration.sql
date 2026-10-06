-- UUIDv7 generation.
--
-- Phase 1 §2.1 requires UUIDv7 primary keys: time-ordered, so they cluster well
-- in a B-tree index, but not sequential, so one candidate cannot guess another
-- candidate's record id by incrementing their own.
--
-- PostgreSQL 16 has no built-in uuidv7(); it arrives in PostgreSQL 18. This
-- function provides it until then. When the database is upgraded to 18 the
-- column defaults can be repointed at the built-in and this function dropped —
-- the stored values are identical either way, because both implement RFC 9562.
--
-- Layout (RFC 9562 §5.7):
--   bytes 0-5   48-bit big-endian Unix timestamp in milliseconds
--   byte  6     high nibble = version (7), low nibble = random
--   bytes 7     random
--   byte  8     top two bits = variant (0b10), rest random
--   bytes 9-15  random
CREATE OR REPLACE FUNCTION uuidv7() RETURNS uuid
LANGUAGE plpgsql
VOLATILE
PARALLEL SAFE
AS $$
DECLARE
  ts_millis bigint;
  bytes     bytea;
BEGIN
  ts_millis := (extract(epoch FROM clock_timestamp()) * 1000)::bigint;

  -- int8send gives 8 big-endian bytes; take the low 6 (substring is 1-indexed).
  -- 48 bits of milliseconds overflows in the year 10889, which is sufficient.
  bytes := substring(int8send(ts_millis) FROM 3 FOR 6) || gen_random_bytes(10);

  -- Version 7 into the high nibble of byte 6, preserving the random low nibble.
  bytes := set_byte(bytes, 6, 112 | (get_byte(bytes, 6) & 15));

  -- Variant 0b10 into the top two bits of byte 8, preserving the low 6 bits.
  bytes := set_byte(bytes, 8, 128 | (get_byte(bytes, 8) & 63));

  RETURN encode(bytes, 'hex')::uuid;
END;
$$;

COMMENT ON FUNCTION uuidv7() IS
  'RFC 9562 UUIDv7. Time-ordered for index locality, random for unguessability. Replace with the built-in uuidv7() on PostgreSQL 18+.';

-- Shared updated_at trigger. Set by the database rather than the application so
-- that a direct SQL fix during an incident cannot leave a stale timestamp.
CREATE OR REPLACE FUNCTION set_updated_at() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;
