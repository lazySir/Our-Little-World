import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { webTestEndpoint } from './web-endpoint.mts';
import { createTestCleanup, trackChild } from './process-cleanup.mts';

const root = path.resolve(import.meta.dirname, '..');
const require = createRequire(import.meta.url);

async function assertPortFree(port: number) {
  await new Promise<void>((resolve, reject) => {
    const probe = createServer();
    probe.once('error', reject);
    probe.listen(port, '127.0.0.1', () => probe.close(() => resolve()));
  });
}

/** Playwright owns this returned teardown, so Windows cannot skip it by killing webServer. */
export async function startTestServer(kind: 'web' | 'uni') {
  const apiPort = kind === 'web' ? 3001 : 3002;
  const pagePort = kind === 'web' ? webTestEndpoint().port : 5175;
  await assertPortFree(apiPort);
  await assertPortFree(pagePort);
  const directory = await mkdtemp(path.join(tmpdir(), `little-world-${kind}-`));
  const children: ChildProcess[] = [];
  const environment = {
    ...process.env,
    DATABASE_URL: `file:${path.join(directory, 'world.db').replaceAll('\\', '/')}`,
    STORAGE_DIR: path.join(directory, 'storage'),
    SETUP_TOKEN: '',
    ASSET_SECRET: `isolated-${kind}-browser-test-secret-at-least-32`,
    AUTO_BACKUP_HOURS: '0',
    PORT: String(apiPort),
    HOST: '127.0.0.1',
    RUST_LOG: 'info',
    CORS_ORIGINS: `http://127.0.0.1:${pagePort}`,
    VITE_API_BASE: kind === 'uni' ? `http://127.0.0.1:${apiPort}/api` : '/api',
    API_PROXY_TARGET: `http://127.0.0.1:${apiPort}`,
  };
  process.env.E2E_STORAGE_DIR = environment.STORAGE_DIR;
  let stopping = false;
  let failure: Error | undefined;
  const cleanup = createTestCleanup(children, async () => {
    const target = path.resolve(directory);
    if (
      path.dirname(target) !== path.resolve(tmpdir()) ||
      !path.basename(target).startsWith(`little-world-${kind}-`)
    )
      throw new Error('Unexpected test storage location');
    await rm(target, { recursive: true, force: true, maxRetries: 20, retryDelay: 150 });
  });
  const stop = () => {
    stopping = true;
    return cleanup();
  };
  function launch(args: string[], cwd = root) {
    const child = trackChild(
      spawn(process.execPath, args, {
        cwd,
        env: environment,
        stdio: 'inherit',
        windowsHide: true,
        detached: process.platform !== 'win32',
      }),
    );
    children.push(child);
    child.once('error', (error) => {
      failure = error;
    });
    child.once('exit', (code) => {
      if (!stopping) failure = new Error(`Isolated ${kind} test service exited (${code})`);
    });
    return child;
  }
  async function waitReady(url: string) {
    for (let attempt = 0; attempt < 160; attempt++) {
      if (failure) throw failure;
      try {
        if ((await fetch(url, { signal: AbortSignal.timeout(1000) })).ok) return;
      } catch {}
      await delay(250);
    }
    throw new Error(`Isolated test service did not start: ${url}`);
  }
  try {
    execFileSync(
      process.execPath,
      [require.resolve('prisma/build/index.js'), 'generate', '--config', 'apps/api/prisma.config.ts'],
      { cwd: root, env: environment, stdio: 'pipe', windowsHide: true },
    );
    execFileSync(
      process.execPath,
      [
        require.resolve('prisma/build/index.js'),
        'migrate',
        'deploy',
        '--config',
        'apps/api/prisma.config.ts',
      ],
      {
        cwd: root,
        env: environment,
        stdio: 'pipe',
        windowsHide: true,
      },
    );
    if (kind === 'uni')
      execFileSync(
        process.execPath,
        ['--import', 'tsx', 'apps/uni/scripts/prepare-components.ts'],
        {
          cwd: root,
          env: environment,
          stdio: 'inherit',
          windowsHide: true,
        },
      );
    launch(['--import', 'tsx', 'apps/api/src/main.ts']);
    await waitReady(`http://127.0.0.1:${apiPort}/api/health`);
    process.env.E2E_SETUP_TOKEN = (
      await readFile(path.join(environment.STORAGE_DIR, '.setup-token'), 'utf8').catch(() => '')
    ).trim();
    const appRequire = createRequire(path.join(root, `apps/${kind}/package.json`));
    const cli =
      kind === 'uni'
        ? path.join(
            path.dirname(appRequire.resolve('@dcloudio/vite-plugin-uni/package.json')),
            'bin/uni.js',
          )
        : path.join(path.dirname(appRequire.resolve('vite/package.json')), 'bin/vite.js');
    launch(
      [cli, '--host', '127.0.0.1', '--port', String(pagePort)],
      path.join(root, `apps/${kind}`),
    );
    await waitReady(`http://127.0.0.1:${pagePort}`);
    return async () => {
      await stop();
      if (failure) throw failure;
    };
  } catch (error) {
    await stop();
    throw error;
  }
}
