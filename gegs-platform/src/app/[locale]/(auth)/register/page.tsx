'use client';

import { useRef, useState } from 'react';
import { PASSWORD_MIN_LENGTH } from '@/lib/auth/params';
import { useTranslation } from '@/i18n/useTranslation';
import { Field } from '../_lib/Field';
import { StatusRegion } from '../_lib/StatusRegion';
import { postAuth } from '../_lib/client';

/**
 * Candidate registration.
 *
 * The backend returns 202 with the SAME body whether or not the address is
 * already registered, so this screen shows the server's message verbatim and
 * never reports "that email is taken" — which would disclose that a named
 * person is job-seeking.
 */
export default function RegisterPage() {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [fields, setFields] = useState<Record<string, string>>({});
  const name = useRef<HTMLInputElement>(null);
  const email = useRef<HTMLInputElement>(null);
  const password = useRef<HTMLInputElement>(null);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    if (busy) return;
    setBusy(true);
    setError('');
    setFields({});

    const result = await postAuth(
      '/api/auth/register',
      {
        full_name: name.current?.value.trim() ?? '',
        email: email.current?.value.trim() ?? '',
        password: password.current?.value ?? '',
      },
      t,
    );

    setBusy(false);
    if (result.ok) {
      setSuccess(result.message || t('register.success'));
      return;
    }
    setError(result.message);
    setFields(result.fields);
    if (result.fields.full_name) name.current?.focus();
    else if (result.fields.email) email.current?.focus();
    else if (result.fields.password) password.current?.focus();
    else name.current?.focus();
  }

  return (
    <div className="page page--narrow">
      <h1>{t('register.title')}</h1>
      <StatusRegion error={error} success={success} />

      {success ? null : (
        <form className="form" onSubmit={onSubmit} noValidate aria-busy={busy}>
          <Field
            id="full_name"
            label={t('field.fullName.label')}
            autoComplete="name"
            error={fields.full_name}
            disabled={busy}
            inputRef={name}
          />
          <Field
            id="email"
            label={t('field.email.label')}
            type="email"
            autoComplete="email"
            inputMode="email"
            error={fields.email}
            disabled={busy}
            inputRef={email}
          />
          <Field
            id="password"
            label={t('field.password.label')}
            type="password"
            autoComplete="new-password"
            error={fields.password}
            disabled={busy}
            inputRef={password}
          />
          <p className="hint">{t('validation.password.minLength', { min: PASSWORD_MIN_LENGTH })}</p>
          <button className="btn btn--primary" type="submit" disabled={busy}>
            {busy ? t('register.submit.busy') : t('register.submit')}
          </button>
        </form>
      )}
    </div>
  );
}
