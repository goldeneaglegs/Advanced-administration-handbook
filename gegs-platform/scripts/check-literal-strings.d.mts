/**
 * Hand-authored types for the literal-string gate.
 *
 * The gate is plain ESM so CI can run it with bare Node, matching the secret
 * scan and the token-discipline gate beside it. Declaring it here keeps
 * `tsc --noEmit` strict over the tests that exercise it.
 */
export interface LiteralStringFinding {
  /** Repository-relative path. */
  file: string;
  /** 1-indexed line number. */
  line: number;
  /** How it was detected: 'copy prop' | 'JSX text' | 'string literal'. */
  kind: string;
  /** The offending text, safe to print. */
  text: string;
}

/** Whether the rule applies to this path. Narrow by design. */
export function isScanned(file: string): boolean;

/** One finding per offending line. */
export function findLiteralStrings(file: string, text: string): LiteralStringFinding[];
