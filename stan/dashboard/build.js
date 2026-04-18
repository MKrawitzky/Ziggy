#!/usr/bin/env node
/**
 * Pre-compiles JSX → vendor/app.js
 *
 * Source resolution (first match wins):
 *   1. components/_manifest.json  — ordered list of component files in
 *      public/components/; each is a plain JSX fragment (no import/export).
 *      Concatenated in manifest order before compilation.
 *   2. public/_app.jsx            — legacy monolithic source file (kept as
 *      the canonical single-file form; component files are canonical splits).
 *   3. Inline <script type="text/babel"> in index.html (backwards compat).
 *
 * Run after editing any component file:
 *   node stan/dashboard/build.js
 */
const fs   = require('fs');
const path = require('path');
const babel = require('@babel/core');

const publicDir    = path.join(__dirname, 'public');
const componentsDir = path.join(publicDir, 'components');
const manifestPath  = path.join(componentsDir, '_manifest.json');
const appJsxPath    = path.join(publicDir, '_app.jsx');

let jsx;
let sourceDesc;

if (fs.existsSync(manifestPath)) {
  // ── Component-based build ──────────────────────────────────────────
  const manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
  const parts = manifest.map(fname => {
    const p = path.join(componentsDir, fname);
    if (!fs.existsSync(p)) throw new Error(`Manifest entry not found: ${p}`);
    return fs.readFileSync(p, 'utf8');
  });
  jsx = parts.join('\n');
  sourceDesc = `${manifest.length} component files`;

} else if (fs.existsSync(appJsxPath)) {
  // ── Monolithic _app.jsx ───────────────────────────────────────────
  jsx = fs.readFileSync(appJsxPath, 'utf8');
  sourceDesc = '_app.jsx';

} else {
  // ── Inline HTML fallback ──────────────────────────────────────────
  const html = fs.readFileSync(path.join(publicDir, 'index.html'), 'utf8');
  const startTag = '<script type="text/babel">';
  const startIdx = html.indexOf(startTag) + startTag.length;
  const endIdx   = html.lastIndexOf('</script>');
  jsx = html.slice(startIdx, endIdx);
  sourceDesc = 'index.html inline script';
}

console.log(`Compiling ${jsx.length} chars of JSX from ${sourceDesc}...`);

const result = babel.transformSync(jsx, {
  presets: [['@babel/preset-react', { runtime: 'classic' }]],
  filename: 'app.jsx',
  sourceMaps: false,
});

const outPath = path.join(publicDir, 'vendor', 'app.js');
fs.writeFileSync(outPath, result.code);
console.log(`Written ${result.code.length} chars → ${outPath}`);
