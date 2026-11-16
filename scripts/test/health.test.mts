import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

async function probe(script: string, args: string[] = []) {
  const child = spawn(process.execPath, ['--experimental-strip-types', script, ...args], {
    stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true,
    env: Object.fromEntries(Object.entries(process.env).filter(([key]) => key !== 'PORT')),
  });
  let output = '';
  child.stdout.on('data', data => { output += data; });
  child.stderr.on('data', data => { output += data; });
  const status = await new Promise<number | null>((resolve, reject) => { child.once('error', reject); child.once('exit', resolve); });
  return { status, output };
}

test('health uses the configured port in a local root .env', async context => {
  const root = mkdtempSync(path.join(os.tmpdir(), 'world-health-'));
  context.after(() => rmSync(root, { recursive: true, force: true }));
  mkdirSync(path.join(root, 'scripts'));
  const scripts = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
  for (const name of ['health.mts', 'runtime.mts']) copyFileSync(path.join(scripts, name), path.join(root, 'scripts', name));
  const server = createServer((req, res) => {
    assert.equal(req.url, '/api/health');
    res.setHeader('Content-Type', 'application/json');
    res.end('{"ok":true}');
  });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  context.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  writeFileSync(path.join(root, '.env'), `PORT=${address.port}\n`);
  const result = await probe(path.join(root, 'scripts/health.mts'));
  assert.equal(result.status, 0, result.output);
});

test('health rejects a successful HTTP response that is not an API health result', async context => {
  const server = createServer((_req, res) => { res.setHeader('Content-Type', 'application/json'); res.end('{"ok":false}'); });
  await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
  context.after(() => server.close());
  const address = server.address();
  assert.ok(address && typeof address !== 'string');
  const script = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../health.mts');
  const result = await probe(script, [`http://127.0.0.1:${address.port}`]);
  assert.notEqual(result.status, 0, result.output);
});
