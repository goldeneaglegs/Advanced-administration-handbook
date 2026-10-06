import { describe, expect, it } from 'vitest';
import { ApiError, ERROR_CODES, statusForCode, toErrorBody } from '@/lib/api/errors';

const REQUEST_ID = '0192f0a1-1111-7000-8000-abcdefabcdef';

describe('error envelope', () => {
  it('maps every code to a status', () => {
    for (const code of ERROR_CODES) {
      expect(statusForCode(code)).toBeGreaterThanOrEqual(400);
    }
  });

  it('preserves an ApiError code, message and fields', () => {
    const body = toErrorBody(
      new ApiError('VALIDATION_FAILED', 'Check the highlighted fields.', {
        phone_e164: 'Enter a phone number with country code.',
      }),
      REQUEST_ID,
    );
    expect(body.error.code).toBe('VALIDATION_FAILED');
    expect(body.error.fields?.phone_e164).toContain('country code');
    expect(body.error.request_id).toBe(REQUEST_ID);
  });

  it('reduces an unexpected error to a generic INTERNAL response', () => {
    const body = toErrorBody(new Error('relation "users" does not exist'), REQUEST_ID);
    expect(body.error.code).toBe('INTERNAL');
    expect(body.error.message).not.toContain('users');
    expect(body.error.message).not.toContain('relation');
  });

  it('never leaks a stack trace or SQL fragment', () => {
    const leaky = new Error('SELECT * FROM documents WHERE id = $1 failed at /srv/app/db.ts:42');
    const serialised = JSON.stringify(toErrorBody(leaky, REQUEST_ID));
    expect(serialised).not.toContain('SELECT');
    expect(serialised).not.toContain('/srv/app');
    expect(serialised).not.toContain('documents');
  });

  it('omits the fields key when there are no field errors', () => {
    const body = toErrorBody(new ApiError('NOT_FOUND', 'Not found.'), REQUEST_ID);
    expect(body.error).not.toHaveProperty('fields');
  });
});
