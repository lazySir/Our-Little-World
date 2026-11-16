import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';

const require = createRequire(import.meta.url);
const root = path.resolve(import.meta.dirname, '../..');
const modulePath = (filename: string) => filename.replaceAll('\\', '/');

async function assertPortReleased(port: number) {
  await new Promise<void>((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(port, '127.0.0.1', () => server.close(() => resolve()));
  });
}

for (const kind of ['web', 'uni'] as const) {
  test(`${kind} Playwright teardown removes its isolated database and uploads`, async (context) => {
    const temporary = await mkdtemp(path.join(tmpdir(), `world-${kind}-cleanup-check-`));
    context.after(async () => {
      if (path.dirname(path.resolve(temporary)) !== path.resolve(tmpdir()) || !path.basename(temporary).startsWith(`world-${kind}-cleanup-check-`))
        throw new Error('Unexpected cleanup-test directory');
      await rm(temporary, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
    });
    const source = path.join(root, kind === 'web' ? 'e2e/web.config.ts' : 'apps/uni/playwright.config.ts');
    const config = path.join(temporary, 'playwright.config.ts');
    await writeFile(config, `
import source from ${JSON.stringify(modulePath(source))};
export default {
  ...source,
  testDir: ${JSON.stringify(modulePath(temporary))},
  testMatch: 'cleanup.spec.ts',
  outputDir: ${JSON.stringify(modulePath(path.join(temporary, 'results')))},
  reporter: [['line']],
  ...(source.webServer ? { webServer: { ...source.webServer, cwd: ${JSON.stringify(modulePath(root))} } } : {}),
  ...(source.globalSetup ? { globalSetup: ${JSON.stringify(modulePath(path.resolve(path.dirname(source), kind === 'web' ? 'web-server.mts' : '../../e2e/uni-server.mts')))} } : {}),
};
`);
    const testApi = modulePath(require.resolve('@playwright/test'));
    const port = kind === 'web' ? 3001 : 3002;
    await writeFile(path.join(temporary, 'cleanup.spec.ts'), `
import { test, expect } from ${JSON.stringify(testApi)};
test('isolated test service is ready', async () => {
  const result = await fetch('http://127.0.0.1:${port}/api/auth/status');
  expect(result.ok).toBe(true);
  expect(await result.json()).toEqual({ initialized: false });
});
`);
    const child = spawn(process.execPath, [require.resolve('@playwright/test/cli'), 'test', '--config', config], {
      cwd: root,
      env: { ...process.env, TEMP: temporary, TMP: temporary },
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
    });
    let output = '';
    child.stdout.on('data', (data) => { output += data; });
    child.stderr.on('data', (data) => { output += data; });
    const status = await new Promise<number | null>((resolve, reject) => {
      child.once('error', reject);
      child.once('close', resolve);
    });
    assert.equal(status, 0, output);
    const leftovers = (await readdir(temporary)).filter((name) => name.startsWith(`little-world-${kind}-`));
    assert.deepEqual(leftovers, [], 'test database/upload directory remained after Playwright exited');
    await assertPortReleased(port);
    await assertPortReleased(kind === 'web' ? 5174 : 5175);
  });
}
