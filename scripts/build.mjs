import { cp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn } from 'node:child_process';
import { createRequire } from 'node:module';
import { build as esbuild } from 'esbuild';
import autoprefixer from 'autoprefixer';
import postcss from 'postcss';
import tailwindcss from 'tailwindcss';

const require = createRequire(import.meta.url);
const rootDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const distDir = path.join(rootDir, 'dist');
const extensionSourceDir = path.join(rootDir, 'extension');
const extensionDistDir = path.join(distDir, 'extension');
const tscBinPath = require.resolve('typescript/bin/tsc');

const runNode = (args) =>
  new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: rootDir,
      stdio: 'inherit',
    });

    child.on('exit', (code) => {
      if (code === 0) {
        resolve();
        return;
      }

      reject(new Error(`Command failed with exit code ${code ?? 'unknown'}.`));
    });
  });

await rm(distDir, { force: true, recursive: true });
await runNode([tscBinPath, '--project', 'tsconfig.build.json']);
await mkdir(extensionDistDir, { recursive: true });

const cssInput = await readFile(path.join(extensionSourceDir, 'globals.css'), 'utf8');
const cssResult = await postcss([
  tailwindcss({
    config: path.join(rootDir, 'tailwind.config.mjs'),
  }),
  autoprefixer(),
]).process(cssInput, {
  from: path.join(extensionSourceDir, 'globals.css'),
  to: path.join(extensionDistDir, 'ui.css'),
});

await writeFile(path.join(extensionDistDir, 'ui.css'), cssResult.css, 'utf8');

await esbuild({
  bundle: true,
  define: {
    'process.env.NODE_ENV': '"production"',
  },
  entryPoints: {
    background: path.join(extensionSourceDir, 'background.ts'),
    'page-probe': path.join(extensionSourceDir, 'page-probe.ts'),
    popup: path.join(extensionSourceDir, 'popup.tsx'),
    sidepanel: path.join(extensionSourceDir, 'sidepanel.tsx'),
    'storage-capture': path.join(extensionSourceDir, 'storage-capture.ts'),
  },
  format: 'iife',
  jsx: 'automatic',
  legalComments: 'none',
  minify: true,
  outdir: extensionDistDir,
  platform: 'browser',
  sourcemap: false,
  target: ['chrome120'],
});
await cp(path.join(extensionSourceDir, 'manifest.json'), path.join(extensionDistDir, 'manifest.json'));
await cp(path.join(extensionSourceDir, 'popup.html'), path.join(extensionDistDir, 'popup.html'));
await cp(path.join(extensionSourceDir, 'sidepanel.html'), path.join(extensionDistDir, 'sidepanel.html'));
