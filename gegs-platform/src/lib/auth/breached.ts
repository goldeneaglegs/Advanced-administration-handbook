import { readFileSync } from 'node:fs';
import path from 'node:path';

/**
 * Offline breached-password check.
 *
 * APPROVED DECISION: offline corpus only. No external API and no third-party
 * runtime call, so no password material — not even a hash prefix — leaves the
 * deployment, and there is no network dependency on the sign-up path.
 *
 * KNOWN LIMITATION, and it is a real one: the bundled corpus
 * (assets/breached-passwords.txt) is a STARTER list of the most commonly
 * breached passwords. It is not a full corpus. Supplying a complete offline
 * list is an operations deliverable, recorded for Milestone 10.
 *
 * SCALING: a full corpus has tens of millions of entries and cannot be held in
 * a Set. When one is supplied, this module should switch to a sorted or
 * prefix-sharded file read with binary search, or a Bloom filter. The exported
 * surface (`isBreached`) does not change, so that swap is contained here.
 */
const CORPUS_PATH = process.env.BREACHED_PASSWORD_FILE
  ? path.resolve(process.env.BREACHED_PASSWORD_FILE)
  : path.join(process.cwd(), 'assets', 'breached-passwords.txt');

let corpus: Set<string> | null = null;

function load(): Set<string> {
  if (corpus) return corpus;
  const next = new Set<string>();
  try {
    for (const line of readFileSync(CORPUS_PATH, 'utf8').split('\n')) {
      const entry = line.trim();
      if (entry.length > 0 && !entry.startsWith('#')) next.add(entry.toLowerCase());
    }
  } catch {
    // A missing corpus must not take the service down, and must not silently
    // pass every password either. It fails OPEN for availability but is
    // surfaced: `corpusSize()` reporting 0 is asserted by test, and the
    // operations panel will report it from Milestone 8.
    console.error('Breached-password corpus could not be read; the check is inactive.');
  }
  corpus = next;
  return corpus;
}

/** True when the password appears in the corpus. Case-insensitive. */
export function isBreached(password: string): boolean {
  return load().has(password.toLowerCase());
}

/** Number of loaded entries. 0 means the check is inactive. */
export function corpusSize(): number {
  return load().size;
}

/** Test seam: forces the next call to re-read the file. */
export function resetCorpusCache(): void {
  corpus = null;
}
