import { describe, expect, it } from 'vitest';
import { scanText } from '../../scripts/secret-scan.mjs';

/**
 * The secret scan is a gate, so it needs its own tests. A scanner that silently
 * stopped matching would leave every later milestone unguarded while still
 * printing "passed".
 */
describe('secret scan', () => {
  it.each([
    ['AWS access key id', 'const k = "AKIAIOSFODNN7EXAMPLE";'],
    ['GitHub token', 'token: ghp_0123456789abcdefghijklmnopqrstuvwxyz'],
    ['Slack token', 'const s = "xoxb-123456789012-abcdefghijkl";'],
    ['Stripe secret key', 'stripe = "sk_live_0123456789abcdefghij"'],
    ['private key block', '-----BEGIN RSA PRIVATE KEY-----'],
    ['generic assigned secret', 'const password = "hunter2hunter2";'],
    ['postgres URL with password', 'DATABASE_URL=postgresql://user:pw@db.example.com:5432/x'],
  ])('detects a %s', (_label, line) => {
    expect(scanText('example.ts', line)).toHaveLength(1);
  });

  it('detects a Google API key', () => {
    expect(scanText('x.ts', `key = "AIza${'b'.repeat(35)}"`)).toHaveLength(1);
  });

  it('passes clean source', () => {
    const clean = [
      'export function add(a: number, b: number) {',
      '  return a + b;',
      '}',
      'const url = process.env.DATABASE_URL;',
    ].join('\n');
    expect(scanText('clean.ts', clean)).toEqual([]);
  });

  it('honours an allow marker on the same line', () => {
    expect(scanText('x.ts', 'const password = "fixture1234"; // secret-scan-allow')).toEqual([]);
  });

  it('honours an allow marker on the line immediately above', () => {
    const text = ['// secret-scan-allow', 'const password = "fixture1234";'].join('\n');
    expect(scanText('x.ts', text)).toEqual([]);
  });

  it('does not let an allow marker two lines up disarm a match', () => {
    const text = ['// secret-scan-allow', '', 'const password = "fixture1234";'].join('\n');
    expect(scanText('x.ts', text)).toHaveLength(1);
  });

  it('tolerates a local password in a fixture file', () => {
    const line = 'POSTGRES_PASSWORD: gegs_local_dev';
    expect(scanText('docker-compose.yml', line, { isFixture: true })).toEqual([]);
  });

  it('still rejects a real cloud key inside a fixture file', () => {
    // A local development password is plausible in a fixture; an AWS key is not.
    const line = 'AWS_KEY=AKIAIOSFODNN7EXAMPLE';
    expect(scanText('docker-compose.yml', line, { isFixture: true })).toHaveLength(1);
  });

  it('reports the line number of the match', () => {
    const text = ['clean', 'clean', 'const api_key = "abcdefghijkl";'].join('\n');
    expect(scanText('x.ts', text)[0]?.line).toBe(3);
  });

  it('never returns the matched value, only its location and class', () => {
    const [finding] = scanText('x.ts', 'const password = "topsecretvalue";');
    expect(JSON.stringify(finding)).not.toContain('topsecretvalue');
    expect(finding?.name).toBe('generic assigned secret');
  });
});
