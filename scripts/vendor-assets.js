#!/usr/bin/env node
/**
 * Copies vendored frontend assets from node_modules into app/resources/vendor
 * so index.html can load them locally with no runtime network access.
 * Idempotent: wipes the vendor dir and recopies every run.
 */

const fs = require('fs');
const path = require('path');

const repoRoot = path.resolve(__dirname, '..');
const nodeModules = path.join(repoRoot, 'node_modules');
const vendorDir = path.join(repoRoot, 'app', 'resources', 'vendor');

const files = [
  // Preact + hooks + htm
  ['preact/dist/preact.umd.js', 'preact/preact.umd.js'],
  ['preact/hooks/dist/hooks.umd.js', 'preact/hooks.umd.js'],
  ['htm/dist/htm.umd.js', 'htm/htm.umd.js'],

  // CodeMirror core
  ['codemirror/lib/codemirror.js', 'codemirror/codemirror.js'],
  ['codemirror/lib/codemirror.css', 'codemirror/codemirror.css'],

  // CodeMirror modes
  ['codemirror/mode/xml/xml.js', 'codemirror/mode/xml/xml.js'],
  ['codemirror/mode/javascript/javascript.js', 'codemirror/mode/javascript/javascript.js'],
  ['codemirror/mode/css/css.js', 'codemirror/mode/css/css.js'],
  ['codemirror/mode/htmlmixed/htmlmixed.js', 'codemirror/mode/htmlmixed/htmlmixed.js'],

  // CodeMirror addons
  ['codemirror/addon/hint/show-hint.js', 'codemirror/addon/hint/show-hint.js'],
  ['codemirror/addon/hint/show-hint.css', 'codemirror/addon/hint/show-hint.css'],
  ['codemirror/addon/edit/closebrackets.js', 'codemirror/addon/edit/closebrackets.js'],
  ['codemirror/addon/edit/closetag.js', 'codemirror/addon/edit/closetag.js'],
  ['codemirror/addon/fold/foldcode.js', 'codemirror/addon/fold/foldcode.js'],
  ['codemirror/addon/fold/foldgutter.js', 'codemirror/addon/fold/foldgutter.js'],
  ['codemirror/addon/fold/foldgutter.css', 'codemirror/addon/fold/foldgutter.css'],
  ['codemirror/addon/fold/brace-fold.js', 'codemirror/addon/fold/brace-fold.js'],
  ['codemirror/addon/fold/xml-fold.js', 'codemirror/addon/fold/xml-fold.js'],
];

function rmrf(p) {
  if (fs.existsSync(p)) fs.rmSync(p, { recursive: true, force: true });
}

function copyFile(src, dst) {
  fs.mkdirSync(path.dirname(dst), { recursive: true });
  fs.copyFileSync(src, dst);
}

function main() {
  if (!fs.existsSync(nodeModules)) {
    console.error('[vendor-assets] node_modules not found; skipping. Run npm install first.');
    process.exit(0);
  }

  rmrf(vendorDir);
  fs.mkdirSync(vendorDir, { recursive: true });

  let missing = [];
  for (const [from, to] of files) {
    const src = path.join(nodeModules, from);
    const dst = path.join(vendorDir, to);
    if (!fs.existsSync(src)) {
      missing.push(from);
      continue;
    }
    copyFile(src, dst);
  }

  if (missing.length) {
    console.error('[vendor-assets] Missing source files:');
    for (const m of missing) console.error('  - ' + m);
    process.exit(1);
  }

  console.log(`[vendor-assets] Vendored ${files.length} files into ${path.relative(repoRoot, vendorDir)}`);
}

main();
