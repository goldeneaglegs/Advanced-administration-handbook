'use client';

import { useEffect, useRef, useState } from 'react';
import { Field } from '../_lib/Field';
import { StatusRegion } from '../_lib/StatusRegion';
import { postAuth, tokenFromUrl } from '../_lib/client';

/**
 * Set an initial password from an invitation link.
 *
 * The confirmation field is checked in the browser only. It is not sent, and
 * the API has no second password field — this screen invents nothing.
 */
export default function AcceptInvitePage() {
  const [token, setToken] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const password = useRef<HTMLInputElement>(null);
  const confirm = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setToken(tokenFromUrl());
  }, []);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy || !token) return;

    const value = password.current?.value ?? '';
    if (value !== (confirm.current?.value ?? '')) {
      setFields({ confirm_password: 'Both passwords must match.' });
      setError('');
      confirm.current?.focus();
      return;
    }

    setBusy(true);
    setError('');
    setFields({});

    const result = await postAuth('/api/auth/accept-invite', { token, password: value });

    setBusy(false);
    if (result.ok) {
      setSuccess('Your account is ready. Sign in to continue.');
      return;
    }
    setError(result.message);
    setFields(result.fields);
    password.current?.focus();
  }

  return (
    <div className="page page--narrow">
      <h1>Set your password</h1>
      <StatusRegion error={error} success={success} />

      {token === null ? null : token === '' ? (
        <p>
          This invitation link is missing its code.{' '}
          <span>Ask your administrator to send a new invitation</span>.
        </p>
      ) : success ? (
        <p>
          <a href="/sign-in">Go to sign in</a>
        </p>
      ) : (
        <form className="form" onSubmit={onSubmit} noValidate aria-busy={busy}>
          <Field
            id="password"
            label="Password"
            type="password"
            autoComplete="new-password"
            error={fields.password}
            disabled={busy}
            inputRef={password}
          />
          <Field
            id="confirm_password"
            label="Confirm password"
            type="password"
            autoComplete="new-password"
            error={fields.confirm_password}
            disabled={busy}
            inputRef={confirm}
          />
          <p className="hint">Use at least 12 characters.</p>
          <button className="btn btn--primary" type="submit" disabled={busy}>
            {busy ? 'Saving…' : 'Set new password'}
          </button>
        </form>
      )}
    </div>
  );
}
