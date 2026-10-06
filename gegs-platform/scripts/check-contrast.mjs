#!/usr/bin/env node
/**
 * Colour contrast gate (Phase 1 §10.1).
 *
 * Phase 1 recorded measured ratios for the whole palette and rejected two
 * candidate values that failed WCAG. This script re-measures them on every CI
 * run so a future colour change cannot quietly reintroduce either failure.
 *
 * It reads the token table out of the TypeScript source rather than duplicating
 * the hex values, so the gate and the application can never disagree.
 */
import { readFileSync } from 'node:fs';

const source = readFileSync(new URL('../src/design/tokens.ts', import.meta.url), 'utf8');

function parseColours(src) {
  const block = src.match(/export const colour = \{([\s\S]*?)\n\} as const;/);
  if (!block) throw new Error('Could not locate the `colour` token block in tokens.ts');
  const out = {};
  for (const [, key, hex] of block[1].matchAll(/(\w+):\s*'(#[0-9a-fA-F]{6})'/g)) out[key] = hex;
  return out;
}

function parseRequirements(src) {
  const block = src.match(/export const CONTRAST_REQUIREMENTS[\s\S]*?\n\] as const;/);
  if (!block) throw new Error('Could not locate CONTRAST_REQUIREMENTS in tokens.ts');
  const rows = [];
  const re =
    /foreground:\s*'(\w+)',\s*background:\s*'(\w+)',\s*minimum:\s*([\d.]+),\s*usage:\s*'([^']*)'/g;
  for (const [, foreground, background, minimum, usage] of block[0].matchAll(re)) {
    rows.push({ foreground, background, minimum: Number(minimum), usage });
  }
  return rows;
}

const channel = (v) => {
  const c = v / 255;
  return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
};
const luminance = (hex) => {
  const h = hex.replace('#', '');
  return (
    0.2126 * channel(parseInt(h.slice(0, 2), 16)) +
    0.7152 * channel(parseInt(h.slice(2, 4), 16)) +
    0.0722 * channel(parseInt(h.slice(4, 6), 16))
  );
};
const ratio = (a, b) => {
  const [x, y] = [luminance(a), luminance(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
};

const colours = parseColours(source);
const requirements = parseRequirements(source);

if (requirements.length === 0)
  throw new Error('No contrast requirements parsed — gate would be vacuous');

const failures = [];
console.error('\nColour contrast gate (WCAG 2.2)\n');
for (const r of requirements) {
  const fg = colours[r.foreground];
  const bg = colours[r.background];
  if (!fg || !bg) {
    failures.push(`${r.foreground} on ${r.background}: token missing from the palette`);
    continue;
  }
  const value = ratio(fg, bg);
  const pass = value >= r.minimum;
  if (!pass) {
    failures.push(
      `${r.usage}: ${r.foreground} ${fg} on ${r.background} ${bg} = ${value.toFixed(2)} (needs ${r.minimum})`,
    );
  }
  console.error(
    `  ${pass ? 'pass' : 'FAIL'}  ${value.toFixed(2).padStart(5)} / ${String(r.minimum).padEnd(3)}  ${r.usage}`,
  );
}

if (failures.length > 0) {
  console.error(`\nContrast gate FAILED — ${failures.length} pair(s):\n`);
  for (const f of failures) console.error(`  ${f}`);
  console.error('');
  process.exit(1);
}
console.error(`\nContrast gate passed: ${requirements.length} pairs measured.\n`);
