import { describe, expect, it } from 'vitest';
import { INTERNAL_CLIENT_IP_HEADER, normaliseIp, resolveClientIp } from '@/lib/auth/client-ip';

describe('client IP normalisation', () => {
  it.each([
    ['plain IPv4', '203.0.113.9', '203.0.113.9'],
    ['IPv4-mapped IPv6', '::ffff:203.0.113.9', '203.0.113.9'],
    ['IPv4-mapped, upper case', '::FFFF:203.0.113.9', '203.0.113.9'],
    ['loopback v4', '127.0.0.1', '127.0.0.1'],
    ['loopback v6', '::1', '::1'],
    ['global IPv6', '2001:db8::1', '2001:db8::1'],
    ['IPv6 with zone index', 'fe80::1%eth0', 'fe80::1'],
    ['surrounding whitespace', '  203.0.113.9  ', '203.0.113.9'],
  ])('normalises %s', (_label, input, expected) => {
    expect(normaliseIp(input)).toBe(expected);
  });

  it.each([
    ['null', null],
    ['undefined', undefined],
    ['empty', ''],
    ['whitespace only', '   '],
    ['not an address', 'not-an-ip'],
    ['a hostname', 'example.com'],
    ['an octet out of range', '999.1.1.1'],
    ['a comma-separated list, as X-Forwarded-For would carry', '203.0.113.9, 198.51.100.1'],
    ['an injection attempt', "127.0.0.1'; DROP TABLE users;--"],
  ])('rejects %s', (_label, input) => {
    expect(normaliseIp(input)).toBeNull();
  });

  it('reduces the mapped and plain forms of one client to a single value', () => {
    // Otherwise the same client would hold two separate throttle counters and
    // get double the allowance.
    expect(normaliseIp('::ffff:203.0.113.9')).toBe(normaliseIp('203.0.113.9'));
  });
});

describe('resolveClientIp', () => {
  it('reads the internal header that server.ts injects', () => {
    const headers = new Headers({ [INTERNAL_CLIENT_IP_HEADER]: '203.0.113.9' });
    expect(resolveClientIp(headers)).toBe('203.0.113.9');
  });

  it('returns null when the internal header is absent', () => {
    // The app run without the custom server: throttling skips rather than
    // throttling on a bogus value, and the gap shows as NULL in auth_attempts.
    expect(resolveClientIp(new Headers())).toBeNull();
  });

  it('returns null when the internal header is malformed', () => {
    expect(resolveClientIp(new Headers({ [INTERNAL_CLIENT_IP_HEADER]: 'bogus' }))).toBeNull();
  });

  it.each([
    'x-forwarded-for',
    'x-real-ip',
    'x-client-ip',
    'forwarded',
    'true-client-ip',
    'cf-connecting-ip',
    'x-cluster-client-ip',
    'x-original-forwarded-for',
  ])('ignores %s entirely', (header) => {
    // The decisive unit assertion: no forwarding header can supply an IP.
    expect(resolveClientIp(new Headers({ [header]: '198.51.100.1' }))).toBeNull();
  });

  it('prefers nothing over a forwarding header even when both are present', () => {
    const headers = new Headers({
      [INTERNAL_CLIENT_IP_HEADER]: '203.0.113.9',
      'x-forwarded-for': '198.51.100.1',
    });
    expect(resolveClientIp(headers)).toBe('203.0.113.9');
  });
});
