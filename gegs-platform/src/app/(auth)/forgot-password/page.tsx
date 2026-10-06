'use client';

import { useRef, useState } from 'react';
import { Field } from '../_lib/Field';
import { StatusRegion } from '../_lib/StatusRegion';
import { postAuth } from '../_lib/client';

/**
 * Request a password reset.
 *
 * The backend always answers 202, so this screen has no failure path to show
 * for an unknown address. Telling the user anything else would confirm whether
 * the address exists.
 */
export default function ForgotPasswordPage() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const email = useRef<HTMLInputElement>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');

    const result = await postAuth('/api/auth/forgot-password', {
      email: email.current?.value.trim() ?? '',
    });

    setBusy(false);
    if (result.ok) {
      setSuccess(result.message || 'If that address has an account, a reset link is on its way.');
      return;
    }
    setError(result.message);
    email.current?.focus();
  }

  return (
    <div className="page page--narrow">
      <h1>Reset your password</h1>
      <StatusRegion error={error} success={success} />

      {success ? null : (
        <form className="form" onSubmit={onSubmit} noValidate aria-busy={busy}>
          <Field
            id="email"
            label="Email address"
            type="email"
            autoComplete="email"
            inputMode="email"
            disabled={busy}
            inputRef={email}
          />
          <button className="btn btn--primary" type="submit" disabled={busy}>
            {busy ? 'Sending…' : 'Send reset link'}
          </button>
        </form>
      )}
    </div>
  );
}
