/**
 * Milestone 0 landing page.
 *
 * This is scaffolding, not a product screen, and it says so rather than
 * presenting a convincing-looking dashboard that does nothing. The application
 * name is DECISION REQUIRED #4 and is deliberately not invented here.
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
