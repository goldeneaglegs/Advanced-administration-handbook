import { DEFAULT_LOCALE, isLocale } from '@/i18n/locales';
import { t } from '@/i18n/translate';

/**
 * Milestone 0 landing page, served under its locale segment (Phase 1 §12).
 *
 * A server component, so it resolves the locale from the route params and calls
 * `t` directly rather than through the client hook. The copy is unchanged and
 * now arrives from the catalogue: it is scaffolding, and it says so rather than
 * presenting a convincing-looking dashboard that does nothing. The application
 * name is DECISION REQUIRED #4 and is still not invented — `landing.title`
 * carries the placeholder value verbatim.
 */
export default async function Home({ params }: { params: Promise<{ locale: string }> }) {
  const { locale: segment } = await params;
  const locale = isLocale(segment) ? segment : DEFAULT_LOCALE;

  return (
    <div className="page">
      <h1>{t(locale, 'landing.title')}</h1>
      <p>{t(locale, 'landing.intro')}</p>
      <dl>
        <dt>{t(locale, 'landing.serviceHealth')}</dt>
        <dd>
          {/* A JSON route handler, not a page: next/link would client-side
              navigate to an API response. The visible text IS the path, so it
              is the endpoint's own name rather than copy to translate.
              i18n-allow */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/api/health">/api/health</a>
        </dd>
        <dt>{t(locale, 'landing.crawlerPolicy')}</dt>
        <dd>{t(locale, 'landing.crawlerPolicyValue')}</dd>
        <dt>{t(locale, 'landing.applicationName')}</dt>
        <dd>{t(locale, 'landing.applicationNameValue')}</dd>
      </dl>
    </div>
  );
}
