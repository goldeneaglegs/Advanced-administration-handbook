import { test } from '@playwright/test';
import { DEFAULT_LOCALE, isLocale, type Locale } from '@/i18n/locales';

/**
 * The locale a viewport project is driving (Phase 1 §11, §12).
 *
 * Each project in playwright.config.ts carries its locale in `metadata`. The
 * specs read it from here rather than hardcoding `/en`, so one spec covers both
 * directions and a new width cannot quietly test English twice.
 *
 * This matters more than it looks: without it an `ar` project would request a
 * locale-less path, be redirected to the default locale, pass, and report RTL
 * coverage it never exercised.
 */
export function projectLocale(): Locale {
  const declared: unknown = test.info().project.metadata?.['locale'];
  return typeof declared === 'string' && isLocale(declared) ? declared : DEFAULT_LOCALE;
}

/** 'rtl' for Arabic, 'ltr' otherwise — the direction the page must render in. */
export function projectDir(): 'ltr' | 'rtl' {
  return projectLocale() === 'ar' ? 'rtl' : 'ltr';
}

/**
 * Prefixes an application page path with the project's locale.
 *
 * `/` becomes `/en` or `/ar`. Use it for PAGE routes only: `/api/*` and
 * `/robots.txt` are deliberately locale-less (Phase 1 §3.3, §1.2) and must stay
 * unprefixed, and an unknown route must keep returning 404 rather than being
 * redirected.
 */
export function localePath(path: string): string {
  const locale = projectLocale();
  return path === '/' ? `/${locale}` : `/${locale}${path}`;
}
