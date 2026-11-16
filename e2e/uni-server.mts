import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);
const uniRequire = createRequire(path.join(root, 'apps/uni/package.json'));
const directory = mkdtempSync(path.join(tmpdir(), 'little-world-uni-'));
const children: ChildProcess[] = [];
const environment = {
  ...process.env,
  DATABASE_URL: `file:${path.join(directory, 'world.db').replaceAll('\\', '/')}`,
  STORAGE_DIR: path.join(directory, 'storage'),
  ASSET_SECRET: 'isolated-uni-browser-test-secret-at-least-32',
  AUTO_BACKUP_HOURS: '0',
  PORT: '3002',
  HOST: '127.0.0.1',
  RUST_LOG: 'info',
  CORS_ORIGINS: 'http://127.0.0.1:5175',
  VITE_API_BASE: 'http://127.0.0.1:3002/api',
};
let stopping = false;

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  await Promise.all(
    children.map(
      (child) =>
        new Promise<void>((resolve) => {
          if (child.exitCode !== null || child.signalCode !== null) return resolve();
          const timer = setTimeout(() => {
            child.kill('SIGKILL');
            resolve();
          }, 3000);
          child.once('exit', () => {
            clearTimeout(timer);
            resolve();
          });
          child.kill();
        }),
    ),
  );
  if (
    path.dirname(directory) === path.resolve(tmpdir()) &&
    path.basename(directory).startsWith('little-world-uni-')
  ) {
    try {
      rmSync(directory, { recursive: true });
    } catch (error) {
      console.error('Temporary test files could not be removed:', (error as Error).message);
    }
  }
  process.exit(code);
}
process.once('SIGINT', () => void stop());
process.once('SIGTERM', () => void stop());

function launch(args: string[], cwd = root) {
  const child = spawn(process.execPath, args, {
    cwd,
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
  });
  children.push(child);
  child.once('error', (error) => {
    console.error(error.message);
    void stop(1);
  });
  child.once('exit', () => {
    if (!stopping) void stop(1);
  });
  return child;
}

try {
  // Never attach this destructive workflow test to another running API instance.
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(3002, '127.0.0.1', () => probe.close(() => resolve()));
  });
  execFileSync(
    process.execPath,
    [
      require.resolve('prisma/build/index.js'),
      'migrate',
      'deploy',
      '--schema',
      'apps/api/prisma/schema.prisma',
    ],
    { cwd: root, env: environment, stdio: 'pipe' },
  );
  execFileSync(process.execPath, ['--import', 'tsx', 'apps/uni/scripts/prepare-components.ts'], {
    cwd: root,
    env: environment,
    stdio: 'inherit',
  });
  const api = launch(['--import', 'tsx', 'apps/api/src/main.ts']);
  let ready = false;
  for (let attempt = 0; attempt < 80; attempt++) {
    if (api.exitCode !== null) throw new Error('Isolated uni API exited before becoming ready');
    try {
      const response = await fetch('http://127.0.0.1:3002/api/health', {
        signal: AbortSignal.timeout(1000),
      });
      if (response.ok) {
        ready = true;
        break;
      }
    } catch {}
    await delay(250);
  }
  if (!ready) throw new Error('Isolated uni API did not start');
  const uniCli = path.join(
    path.dirname(uniRequire.resolve('@dcloudio/vite-plugin-uni/package.json')),
    'bin/uni.js',
  );
  launch([uniCli, '--host', '127.0.0.1', '--port', '5175'], path.join(root, 'apps/uni'));
} catch (error) {
  console.error((error as Error).message);
  await stop(1);
}
