'use client';

import { useEffect, useRef, useState } from 'react';
import { PASSWORD_MIN_LENGTH } from '@/lib/auth/params';
import { useTranslation } from '@/i18n/useTranslation';
import { Field } from '../_lib/Field';
import { LocaleLink } from '../_lib/LocaleLink';
import { StatusRegion } from '../_lib/StatusRegion';
import { postAuth, tokenFromUrl } from '../_lib/client';

/**
 * Set a new password from a reset link.
 *
 * The confirmation field is checked in the browser only. It is not sent, and
 * the API has no second password field — this screen invents nothing.
 */
export default function ResetPasswordPage() {
  const { t } = useTranslation();
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
      setFields({ confirm_password: t('validation.password.mismatch') });
      setError('');
      confirm.current?.focus();
      return;
    }

    setBusy(true);
    setError('');
    setFields({});

    const result = await postAuth('/api/auth/reset-password', { token, password: value }, t);

    setBusy(false);
    if (result.ok) {
      setSuccess(t('resetPassword.success'));
      return;
    }
    setError(result.message);
    setFields(result.fields);
    password.current?.focus();
  }

  return (
    <div className="page page--narrow">
      <h1>{t('resetPassword.title')}</h1>
      <StatusRegion error={error} success={success} />

      {token === null ? null : token === '' ? (
        <p>
          {t('resetPassword.missingToken')}{' '}
          <LocaleLink to="/forgot-password">{t('resetPassword.requestNewLink')}</LocaleLink>.
        </p>
      ) : success ? (
        <p>
          <LocaleLink to="/sign-in">{t('nav.goToSignIn')}</LocaleLink>
        </p>
      ) : (
        <form className="form" onSubmit={onSubmit} noValidate aria-busy={busy}>
          <Field
            id="password"
            label={t('field.newPassword.label')}
            type="password"
            autoComplete="new-password"
            error={fields.password}
            disabled={busy}
            inputRef={password}
          />
          <Field
            id="confirm_password"
            label={t('field.confirmNewPassword.label')}
            type="password"
            autoComplete="new-password"
            error={fields.confirm_password}
            disabled={busy}
            inputRef={confirm}
          />
          <p className="hint">{t('validation.password.minLength', { min: PASSWORD_MIN_LENGTH })}</p>
          <button className="btn btn--primary" type="submit" disabled={busy}>
            {busy ? t('resetPassword.submit.busy') : t('resetPassword.submit')}
          </button>
        </form>
      )}
    </div>
  );
}
