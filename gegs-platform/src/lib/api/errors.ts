/**
 * The single error envelope (Phase 1 §3.2). Every failure the API returns has
 * this shape, so the client has exactly one thing to parse.
 *
 * `code` is for the client to branch on. `message` is for a human. `fields`
 * maps to form inputs, which is what lets the UI attach each error to its own
 * input — the mechanism that makes a form usable with a screen reader
 * (Phase 1 §13).
 */
export const ERROR_CODES = [
  'VALIDATION_FAILED',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'CONFLICT',
  'RATE_LIMITED',
  'INTERNAL',
] as const;

export type ErrorCode = (typeof ERROR_CODES)[number];

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    fields?: Record<string, string>;
    request_id: string;
  };
}

const STATUS_BY_CODE: Record<ErrorCode, number> = {
  VALIDATION_FAILED: 400,
  UNAUTHENTICATED: 401,
  FORBIDDEN: 403,
  NOT_FOUND: 404,
  CONFLICT: 409,
  RATE_LIMITED: 429,
  INTERNAL: 500,
};

export function statusForCode(code: ErrorCode): number {
  return STATUS_BY_CODE[code];
}

/**
 * An error that is safe to show a user.
 *
 * Anything not expressed as an ApiError is treated as unexpected and reduced to
 * a generic INTERNAL response, so a stack trace, SQL fragment, internal path or
 * table name cannot reach a client (Phase 1 §6.2, Phase 0 §10).
 */
export class ApiError extends Error {
  readonly code: ErrorCode;
  readonly fields?: Record<string, string>;

  constructor(code: ErrorCode, message: string, fields?: Record<string, string>) {
    super(message);
    this.name = 'ApiError';
    this.code = code;
    if (fields) this.fields = fields;
  }
}

/** Builds the wire body. Never includes a cause, stack, or internal detail. */
export function toErrorBody(error: unknown, requestId: string): ApiErrorBody {
  if (error instanceof ApiError) {
    return {
      error: {
        code: error.code,
        message: error.message,
        ...(error.fields ? { fields: error.fields } : {}),
        request_id: requestId,
      },
    };
  }
  return {
    error: {
      code: 'INTERNAL',
      message: 'Something went wrong. Quote this reference if you contact us.',
      request_id: requestId,
    },
  };
}
