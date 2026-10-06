/**
 * Design tokens (Phase 1 §10).
 *
 * These are the RECOMMENDED placeholder values from the approved Phase 1 plan,
 * pending DECISION REQUIRED #14 (Golden Eagle's exact brand hex values and
 * typeface licences). That decision is deliberately NOT made here.
 *
 * Every colour is referenced as a token and nowhere as a literal, so replacing
 * these with the real brand values is a one-file change.
 *
 * `scripts/check-contrast.mjs` re-measures the pairs in CONTRAST_REQUIREMENTS
 * on every CI run and fails the build on a regression. Phase 1 §10.1 records
 * two candidate values that failed WCAG and were rejected: white text on the
 * gold button (2.79:1) and gold-500 as a focus ring on a light page (2.79:1
 * against the 3:1 non-text minimum of WCAG 2.2 SC 1.4.11).
 */
export const colour = {
  navy900: '#0B1A2F',
  navy700: '#152A47',
  navy500: '#2A4568',
  gold600: '#A67F30',
  gold500: '#B8923F',
  gold300: '#D9BD7A',
  paper50: '#FBFAF8',
  paper200: '#ECE8E1',
  line500: '#8B8172',
  ink700: '#3A4452',
  success: '#1F6B4A',
  warning: '#8A5A12',
  danger: '#9B2C2C',
  info: '#1F4E6B',
} as const;

export type ColourToken = keyof typeof colour;

/** WCAG 2.2: 4.5 for body text, 3.0 for large text, UI boundaries and focus rings. */
export interface ContrastRequirement {
  readonly foreground: ColourToken;
  readonly background: ColourToken;
  readonly minimum: 4.5 | 3;
  readonly usage: string;
}

export const CONTRAST_REQUIREMENTS: readonly ContrastRequirement[] = [
  { foreground: 'navy900', background: 'paper50', minimum: 4.5, usage: 'body text, light' },
  { foreground: 'ink700', background: 'paper50', minimum: 4.5, usage: 'secondary text, light' },
  { foreground: 'navy500', background: 'paper50', minimum: 4.5, usage: 'muted heading, light' },
  { foreground: 'navy900', background: 'gold500', minimum: 4.5, usage: 'primary button label' },
  { foreground: 'gold600', background: 'paper50', minimum: 3, usage: 'focus ring, light' },
  { foreground: 'line500', background: 'paper50', minimum: 3, usage: 'input border, light' },
  { foreground: 'paper50', background: 'navy900', minimum: 4.5, usage: 'body text, dark' },
  { foreground: 'gold300', background: 'navy900', minimum: 3, usage: 'focus ring, dark' },
  { foreground: 'gold300', background: 'navy900', minimum: 4.5, usage: 'gold text, dark' },
  { foreground: 'success', background: 'paper50', minimum: 4.5, usage: 'success text' },
  { foreground: 'warning', background: 'paper50', minimum: 4.5, usage: 'warning text' },
  { foreground: 'danger', background: 'paper50', minimum: 4.5, usage: 'danger text' },
  { foreground: 'info', background: 'paper50', minimum: 4.5, usage: 'info text' },
] as const;

export const space = [4, 8, 12, 16, 24, 32, 48, 64] as const;
export const typeScale = [12, 14, 16, 20, 25, 31, 39] as const;
export const radius = { rule: 0, control: 4, card: 8, overlay: 12 } as const;

/* ---------------------------------------------------------------------------
 * Typography (Phase 1 §10.2)
 *
 * STACKS ONLY. No font file is loaded by this batch, so until the families are
 * installed every stack falls through to the system font. That is a deliberate
 * limitation, not an oversight: loading webfonts is shell work, and DECISION
 * REQUIRED #14a (licensed brand typefaces) would override these choices
 * outright.
 *
 * §10.2 names three families and deliberately leaves a fourth open: "Noto
 * Naskh Arabic for Arabic, paired with a transitional serif for Latin." The
 * Latin transitional serif is NOT named there, so it is not named here — the
 * display stack falls back to the generic `serif` until that is decided.
 * ------------------------------------------------------------------------- */
export const fontFamily = {
  /** UI, body and data. One superfamily across both scripts, matched metrics. */
  ui: "'IBM Plex Sans', 'IBM Plex Sans Arabic', system-ui, -apple-system, 'Segoe UI', sans-serif",
  /** Page titles only. Naskh is the register of formal Arabic documents. */
  display: "'Noto Naskh Arabic', serif",
} as const;

/** §10.2: 1.6 for body, 1.2 for display. One scale across both scripts. */
export const lineHeight = { body: 1.6, display: 1.2 } as const;

/**
 * §10.2 limits that are rules rather than scales.
 *
 * `bodyMinimumPx` is 16 and never 14 for content: a large share of candidates
 * will read Arabic on a phone in bright sunlight, and anything smaller also
 * makes iOS Safari zoom on focus. `measureCh` caps line length at 70
 * characters.
 */
export const typeLimits = { bodyMinimumPx: 16, measureCh: 70 } as const;

/* ---------------------------------------------------------------------------
 * Surface and motion (Phase 1 §10.3, §10.4)
 * ------------------------------------------------------------------------- */

/**
 * §10.3: borders carry meaning. `hairline` is the 1 px rule used for a control
 * boundary (with `line500`) or a decorative divider (with `paper200`).
 * `emphasis` is the 2 px boundary an invalid input takes, so the error reads
 * without relying on colour alone.
 */
export const borderWidth = { hairline: 1, emphasis: 2 } as const;

/**
 * §10.4: a 2 px outline with a 2 px offset, on every focusable element, never
 * removed. `gold600` on light and `gold300` on dark — both gated in
 * CONTRAST_REQUIREMENTS against the 3:1 non-text minimum.
 */
export const focusRing = { widthPx: 2, offsetPx: 2 } as const;

/**
 * §10.3: "One shadow, used twice." Modals and dropdowns only — cards are
 * separated by a 1 px border, never a shadow.
 *
 * ITS GEOMETRY IS AN OPEN DECISION, and this token says so rather than filling
 * it in. §10.3 approves exactly two things about shadows: that there is ONE,
 * and where it may be used. It states no offset, no blur, no colour and no
 * alpha — and a search of the whole approved corpus confirms §10.3 lines
 * 733-736 are the only mention of a shadow in either Phase 0 or Phase 1.
 *
 * An earlier draft of this file carried `0 8px 24px rgb(navy900 / 0.18)`.
 * Those numbers were mine, not Golden Eagle's, and a token file is exactly
 * where an unapproved value would quietly become canon. No overlay component
 * exists until batch 4, so nothing is blocked by leaving this undecided — and
 * nothing can accidentally come to depend on a value nobody approved.
 */
export const shadow = {
  overlay: {
    /** Approved (§10.3). The one thing about this shadow that is settled. */
    usage: 'modals and dropdowns only, never cards',
    /** UNDECIDED: offset, blur, colour and alpha are all unspecified. */
    geometry: null,
  },
} as const;

/**
 * §10.3: state transitions only — 120 ms for a local change, 200 ms for a
 * layout change. No entrance animations on page load, and
 * `prefers-reduced-motion: reduce` removes all of it.
 */
export const motionMs = { local: 120, layout: 200 } as const;
