/**
 * The English message catalogue (Phase 1 §12).
 *
 * This is the single place user-facing copy lives. §12: "Translation keys only
 * in components; no literal user-facing string in a component file."
 *
 * EVERY VALUE HERE IS COPIED VERBATIM from the screen it came from. Milestone 4
 * batch 2b-i moves copy into a catalogue; it does not rewrite it. Rewording is
 * a product decision, not a refactor.
 *
 * The keys are flat and namespaced rather than nested, so `MessageKey` is a
 * plain union a typo cannot slip past, and a missing translation is a lookup of
 * one string rather than a walk through an object that may bottom out in
 * `undefined`.
 *
 * `{name}` placeholders are substituted by `t()` from the params it is given.
 * The catalogue stays pure data: it never imports a constant, so a value here
 * cannot drift away from the code that supplies it.
 */
export const en = {
  // Application shell. The name is DECISION REQUIRED #4 and is NOT invented
  // here: the existing placeholder value is preserved exactly as it stands.
  'app.name': 'Operations platform',
  'app.skipToContent': 'Skip to content',

  // Milestone 0 landing page, still scaffolding by design.
  'landing.title': 'Operations platform — Milestone 0',
  'landing.intro':
    'Project scaffolding is in place. No product functionality is implemented yet: schema and seed data arrive in Milestone 1, authentication in Milestone 2, and the authorisation policy layer in Milestone 3.',
  'landing.serviceHealth': 'Service health',
  'landing.crawlerPolicy': 'Crawler policy',
  'landing.crawlerPolicyValue': 'Disallowed. This application serves no indexed URL.',
  'landing.applicationName': 'Application name',
  'landing.applicationNameValue': 'Not yet decided',

  // Client-side failures the server never produces, so they are the UI's own
  // copy rather than a passed-through API message.
  'error.unexpected': 'Something went wrong. Try again.',
  'error.network': 'Could not reach the server. Check your connection and try again.',

  // Field labels. Supplied to `Field` as props; the component itself holds no
  // copy, which is why its aria-describedby wiring needs no translation work.
  'field.fullName.label': 'Full name',
  'field.email.label': 'Email address',
  'field.password.label': 'Password',
  'field.confirmPassword.label': 'Confirm password',
  'field.newPassword.label': 'New password',
  'field.confirmNewPassword.label': 'Confirm new password',

  // Client-side validation. A courtesy only: the server re-validates and is
  // authoritative, and its messages are passed through untranslated in v1.
  'validation.email.required': 'Enter your email address.',
  'validation.password.required': 'Enter your password.',
  'validation.password.mismatch': 'Both passwords must match.',
  // Interpolated from PASSWORD_MIN_LENGTH rather than hardcoded. Three screens
  // currently say "12" in prose while the constant lives in params.ts, so
  // raising the minimum would leave them telling users the wrong number.
  'validation.password.minLength': 'Use at least {min} characters.',

  // Shared navigation labels.
  'nav.goToSignIn': 'Go to sign in',

  'signIn.title': 'Sign in',
  'signIn.submit': 'Sign in',
  'signIn.submit.busy': 'Signing in…',
  'signIn.success': 'Signed in. Taking you to your account.',

  'register.title': 'Create your account',
  'register.submit': 'Create account',
  'register.submit.busy': 'Creating your account…',
  'register.success': 'Check your email to continue.',

  'forgotPassword.title': 'Reset your password',
  'forgotPassword.submit': 'Send reset link',
  'forgotPassword.submit.busy': 'Sending…',
  'forgotPassword.success': 'If that address has an account, a reset link is on its way.',

  'verifyEmail.title': 'Confirm your email',
  'verifyEmail.prompt': 'Confirm this address to activate your account.',
  'verifyEmail.submit': 'Confirm my email',
  'verifyEmail.submit.busy': 'Confirming…',
  'verifyEmail.success': 'Your email is confirmed. You can sign in now.',
  // A sentence interrupted by a link, so it is three keys. Recorded as a known
  // limitation: Arabic word order may not place the link in the same position,
  // and a translator cannot move it. If that proves wrong when real copy
  // arrives, the fix is a single message with a placeholder for the link.
  'verifyEmail.missingToken.before':
    'This link is missing its confirmation code. Open the link from your email again, or',
  'verifyEmail.missingToken.link': 'sign in',
  'verifyEmail.missingToken.after': 'if you have already confirmed.',

  'acceptInvite.title': 'Set your password',
  'acceptInvite.missingToken': 'This invitation link is missing its code.',
  'acceptInvite.missingToken.action': 'Ask your administrator to send a new invitation',
  'acceptInvite.submit': 'Set new password',
  'acceptInvite.submit.busy': 'Saving…',
  'acceptInvite.success': 'Your account is ready. Sign in to continue.',

  'resetPassword.title': 'Choose a new password',
  'resetPassword.missingToken': 'This link is missing its reset code.',
  'resetPassword.requestNewLink': 'Request a new reset link',
  'resetPassword.submit': 'Set new password',
  'resetPassword.submit.busy': 'Saving…',
  'resetPassword.success':
    'Your password is set. You have been signed out everywhere, so sign in again.',
} as const;

/** Every key the application may ask for. A typo is a typecheck failure. */
export type MessageKey = keyof typeof en;
