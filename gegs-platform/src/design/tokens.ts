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
