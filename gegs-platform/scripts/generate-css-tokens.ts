/**
 * Generates the CSS custom-property layer from src/design/tokens.ts.
 *
 * Phase 1 §10.1 promises that substituting Golden Eagle's real brand values is
 * a one-file change. That promise only holds if exactly one file holds the
 * values. Before this script the palette existed twice — once in tokens.ts and
 * once hand-copied into globals.css, which had already drifted: a token was
 * referenced that the stylesheet never defined, and six colours were written as
 * literals the token file could not reach.
 *
 * So the CSS is DERIVED, never authored. Run with --check in CI to fail the
 * build when the committed output no longer matches the source.
 *
 * Node runs this file directly: Node 22 strips the types, so there is no build
 * step and no extra dependency, the same arrangement server.ts uses.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  borderWidth,
  colour,
  focusRing,
  fontFamily,
  lineHeight,
  motionMs,
  radius,
  shadow,
  space,
  typeLimits,
  typeScale,
} from '../src/design/tokens.ts';

const OUTPUT = fileURLToPath(new URL('../src/design/tokens.generated.css', import.meta.url));

/** `navy900` -> `navy-900`, so the CSS name reads the way §10.1 writes it. */
function cssColourName(key: string): string {
  return key.replace(/([a-z]+)(\d+)$/, '$1-$2');
}

export function renderCss(): string {
  const lines: string[] = [
    '/*',
    ' * GENERATED FILE — DO NOT EDIT.',
    ' *',
    ' * Written by scripts/generate-css-tokens.ts from src/design/tokens.ts,',
    ' * which is the single source of truth for every design value (Phase 1 §10).',
    ' * Edit the tokens, then run `npm run tokens:generate`. CI runs',
    ' * `npm run tokens:check` and fails if this file has drifted.',
    ' */',
    ':root {',
    '  /* Colour (§10.1). Placeholders pending DECISION REQUIRED #14. */',
  ];

  for (const [key, hex] of Object.entries(colour)) {
    lines.push(`  --${cssColourName(key)}: ${hex.toLowerCase()};`);
  }

  lines.push('', '  /* Spacing (§10.3): 4px base scale. Nothing off-scale. */');
  for (const step of space) lines.push(`  --space-${step}: ${step / 16}rem;`);

  lines.push('', '  /* Type scale (§10.2): 1.25 ratio on a 16px base. */');
  for (const size of typeScale) lines.push(`  --text-${size}: ${size / 16}rem;`);

  lines.push(
    '',
    '  /* Typography (§10.2). Stacks only — no font file is loaded yet. */',
    `  --font-ui: ${fontFamily.ui};`,
    `  --font-display: ${fontFamily.display};`,
    `  --line-height-body: ${lineHeight.body};`,
    `  --line-height-display: ${lineHeight.display};`,
    `  --measure: ${typeLimits.measureCh}ch;`,
  );

  lines.push('', '  /* Radius (§10.3): encodes elevation rather than one global value. */');
  for (const [key, value] of Object.entries(radius)) {
    lines.push(`  --radius-${key}: ${value}px;`);
  }

  lines.push(
    '',
    '  /* Borders and the focus ring (§10.3, §10.4). */',
    `  --border-hairline: ${borderWidth.hairline}px;`,
    `  --border-emphasis: ${borderWidth.emphasis}px;`,
    `  --focus-ring-width: ${focusRing.widthPx}px;`,
    `  --focus-ring-offset: ${focusRing.offsetPx}px;`,
  );

  // §10.3 approves ONE shadow and where it may be used, but states no offset,
  // blur, colour or alpha. No property is emitted, because emitting one would
  // require inventing those values — see `shadow` in tokens.ts.
  lines.push(
    '',
    `  /* One shadow, used twice (§10.3): ${shadow.overlay.usage}. */`,
    '  /* Geometry UNDECIDED — no custom property until it is approved. */',
  );

  lines.push(
    '',
    '  /* Motion (§10.3): state transitions only. Removed under reduced motion. */',
    `  --motion-local: ${motionMs.local}ms;`,
    `  --motion-layout: ${motionMs.layout}ms;`,
  );

  lines.push('}', '');
  return lines.join('\n');
}

function main(): void {
  const rendered = renderCss();
  const check = process.argv.includes('--check');

  if (!check) {
    writeFileSync(OUTPUT, rendered, 'utf8');
    console.error('Wrote src/design/tokens.generated.css from src/design/tokens.ts.');
    return;
  }

  let current = '';
  try {
    current = readFileSync(OUTPUT, 'utf8');
  } catch {
    console.error('Token CSS is MISSING. Run `npm run tokens:generate`.');
    process.exit(1);
  }

  if (current !== rendered) {
    console.error(
      'Token CSS has DRIFTED from src/design/tokens.ts.\n' +
        'The generated stylesheet no longer matches the tokens it is derived from,\n' +
        'so the application and the contrast gate would disagree.\n' +
        'Run `npm run tokens:generate` and commit the result.',
    );
    process.exit(1);
  }

  console.error('Token CSS matches src/design/tokens.ts.');
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main();
}
