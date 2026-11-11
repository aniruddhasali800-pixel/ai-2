/**
 * Builds the React client next to the API bundle so one service can host both.
 * Called by `npm run build`; a host that only runs the backend's scripts still ends
 * up with frontend/dist for the API to serve.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const clientDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../frontend');

function run(...args) {
  // Shell mode because npm on Windows is a .cmd, which Node refuses to spawn directly.
  const { status } = spawnSync(args.join(' '), { cwd: clientDir, stdio: 'inherit', shell: true });
  if (status !== 0) {
    console.error(`[client] failed: ${args.join(' ')}`);
    process.exit(status ?? 1);
  }
}

if (!fs.existsSync(path.join(clientDir, 'package.json'))) {
  console.log('[client] no frontend workspace next to the API — skipping');
} else {
  // A cached node_modules can belong to an older dependency list, so npm reconciles it
  // against package.json on every build rather than being skipped for existing.
  console.log('[client] installing dependencies');
  run('npm', 'install', '--no-audit', '--no-fund');
  run('npm', 'run', 'build');
  console.log(`[client] built into ${path.relative(process.cwd(), path.join(clientDir, 'dist'))}`);
}
