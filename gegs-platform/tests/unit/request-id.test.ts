import { describe, expect, it } from 'vitest';
import {
  REQUEST_ID_HEADER,
  isWellFormedRequestId,
  newRequestId,
  resolveRequestId,
} from '@/lib/request-id';

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

describe('request id', () => {
  it('mints a uuid when no upstream id is present', () => {
    expect(resolveRequestId(new Headers())).toMatch(UUID_RE);
  });

  it('reuses a well-formed upstream id so one request has one id end to end', () => {
    const upstream = '0192f0a1-2222-7000-8000-abcdefabcdef';
    expect(resolveRequestId(new Headers({ [REQUEST_ID_HEADER]: upstream }))).toBe(upstream);
  });

  it('generates distinct ids', () => {
    const ids = new Set(Array.from({ length: 500 }, newRequestId));
    expect(ids.size).toBe(500);
  });

  describe('validator', () => {
    it('accepts a uuid', () => {
      expect(isWellFormedRequestId('0192f0a1-2222-7000-8000-abcdefabcdef')).toBe(true);
    });

    it.each([
      ['a newline, which would forge a log line', 'abcdefgh\ninjected'],
      ['a carriage return', 'abcdefgh\rinjected'],
      ['an over-long value', 'a'.repeat(65)],
      ['a too-short value', 'abc'],
      ['a shell metacharacter', 'abcdefgh;rm -rf /'],
      ['an empty string', ''],
      ['a unicode control character', 'abcdefgh\u0000x'],
    ])('rejects %s', (_label, value) => {
      expect(isWellFormedRequestId(value)).toBe(false);
    });
  });

  describe('through a Headers object', () => {
    it.each([
      ['an over-long value', 'a'.repeat(200)],
      ['a too-short value', 'abc'],
      ['characters outside the allowed set', 'abcdefgh;rm -rf /'],
    ])('falls back to a fresh id for %s', (_label, value) => {
      const resolved = resolveRequestId(new Headers({ [REQUEST_ID_HEADER]: value }));
      expect(resolved).not.toBe(value);
      expect(resolved).toMatch(UUID_RE);
    });

    it('cannot carry a newline at all: the platform rejects it before we see it', () => {
      // Recorded as a test so this platform guarantee is not silently assumed.
      expect(() => new Headers({ [REQUEST_ID_HEADER]: 'abcdefgh\ninjected' })).toThrow();
    });
  });
});
