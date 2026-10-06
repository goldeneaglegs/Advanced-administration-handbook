/**
 * Hand-authored types for the token-discipline gate.
 *
 * The gate is plain ESM so CI can run it with bare Node, matching the secret
 * scan beside it. Declaring it here keeps `tsc --noEmit` strict over the tests
 * that exercise it, rather than letting them fall back to `any`.
 */
export interface LiteralColourFinding {
  /** Repository-relative path of the file the literal was found in. */
  file: string;
  /** 1-indexed line number. */
  line: number;
  /** The offending literal, e.g. `#9b2c2c`. Safe to print: it is not a secret. */
  value: string;
}

/** Whether a path is allowed to hold literal colours. Narrow by design. */
export function isExempt(file: string): boolean;

/** One finding per offending line, so the report points at a line to fix. */
export function findLiteralColours(file: string, text: string): LiteralColourFinding[];
