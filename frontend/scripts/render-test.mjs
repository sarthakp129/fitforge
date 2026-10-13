/**
 * Bundles test/render.test.jsx with the local esbuild and runs it under Node.
 * Keeps JSX out of the runtime while needing no extra dependencies.
 */
import { build } from 'esbuild';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const out = join(mkdtempSync(join(tmpdir(), 'fitforge-render-')), 'bundle.cjs');

await build({
  entryPoints: [join(root, 'test/render.test.jsx')],
  outfile: out,
  bundle: true,
  platform: 'node',
  format: 'cjs',
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  define: { 'import.meta.env': '{}' },
  logLevel: 'error',
  absWorkingDir: root,
});

const res = spawnSync(process.execPath, [out], { stdio: 'inherit' });
rmSync(dirname(out), { recursive: true, force: true });
process.exit(res.status ?? 1);
