'use client';

import { useEffect, useState } from 'react';
import { LocaleLink } from '../_lib/LocaleLink';
import { StatusRegion } from '../_lib/StatusRegion';
import { postAuth, tokenFromUrl } from '../_lib/client';

/**
 * Confirm an email address.
 *
 * The token arrives in the query string from the emailed link. Verification is
 * a POST (it changes state and carries CSRF), so it cannot happen on the link
 * click itself — the user confirms with a button. That is also safer: a link
 * prefetched by a mail client or scanner does not silently consume the token.
 *
 * The token is read in an effect rather than with useSearchParams, so the page
 * needs no Suspense boundary.
 */
export default function VerifyEmailPage() {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  useEffect(() => {
    setToken(tokenFromUrl());
  }, []);

  async function onConfirm() {
    if (busy || !token) return;
    setBusy(true);
    setError('');

    const result = await postAuth('/api/auth/verify-email', { token });

    setBusy(false);
    if (result.ok) {
      setSuccess('Your email is confirmed. You can sign in now.');
      return;
    }
    setError(result.message);
  }

  return (
    <div className="page page--narrow">
      <h1>Confirm your email</h1>
      <StatusRegion error={error} success={success} />

      {token === null ? null : token === '' ? (
        <p>
          This link is missing its confirmation code. Open the link from your email again, or{' '}
          <LocaleLink to="/sign-in">sign in</LocaleLink> if you have already confirmed.
        </p>
      ) : success ? (
        <p>
          <LocaleLink to="/sign-in">Go to sign in</LocaleLink>
        </p>
      ) : (
        <>
          <p>Confirm this address to activate your account.</p>
          <button
            className="btn btn--primary"
            type="button"
            onClick={onConfirm}
            disabled={busy}
            aria-busy={busy}
          >
            {busy ? 'Confirming…' : 'Confirm my email'}
          </button>
        </>
      )}
    </div>
  );
}
