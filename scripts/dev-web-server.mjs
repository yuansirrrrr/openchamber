#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const webRoot = path.join(repoRoot, 'packages/web');
const bunCommand = process.env.npm_execpath || 'bun';
const port = process.env.OPENCHAMBER_PORT || '3001';
const watch = process.argv.includes('--watch');
const serverRunner = path.join(repoRoot, 'scripts/run-web-server.mjs');

const args = watch
  ? [
      'x',
      'nodemon',
      '--watch',
      'server',
      '--ext',
      'js',
      '--exec',
      `node "${serverRunner}"`,
    ]
  : ['server/index.js', '--port', port];

const child = spawn(bunCommand, args, {
  cwd: webRoot,
  stdio: 'inherit',
  env: {
    ...process.env,
    OPENCHAMBER_PORT: port,
    OPENCHAMBER_BUN_COMMAND: bunCommand,
  },
});

child.on('error', (error) => {
  console.error('[dev:web:server] Failed to start:', error);
});

child.on('exit', (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

for (const signal of ['SIGINT', 'SIGTERM', 'SIGHUP']) {
  process.on(signal, () => {
    child.kill(signal);
  });
}
