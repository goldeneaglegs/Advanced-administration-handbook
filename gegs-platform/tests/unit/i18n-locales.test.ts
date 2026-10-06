import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import {
  DEFAULT_LOCALE,
  LOCALES,
  LOCALE_HEADER,
  dirFor,
  firstSegment,
  isLocale,
} from '@/i18n/locales';

/**
 * Locale primitives (Phase 1 §12).
 *
 * The load-bearing test is the last one: the supported set exists twice, once
 * in TypeScript and once as a CHECK constraint written in Milestone 1, and a
 * third language must be a migration rather than a quiet constant edit. So the
 * constraint is parsed out of the migration and compared, the same way
 * check-contrast.mjs reads the hex values out of tokens.ts instead of copying
 * them.
 */
describe('the supported set', () => {
  it('is exactly en and ar, in that order', () => {
    expect([...LOCALES]).toEqual(['en', 'ar']);
  });

  it('defaults to en, matching the users.locale column default', () => {
    expect(DEFAULT_LOCALE).toBe('en');
    expect(LOCALES).toContain(DEFAULT_LOCALE);
  });

  it('agrees with the Milestone 1 CHECK constraint', () => {
    const sql = readFileSync('prisma/migrations/20261006120100_core_schema/migration.sql', 'utf8');
    const match = /CHECK\s*\(locale IN \(([^)]*)\)\)/.exec(sql);
    expect(match, 'users_locale_supported constraint not found in the migration').not.toBeNull();
    const fromSql = [...match![1]!.matchAll(/'([a-z-]+)'/g)].map((m) => m[1]);
    expect(fromSql.sort()).toEqual([...LOCALES].sort());
  });
});

describe('isLocale', () => {
  it.each(['en', 'ar'])('accepts %s', (value) => {
    expect(isLocale(value)).toBe(true);
  });

  it.each([
    ['uppercase', 'EN'],
    ['a region subtag', 'en-GB'],
    ['an unsupported language', 'fr'],
    ['empty', ''],
    ['a path', '/en'],
    ['a trailing slash', 'en/'],
    ['a page path segment', 'sign-in'],
    ['the api prefix', 'api'],
    ['the robots file', 'robots.txt'],
    ['whitespace', ' en'],
  ])('rejects %s', (_label, value) => {
    expect(isLocale(value)).toBe(false);
  });

  it('rejects null and undefined rather than throwing', () => {
    expect(isLocale(null)).toBe(false);
    expect(isLocale(undefined)).toBe(false);
  });
});

describe('dirFor', () => {
  it('maps ar to rtl', () => expect(dirFor('ar')).toBe('rtl'));
  it('maps en to ltr', () => expect(dirFor('en')).toBe('ltr'));
});

describe('firstSegment', () => {
  it.each([
    ['/', null],
    ['', null],
    ['/en', 'en'],
    ['/en/sign-in', 'en'],
    ['/sign-in', 'sign-in'],
    ['/api/health', 'api'],
    ['/fr/sign-in', 'fr'],
  ])('reads %s as %s', (path, expected) => {
    expect(firstSegment(path)).toBe(expected);
  });
});

describe('the internal locale header', () => {
  it('is namespaced like the other internal headers', () => {
    // server.ts strips `x-gegs-client-ip` before setting it; middleware does
    // the same for this one. The shared prefix is what makes that rule legible.
    expect(LOCALE_HEADER).toBe('x-gegs-locale');
    expect(LOCALE_HEADER).toMatch(/^x-gegs-/);
  });
});
