'use client';

import type { Ref } from 'react';

/**
 * A labelled input with its error wired to it.
 *
 * Extracted so all five screens share one correct implementation: a real
 * <label>, aria-invalid, and an error joined by aria-describedby rather than
 * merely placed nearby. That association is what a screen reader relies on, and
 * it is the easiest thing to get subtly wrong five times over.
 */
export function Field(props: {
  id: string;
  label: string;
  type?: string;
  autoComplete?: string;
  inputMode?: 'text' | 'email';
  error?: string | undefined;
  disabled?: boolean;
  inputRef?: Ref<HTMLInputElement>;
}) {
  const { id, label, type = 'text', autoComplete, inputMode, error, disabled, inputRef } = props;
  const errorId = `${id}-error`;

  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <input
        ref={inputRef}
        id={id}
        name={id}
        type={type}
        {...(autoComplete ? { autoComplete } : {})}
        {...(inputMode ? { inputMode } : {})}
        required
        disabled={disabled ?? false}
        aria-invalid={error ? true : undefined}
        aria-describedby={error ? errorId : undefined}
      />
      {error ? (
        <p className="error-text" id={errorId}>
          {error}
        </p>
      ) : null}
    </div>
  );
}
