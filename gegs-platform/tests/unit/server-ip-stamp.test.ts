import { describe, expect, it } from 'vitest';
import type { IncomingMessage } from 'node:http';
import { sanitiseAndStampClientIp } from '../../server';
import { INTERNAL_CLIENT_IP_HEADER } from '@/lib/auth/client-ip';

/**
 * Tests the security property of the custom server directly.
 *
 * The ordering — delete every client-supplied addressing header, THEN stamp the
 * socket address — is the entire mechanism, so it is asserted here rather than
 * inferred from end-to-end behaviour.
 */
function fakeRequest(headers: Record<string, string>, remoteAddress?: string): IncomingMessage {
  return {
    headers: { ...headers },
    socket: { remoteAddress },
  } as unknown as IncomingMessage;
}

describe('server.ts client IP stamping', () => {
  it('stamps the socket address', () => {
    const req = fakeRequest({}, '203.0.113.9');
    expect(sanitiseAndStampClientIp(req)).toBe('203.0.113.9');
    expect(req.headers[INTERNAL_CLIENT_IP_HEADER]).toBe('203.0.113.9');
  });

  it('normalises an IPv4-mapped socket address', () => {
    const req = fakeRequest({}, '::ffff:203.0.113.9');
    expect(sanitiseAndStampClientIp(req)).toBe('203.0.113.9');
  });

  it.each([
    'x-forwarded-for',
    'x-real-ip',
    'x-client-ip',
    'x-cluster-client-ip',
    'x-forwarded',
    'forwarded',
    'forwarded-for',
    'true-client-ip',
    'cf-connecting-ip',
    'fastly-client-ip',
    'x-appengine-user-ip',
    'x-original-forwarded-for',
  ])('deletes the client-supplied %s', (header) => {
    const req = fakeRequest({ [header]: '198.51.100.1' }, '203.0.113.9');
    sanitiseAndStampClientIp(req);
    expect(req.headers[header]).toBeUndefined();
  });

  it('CANNOT be forged by pre-setting the internal header', () => {
    // The attack this whole design exists to stop.
    const req = fakeRequest({ [INTERNAL_CLIENT_IP_HEADER]: '198.51.100.1' }, '203.0.113.9');
    sanitiseAndStampClientIp(req);
    expect(req.headers[INTERNAL_CLIENT_IP_HEADER]).toBe('203.0.113.9');
  });

  it('strips a pre-set internal header even when the socket address is unknown', () => {
    // Must not fall back to the client's claim. Unknown means null, not
    // whatever the caller asserted.
    const req = fakeRequest({ [INTERNAL_CLIENT_IP_HEADER]: '198.51.100.1' }, undefined);
    expect(sanitiseAndStampClientIp(req)).toBeNull();
    expect(req.headers[INTERNAL_CLIENT_IP_HEADER]).toBeUndefined();
  });

  it('ignores every spoofed header at once', () => {
    const req = fakeRequest(
      {
        [INTERNAL_CLIENT_IP_HEADER]: '198.51.100.1',
        'x-forwarded-for': '198.51.100.2, 198.51.100.3',
        'x-real-ip': '198.51.100.4',
        'true-client-ip': '198.51.100.5',
        forwarded: 'for=198.51.100.6',
      },
      '203.0.113.9',
    );
    expect(sanitiseAndStampClientIp(req)).toBe('203.0.113.9');
    expect(req.headers[INTERNAL_CLIENT_IP_HEADER]).toBe('203.0.113.9');
  });

  it('leaves unrelated headers untouched', () => {
    const req = fakeRequest({ 'user-agent': 'probe/1.0', accept: '*/*' }, '203.0.113.9');
    sanitiseAndStampClientIp(req);
    expect(req.headers['user-agent']).toBe('probe/1.0');
    expect(req.headers['accept']).toBe('*/*');
  });
});
