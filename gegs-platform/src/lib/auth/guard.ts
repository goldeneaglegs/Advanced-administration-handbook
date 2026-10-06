import { ApiError } from '@/lib/api/errors';
import { THROTTLE } from '@/lib/auth/params';
import { checkIpBudget, recordAttempt, type ThrottledAction } from '@/lib/auth/throttle';
import {
  getRequestContext,
  readJsonBody,
  requireCsrf,
  type RequestContext,
} from '@/lib/auth/request-context';

/**
 * The guards every state-changing auth endpoint runs, in a fixed order.
 *
 * Order matters and is deliberate:
 *   1. CSRF — a forged cross-site request is rejected before it can consume any
 *      throttle budget, so an attacker cannot exhaust a victim's allowance from
 *      another site.
 *   2. Per-IP budget — checked before any database lookup of the subject, so a
 *      spraying client learns nothing at all.
 *
 * Centralised so that seven endpoints cannot drift apart, and so that adding an
 * endpoint without its guards is a visible omission rather than a silent one.
 */
export interface GuardedRequest {
  context: RequestContext;
  body: Record<string, unknown>;
}

const BUDGETS: Record<ThrottledAction, { windowMs: number; max: number }> = {
  login: THROTTLE.login.volume,
  forgot_password: THROTTLE.forgotPasswordIp,
  register: THROTTLE.register,
  verify_email: THROTTLE.tokenSubmit,
  reset_password: THROTTLE.tokenSubmit,
  accept_invite: THROTTLE.tokenSubmit,
};

export async function guard(request: Request, action: ThrottledAction): Promise<GuardedRequest> {
  const context = getRequestContext(request);
  const body = await readJsonBody(request);

  requireCsrf(request, context, body);

  const decision = await checkIpBudget(context.ip, action, BUDGETS[action]);
  if (!decision.allowed) {
    await recordAttempt(context.ip, action, false);
    throw new ApiError('RATE_LIMITED', 'Too many attempts. Try again shortly.');
  }

  return { context, body };
}
