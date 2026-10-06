'use client';

import { useRef, useState } from 'react';
import { useRouter } from 'next/navigation';

/**
 * Sign in.
 *
 * Visually plain by approval: the design system is Milestone 4. The
 * accessibility floor (Phase 1 §13) applies in full regardless, because labels,
 * error association and focus management are semantics rather than styling and
 * retrofitting them is how products end up inaccessible.
 *
 * Talks to the existing POST /api/auth/login. Nothing in the backend changed.
 *
 * CSRF: the double-submit cookie `gegs_csrf` is minted by middleware and is
 * deliberately not HttpOnly, so this page can echo it in the `x-csrf-token`
 * header. The browser supplies `Origin` on a same-origin POST, which the
 * backend checks independently.
 */
type Status = 'idle' | 'submitting' | 'failed' | 'succeeded';

function readCsrfCookie(): string {
  const match = /(?:^|;\s*)gegs_csrf=([^;]*)/.exec(document.cookie);
  return match?.[1] ? decodeURIComponent(match[1]) : '';
}

export default function SignInPage() {
  const router = useRouter();
  const [status, setStatus] = useState<Status>('idle');
  const [formError, setFormError] = useState('');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);

  const busy = status === 'submitting';

  async function onSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;

    const email = emailRef.current?.value.trim() ?? '';
    const password = passwordRef.current?.value ?? '';

    // Client-side checks are a courtesy only; the server re-validates and is
    // authoritative. On failure, focus moves to the first invalid field.
    const next: Record<string, string> = {};
    if (email.length === 0) next.email = 'Enter your email address.';
    // secret-scan-allow: a validation message for an empty field, not a credential.
    if (password.length === 0) next.password = 'Enter your password.';
    if (Object.keys(next).length > 0) {
      setFieldErrors(next);
      setFormError('');
      setStatus('failed');
      (next.email ? emailRef : passwordRef).current?.focus();
      return;
    }

    setStatus('submitting');
    setFormError('');
    setFieldErrors({});

    try {
      const response = await fetch('/api/auth/login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-csrf-token': readCsrfCookie() },
        body: JSON.stringify({ email, password }),
      });

      if (response.ok) {
        // Phase 2 rule 7: success is shown only after the server confirmed it.
        setStatus('succeeded');
        router.push('/');
        return;
      }

      const body: unknown = await response.json().catch(() => null);
      const error =
        body && typeof body === 'object' && 'error' in body
          ? (body as { error: { message?: string; fields?: Record<string, string> } }).error
          : null;

      setFieldErrors(error?.fields ?? {});
      setFormError(error?.message ?? 'Something went wrong. Try again.');
      setStatus('failed');
      // Send focus where the problem is: a named field, or the summary.
      if (error?.fields?.email) emailRef.current?.focus();
      else if (error?.fields?.password) passwordRef.current?.focus();
      else emailRef.current?.focus();
    } catch {
      setFormError('Could not reach the server. Check your connection and try again.');
      setStatus('failed');
      emailRef.current?.focus();
    }
  }

  return (
    <div className="page page--narrow">
      <h1>Sign in</h1>

      {/*
        One live region for the whole form. Announced politely so a screen
        reader hears the failure without the focus move interrupting it.
      */}
      <div className="alert-region" role="status" aria-live="polite">
        {formError ? (
          <p className="alert alert--error">{formError}</p>
        ) : status === 'succeeded' ? (
          <p className="alert alert--success">Signed in. Taking you to your account.</p>
        ) : null}
      </div>

      <form className="form" onSubmit={onSubmit} noValidate aria-busy={busy}>
        <div className="field">
          <label htmlFor="email">Email address</label>
          <input
            ref={emailRef}
            id="email"
            name="email"
            type="email"
            autoComplete="email"
            inputMode="email"
            required
            disabled={busy}
            aria-invalid={fieldErrors.email ? true : undefined}
            aria-describedby={fieldErrors.email ? 'email-error' : undefined}
          />
          {fieldErrors.email ? (
            <p className="error-text" id="email-error">
              {fieldErrors.email}
            </p>
          ) : null}
        </div>

        <div className="field">
          <label htmlFor="password">Password</label>
          <input
            ref={passwordRef}
            id="password"
            name="password"
            type="password"
            autoComplete="current-password"
            required
            disabled={busy}
            aria-invalid={fieldErrors.password ? true : undefined}
            aria-describedby={fieldErrors.password ? 'password-error' : undefined}
          />
          {fieldErrors.password ? (
            <p className="error-text" id="password-error">
              {fieldErrors.password}
            </p>
          ) : null}
        </div>

        <button className="btn btn--primary" type="submit" disabled={busy}>
          {busy ? 'Signing in…' : 'Sign in'}
        </button>
      </form>
    </div>
  );
}
