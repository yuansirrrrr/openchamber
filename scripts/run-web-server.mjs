#!/usr/bin/env node
import { spawn } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const repoRoot = path.resolve(__dirname, '..');
const webRoot = path.join(repoRoot, 'packages/web');
const bunCommand = process.env.OPENCHAMBER_BUN_COMMAND || process.env.npm_execpath || 'bun';
const port = process.env.OPENCHAMBER_PORT || '3001';

const child = spawn(bunCommand, ['server/index.js', '--port', port], {
  cwd: webRoot,
  stdio: 'inherit',
  env: process.env,
});

child.on('error', (error) => {
  console.error('[run:web:server] Failed to start:', error);
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
