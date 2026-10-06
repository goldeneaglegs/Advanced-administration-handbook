/**
 * Milestone 0 landing page, now served under its locale segment (Phase 1 §12).
 *
 * The content is unchanged from Milestone 0: it is scaffolding, and it says so
 * rather than presenting a convincing-looking dashboard that does nothing. The
 * application name is DECISION REQUIRED #4 and is still deliberately not
 * invented here. Milestone 4 batch 2b keys these strings; this batch only
 * moves the route.
 */
export default function Home() {
  return (
    <div className="page">
      <h1>Operations platform — Milestone 0</h1>
      <p>
        Project scaffolding is in place. No product functionality is implemented yet: schema and
        seed data arrive in Milestone 1, authentication in Milestone 2, and the authorisation policy
        layer in Milestone 3.
      </p>
      <dl>
        <dt>Service health</dt>
        <dd>
          {/* A JSON route handler, not a page: next/link would client-side
              navigate to an API response. */}
          {/* eslint-disable-next-line @next/next/no-html-link-for-pages */}
          <a href="/api/health">/api/health</a>
        </dd>
        <dt>Crawler policy</dt>
        <dd>Disallowed. This application serves no indexed URL.</dd>
        <dt>Application name</dt>
        <dd>Not yet decided</dd>
      </dl>
    </div>
  );
}
