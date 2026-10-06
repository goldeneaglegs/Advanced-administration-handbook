#!/usr/bin/env node
/**
 * Secret scan. Fails the build if anything that looks like a credential is
 * tracked in the repository.
 *
 * Phase 2 implementation rules 4 and 5, and the Phase 1 §14.1 security gate.
 * This is a repository-hygiene gate, not a replacement for a dedicated scanner
 * on the hosting platform — it checks git-tracked files only, which is exactly
 * the surface that leaks when a repository is shared or made public.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync, statSync } from 'node:fs';
import { pathToFileURL } from 'node:url';

const PATTERNS = [
  { name: 'AWS access key id', re: /\b(?:AKIA|ASIA)[0-9A-Z]{16}\b/ },
  { name: 'AWS secret access key', re: /aws_secret_access_key\s*[=:]\s*['"]?[A-Za-z0-9/+=]{40}/i },
  { name: 'private key block', re: /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/ },
  { name: 'GitHub token', re: /\bgh[pousr]_[A-Za-z0-9]{36,}\b/ },
  { name: 'Slack token', re: /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/ },
  { name: 'Google API key', re: /\bAIza[0-9A-Za-z_-]{35}\b/ },
  { name: 'Stripe secret key', re: /\bsk_(?:live|test)_[0-9A-Za-z]{16,}\b/ },
  {
    name: 'JSON web token',
    re: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/,
  },
  {
    name: 'generic assigned secret',
    re: /\b(?:password|passwd|secret|api[_-]?key|access[_-]?token|client[_-]?secret)\s*[=:]\s*['"][^'"\n]{8,}['"]/i,
  },
  { name: 'postgres URL with password', re: /postgres(?:ql)?:\/\/[^:\s/]+:[^@\s/]+@/ },
];

/**
 * Files permitted to contain local development fixtures.
 *
 * These hold deliberately non-secret local credentials that must match each
 * other for `docker compose up` to work. Allowing them by exact path — rather
 * than by a loose pattern — means a real secret committed anywhere else still
 * fails the gate.
 */
const FIXTURE_FILES = new Set(['.env.example', 'docker-compose.yml', 'README.md']);

const BINARY_OR_GENERATED = /\.(?:png|jpe?g|gif|webp|ico|pdf|woff2?|ttf|eot|zip|gz|tgz|lock)$/i;
const MAX_BYTES = 2_000_000;

function trackedFiles() {
  const out = execFileSync('git', ['ls-files', '-z'], { encoding: 'utf8' });
  return out.split('\0').filter(Boolean);
}

/**
 * Whether a match is explicitly allowed.
 *
 * The marker may sit on the matching line or the line immediately above it, so
 * a formatter that reflows a long comment onto its own line cannot silently
 * disarm the exemption — or silently re-arm it.
 */
function isAllowed(lines, index) {
  const current = lines[index] ?? '';
  const previous = index > 0 ? (lines[index - 1] ?? '') : '';
  return current.includes(ALLOW_MARKER) || previous.includes(ALLOW_MARKER);
}

const ALLOW_MARKER = 'secret-scan-allow';

export function scanText(file, text, { isFixture = false } = {}) {
  const found = [];
  const lines = text.split('\n');
  lines.forEach((line, i) => {
    if (isAllowed(lines, i)) return;
    for (const { name, re } of PATTERNS) {
      if (!re.test(line)) continue;
      const hardFail = HARD_FAIL_RE.test(name);
      if (isFixture && !hardFail) continue;
      found.push({ file, line: i + 1, name });
    }
  });
  return found;
}

/**
 * Credential classes that are never legitimate in a fixture file. A local
 * development password is plausible; a real cloud key or a private key never is.
 */
const HARD_FAIL_RE = /AWS|private key|GitHub|Slack|Google|Stripe|web token/;

/**
 * Scans every git-tracked file and returns the findings.
 *
 * Exported and side-effect free so the gate can be unit tested. The process
 * only exits when this file is run directly — importing it must never scan or
 * terminate, or the tests would inherit its exit code.
 */
export function scanRepository() {
  const findings = [];
  for (const file of trackedFiles()) {
    if (BINARY_OR_GENERATED.test(file)) continue;
    if (file === 'package-lock.json') continue;

    let text;
    try {
      if (statSync(file).size > MAX_BYTES) continue;
      text = readFileSync(file, 'utf8');
    } catch {
      continue;
    }
    if (text.includes('\0')) continue;

    // A fixture file may hold local non-secret credentials, but never a real
    // cloud key or a private key — those are never "local".
    findings.push(...scanText(file, text, { isFixture: FIXTURE_FILES.has(file) }));
  }
  return findings;
}

function main() {
  const findings = scanRepository();

  if (findings.length > 0) {
    console.error(`\nSecret scan FAILED \u2014 ${findings.length} finding(s):\n`);
    for (const f of findings) {
      // The matched value is never printed: doing so would copy the secret into
      // the CI log, which is itself a disclosure.
      console.error(`  ${f.file}:${f.line}  ${f.name}`);
    }
    console.error('\nRemove the value, move it to an environment variable, and rotate it.');
    console.error(
      'If this is a false positive, put a "secret-scan-allow" comment on that line or the line above.\n',
    );
    process.exit(1);
  }

  console.error('Secret scan passed. No credentials found in tracked files.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
