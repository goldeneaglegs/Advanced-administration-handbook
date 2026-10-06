'use client';

/**
 * One polite live region per screen.
 *
 * Polite rather than assertive so the announcement is not cut off by the focus
 * move that follows a failure (Phase 1 §13).
 */
export function StatusRegion(props: { error?: string; success?: string }) {
  return (
    <div className="alert-region" role="status" aria-live="polite">
      {props.error ? <p className="alert alert--error">{props.error}</p> : null}
      {!props.error && props.success ? (
        <p className="alert alert--success">{props.success}</p>
      ) : null}
    </div>
  );
}
