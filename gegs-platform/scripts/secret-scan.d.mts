/**
 * Hand-authored types for the secret-scan gate.
 *
 * The gate is plain ESM so that CI can run it with bare Node, before any build
 * step exists. Declaring it here keeps `tsc --noEmit` strict over the tests
 * that exercise it, rather than letting them fall back to `any`.
 */
export interface SecretFinding {
  /** Repository-relative path of the file the match was found in. */
  file: string;
  /** 1-indexed line number of the match. */
  line: number;
  /** The credential class that matched. Never the matched value itself. */
  name: string;
}

export interface ScanOptions {
  /**
   * True for files permitted to hold local development fixtures. A fixture may
   * contain a local password; it may never contain a real cloud or private key.
   */
  isFixture?: boolean;
}

export function scanText(file: string, text: string, options?: ScanOptions): SecretFinding[];

export function scanRepository(): SecretFinding[];
