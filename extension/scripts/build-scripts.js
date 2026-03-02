#!/usr/bin/env node
// Builds background.ts (ESM for MV3 service worker) and
// contentScript.ts (IIFE — content scripts cannot use ES module exports).
//
// Usage:
//   node scripts/build-scripts.js           # one-shot build
//   node scripts/build-scripts.js --watch   # rebuild on change
import * as esbuild from 'esbuild';

const watch = process.argv.includes('--watch');

const base = {
  bundle: true,
  outdir: 'dist',
  platform: 'browser',
  target: 'chrome100',
  sourcemap: watch ? 'inline' : false,
  logLevel: 'info',
};

if (watch) {
  const [bgCtx, csCtx] = await Promise.all([
    esbuild.context({
      ...base,
      entryPoints: { background: 'src/background/background.ts' },
      format: 'esm',
    }),
    esbuild.context({
      ...base,
      entryPoints: { contentScript: 'src/content/contentScript.ts' },
      format: 'iife',
    }),
  ]);

  await Promise.all([bgCtx.watch(), csCtx.watch()]);
  console.log('Watching background.ts and contentScript.ts …');
} else {
  await Promise.all([
    esbuild.build({
      ...base,
      entryPoints: { background: 'src/background/background.ts' },
      format: 'esm',
    }),
    esbuild.build({
      ...base,
      entryPoints: { contentScript: 'src/content/contentScript.ts' },
      format: 'iife',
    }),
  ]);
  console.log('Scripts built → dist/background.js, dist/contentScript.js');
}
