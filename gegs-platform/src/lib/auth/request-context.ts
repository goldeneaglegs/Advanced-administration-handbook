import {
  CSRF_COOKIE,
  CSRF_FIELD,
  CSRF_HEADER,
  type CsrfFailure,
  validateCsrf,
} from '@/lib/auth/csrf';
import { resolveClientIp } from '@/lib/auth/client-ip';
import { resolveRequestId } from '@/lib/request-id';
import { ApiError } from '@/lib/api/errors';

export interface RequestContext {
  requestId: string;
  /** Socket address injected by server.ts, or null. Never from a client header. */
  ip: string | null;
  userAgent: string | null;
  origin: string | null;
  isHttps: boolean;
}

export function getRequestContext(request: Request): RequestContext {
  const url = new URL(request.url);
  return {
    requestId: resolveRequestId(request.headers),
    ip: resolveClientIp(request.headers),
    userAgent: request.headers.get('user-agent'),
    origin: request.headers.get('origin'),
    isHttps: url.protocol === 'https:',
  };
}

const CSRF_MESSAGE: Record<CsrfFailure, string> = {
  missing_cookie: 'Your session has expired. Reload the page and try again.',
  missing_token: 'Your session has expired. Reload the page and try again.',
  mismatch: 'Your session has expired. Reload the page and try again.',
  bad_origin: 'This request did not come from an allowed origin.',
};

/**
 * Enforces CSRF on a state-changing request.
 *
 * The token may arrive in the `x-csrf-token` header (client fetch) or as a
 * `csrf_token` body field (plain form post). Both are compared against the
 * cookie; the Origin check runs regardless of which was used.
 *
 * All four failure modes return the same generic wording to the user, because
 * the distinction is only useful to someone probing the mechanism.
 */
export function requireCsrf(
  request: Request,
  context: RequestContext,
  body: Record<string, unknown>,
): void {
  const cookieToken = readCookie(request, CSRF_COOKIE);
  const submitted =
    request.headers.get(CSRF_HEADER) ??
    (typeof body[CSRF_FIELD] === 'string' ? (body[CSRF_FIELD] as string) : undefined);

  const failure = validateCsrf({
    cookieToken,
    submittedToken: submitted ?? undefined,
    origin: context.origin,
  });
  if (failure) throw new ApiError('FORBIDDEN', CSRF_MESSAGE[failure]);
}

/** Minimal cookie reader; avoids pulling in a parser for one header. */
export function readCookie(request: Request, name: string): string | undefined {
  const header = request.headers.get('cookie');
  if (!header) return undefined;
  for (const part of header.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    if (part.slice(0, eq).trim() === name) {
      return decodeURIComponent(part.slice(eq + 1).trim());
    }
  }
  return undefined;
}

/** Parses a JSON body, returning {} rather than throwing on malformed input. */
export async function readJsonBody(request: Request): Promise<Record<string, unknown>> {
  try {
    const parsed: unknown = await request.json();
    return parsed && typeof parsed === 'object' ? (parsed as Record<string, unknown>) : {};
  } catch {
    return {};
  }
}
