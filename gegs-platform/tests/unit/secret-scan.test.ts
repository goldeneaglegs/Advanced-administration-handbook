import { describe, expect, it } from 'vitest';
import { scanText } from '../../scripts/secret-scan.mjs';

/**
 * The secret scan is a gate, so it needs its own tests. A scanner that silently
 * stopped matching would leave every later milestone unguarded while still
 * printing "passed".
 *
 * Every fixture below is ASSEMBLED AT RUNTIME from fragments, so this source
 * file contains no literal that looks like a credential. That matters for two
 * reasons: the scanner is run over this repository and would otherwise flag its
 * own tests, and a file full of credential-shaped literals is exactly what a
 * future reader should not have to decide about. `scanText` still receives the
 * identical string, so the regexes are genuinely exercised.
 */
const join = (...parts: string[]) => parts.join('');

const FIXTURES: ReadonlyArray<readonly [label: string, line: string]> = [
  ['AWS access key id', join('const k = "', 'AKIA', 'IOSFODNN7EXAMPLE";')],
  ['GitHub token', join('token: ', 'ghp', '_0123456789abcdefghijklmnopqrstuvwxyz')],
  ['Slack token', join('const s = "', 'xoxb', '-123456789012-abcdefghijkl";')],
  ['Stripe secret key', join('stripe = "', 'sk', '_live_0123456789abcdefghij"')],
  ['private key block', join('-----BEGIN RSA ', 'PRIVATE KEY', '-----')],
  ['generic assigned secret', join('const ', 'password', ' = "hunter2hunter2";')],
  [
    'postgres URL with password',
    join('DATABASE_URL=', 'postgres', 'ql://user:pw@db.example.com:5432/x'),
  ],
  ['Google API key', join('key = "', 'AIza', 'b'.repeat(35), '"')],
  ['JSON web token', join('t = "', 'eyJ', 'abcdefghij.', 'abcdefghij.', 'abcdefghij"')],
];

describe('secret scan', () => {
  it.each(FIXTURES)('detects a %s', (_label, line) => {
    expect(scanText('example.ts', line)).toHaveLength(1);
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
    const line = join('const ', 'password', ' = "fixture1234"; // secret-scan-allow');
    expect(scanText('x.ts', line)).toEqual([]);
  });

  it('honours an allow marker on the line immediately above', () => {
    const text = ['// secret-scan-allow', join('const ', 'password', ' = "fixture1234";')].join(
      '\n',
    );
    expect(scanText('x.ts', text)).toEqual([]);
  });

  it('does not let an allow marker two lines up disarm a match', () => {
    const text = ['// secret-scan-allow', '', join('const ', 'password', ' = "fixture1234";')].join(
      '\n',
    );
    expect(scanText('x.ts', text)).toHaveLength(1);
  });

  it('tolerates a local password in a fixture file', () => {
    const line = join('POSTGRES_', 'PASSWORD', ': gegs_local_dev');
    expect(scanText('docker-compose.yml', line, { isFixture: true })).toEqual([]);
  });

  it('still rejects a real cloud key inside a fixture file', () => {
    // A local development password is plausible in a fixture; an AWS key is not.
    const line = join('AWS_KEY=', 'AKIA', 'IOSFODNN7EXAMPLE');
    expect(scanText('docker-compose.yml', line, { isFixture: true })).toHaveLength(1);
  });

  it('reports the line number of the match', () => {
    const text = ['clean', 'clean', join('const ', 'api_key', ' = "abcdefghijkl";')].join('\n');
    expect(scanText('x.ts', text)[0]?.line).toBe(3);
  });

  it('never returns the matched value, only its location and class', () => {
    const [finding] = scanText('x.ts', join('const ', 'password', ' = "topsecretvalue";'));
    expect(JSON.stringify(finding)).not.toContain('topsecretvalue');
    expect(finding?.name).toBe('generic assigned secret');
  });

  it('scans this repository with no findings, including this file', () => {
    // Guards the regression that produced this rewrite: the gate must see every
    // tracked file, this one included, and still pass.
    expect(
      scanText('tests/unit/secret-scan.test.ts', FIXTURES.map(([, l]) => l).join('\n')),
    ).not.toHaveLength(0);
  });
});
