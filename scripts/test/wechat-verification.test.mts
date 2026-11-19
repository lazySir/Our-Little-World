import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import net from 'node:net';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import vm from 'node:vm';
import {
  assertAutomationPortFree,
  assertProjectIdentity,
  connectAfterLaunch,
  createVerificationProject,
  runBounded,
  verificationOptions,
  verificationResult,
  waitForAppReady,
} from '../wechat-verification.mts';

test('WeChat acceptance validates ports and a bounded run before opening the IDE', () => {
  const options = verificationOptions({});
  assert.equal(options.automationPort, 9431);
  assert.equal(options.idePort, 9432);
  assert.equal(options.timeoutMs, 240000);
  assert.equal(
    verificationOptions({ WECHAT_AUTO_PORT: '9531', WECHAT_IDE_PORT: '9532' }).automationPort,
    9531,
  );
  for (const value of ['0', '-1', '65536', '9.5', 'abc', ' 9431 ']) {
    assert.throws(() => verificationOptions({ WECHAT_AUTO_PORT: value }), /WECHAT_AUTO_PORT/);
    assert.throws(() => verificationOptions({ WECHAT_IDE_PORT: value }), /WECHAT_IDE_PORT/);
  }
  assert.throws(() => verificationOptions({ WECHAT_AUTO_PORT: '9432' }), /different/);
  assert.throws(() => verificationOptions({ WECHAT_TIMEOUT_MS: 'Infinity' }), /WECHAT_TIMEOUT_MS/);
});

test('occupied automation ports are refused without connecting to their owner', async () => {
  let connected = false;
  const server = net.createServer((socket) => {
    connected = true;
    socket.destroy();
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  try {
    const port = (server.address() as net.AddressInfo).port;
    await assert.rejects(assertAutomationPortFree(port), /already in use/);
    assert.equal(connected, false);
    assert.equal(server.listening, true);
  } finally {
    await new Promise<void>((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
});

test('verification copies get their own identity and development settings while the build stays intact', async () => {
  const root = await mkdtemp(path.join(os.tmpdir(), 'world-wechat-copy-test-'));
  try {
    const source = path.join(root, 'build');
    const destination = path.join(root, 'project');
    await mkdir(source);
    const original = JSON.stringify({
      appid: 'real-app-id',
      projectname: 'Actual app',
      setting: { urlCheck: true, es6: true },
    });
    await writeFile(path.join(source, 'project.config.json'), original);
    await writeFile(
      path.join(source, 'project.private.config.json'),
      '{"projectname":"Old private config"}',
    );
    await writeFile(path.join(source, 'app.json'), '{}');
    const originalApp = 'globalThis.appLoaded = true;';
    await writeFile(path.join(source, 'app.js'), originalApp);
    const identity = await createVerificationProject(source, destination, 'test-run-123');
    assert.equal(await readFile(path.join(source, 'project.config.json'), 'utf8'), original);
    const copy = JSON.parse(await readFile(path.join(destination, 'project.config.json'), 'utf8'));
    assert.equal(copy.appid, 'touristappid');
    assert.equal(copy.setting.urlCheck, false);
    assert.equal(copy.setting.es6, true);
    assert.equal(copy.projectname, 'little-world-verify-test-run-123');
    assert.equal(await readFile(path.join(source, 'app.js'), 'utf8'), originalApp);
    const app: { __worldVerificationMarker?: string } = {};
    const context = vm.createContext({ getApp: () => app });
    vm.runInContext(await readFile(path.join(destination, 'app.js'), 'utf8'), context);
    assert.equal(app.__worldVerificationMarker, identity.marker);
    assert.equal(context.appLoaded, true);
    await assert.rejects(readFile(path.join(destination, 'project.private.config.json')), /ENOENT/);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test('a foreign project marker is rejected before any state can be changed', async () => {
  await assert.rejects(
    assertProjectIdentity(async () => 'someone-elses-project', 'this-run'),
    /identity mismatch/,
  );
  await assert.rejects(
    assertProjectIdentity(async () => {
      throw new Error('not in package');
    }, 'this-run'),
    /identity/,
  );
  await assertProjectIdentity(async () => 'this-run', 'this-run');
});

test('timeouts and cancellation reach finally and dispose of late connections', async () => {
  let finalized = false;
  let lateConnectionClosed = false;
  let resolveConnection!: (value: { close: () => void }) => void;
  try {
    await assert.rejects(
      runBounded(
        () =>
          new Promise<{ close: () => void }>((resolve) => {
            resolveConnection = resolve;
          }),
        {
          label: 'simulator connection',
          timeoutMs: 20,
          lateResult: (value: { close: () => void }) => value.close(),
        },
      ),
      /Timed out.*simulator connection/,
    );
  } finally {
    finalized = true;
  }
  resolveConnection({
    close: () => {
      lateConnectionClosed = true;
    },
  });
  await new Promise<void>((resolve) => setImmediate(resolve));
  assert.equal(finalized, true);
  assert.equal(lateConnectionClosed, true);
  const cancellation = new AbortController();
  let cancelledOperationStarted = false;
  const waiting = runBounded(
    () => {
      cancelledOperationStarted = true;
      return new Promise<never>(() => {});
    },
    { label: 'page', timeoutMs: 5000, signal: cancellation.signal },
  );
  cancellation.abort(new Error('Interrupted'));
  await assert.rejects(waiting, /Interrupted/);
  assert.equal(cancelledOperationStarted, false);
});

test('an SDK rejection without an error value remains a failure', async () => {
  let rejected = false;
  await runBounded(() => Promise.reject(undefined), { label: 'SDK command', timeoutMs: 1000 }).then(
    () => assert.fail('A rejected SDK command was treated as success'),
    (reason) => {
      rejected = true;
      assert.equal(reason, undefined);
    },
  );
  assert.equal(rejected, true);
});

test('failure reports preserve falsy SDK errors and return a failing result', () => {
  for (const error of [undefined, null, '', 0, false]) {
    const result = verificationResult(
      { hasPrimaryError: true, primaryError: error, stage: 'connect', cleanupErrors: [] },
      String,
    );
    assert.equal(result.ok, false);
    assert.equal(result.failedAt, 'connect');
    assert.equal(result.error, String(error));
  }
  assert.equal(
    verificationResult({ hasPrimaryError: false, stage: 'complete', cleanupErrors: [] }, String).ok,
    true,
  );
  assert.equal(
    verificationResult(
      { hasPrimaryError: false, stage: 'complete', cleanupErrors: ['port occupied'] },
      String,
    ).ok,
    false,
  );
});

test('IDE launch waits through transient connection failures before the automation listener is ready', async () => {
  let attempts = 0;
  const ownConnection = { project: 'isolated-copy' };
  const result = await connectAfterLaunch(
    async () => {
      attempts += 1;
      if (attempts < 3) throw new Error('Failed connecting to ws://127.0.0.1:9433');
      return ownConnection;
    },
    { timeoutMs: 1000, intervalMs: 1 },
  );
  assert.equal(result, ownConnection);
  assert.equal(attempts, 3);
});

test('IDE connection retries respect cancellation and refuse unrelated SDK errors', async () => {
  let attempts = 0;
  await assert.rejects(
    connectAfterLaunch(
      async () => {
        attempts += 1;
        throw new Error('Unsupported SDK version');
      },
      { timeoutMs: 1000, intervalMs: 1 },
    ),
    /Unsupported SDK version/,
  );
  assert.equal(attempts, 1);
  const cancellation = new AbortController();
  const waiting = connectAfterLaunch(
    async () => {
      cancellation.abort(new Error('Stopped while waiting for IDE'));
      throw new Error('Failed connecting to ws://127.0.0.1:9433');
    },
    { timeoutMs: 1000, intervalMs: 1, signal: cancellation.signal },
  );
  await assert.rejects(waiting, /Stopped while waiting/);
});

test('App readiness retries a swallowed first read without cancelling the run', async () => {
  const cancellation = new AbortController();
  let attempts = 0;
  const ready = { platform: 'devtools', path: 'pages/auth/index' };
  const result = await waitForAppReady(
    async () => {
      attempts += 1;
      if (attempts === 1) return new Promise<never>(() => {});
      if (attempts === 2) throw new Error('App execution domain not ready');
      if (attempts === 3) return undefined;
      return ready;
    },
    { timeoutMs: 1000, attemptTimeoutMs: 15, intervalMs: 1, signal: cancellation.signal },
  );
  assert.equal(result, ready);
  assert.equal(attempts, 4);
  assert.equal(cancellation.signal.aborted, false);
});

test('App readiness has a whole-probe deadline and respects interruption', async () => {
  const cancellation = new AbortController();
  await assert.rejects(
    waitForAppReady(() => new Promise<never>(() => {}), {
      timeoutMs: 40,
      attemptTimeoutMs: 10,
      intervalMs: 1,
      signal: cancellation.signal,
    }),
    /Timed out: WeChat App readiness/,
  );
  assert.equal(cancellation.signal.aborted, false);
  const interrupted = new AbortController();
  const waiting = waitForAppReady(() => new Promise<never>(() => {}), {
    timeoutMs: 1000,
    attemptTimeoutMs: 100,
    signal: interrupted.signal,
  });
  interrupted.abort(new Error('Stopped during readiness'));
  await assert.rejects(waiting, /Stopped during readiness/);
});

test('runner help works without a CLI, optional SDK, valid ports or simulator access', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const help = spawnSync(
    process.execPath,
    ['--experimental-strip-types', 'scripts/verify-wechat.mts', '--help'],
    {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
      env: {
        ...process.env,
        WECHAT_AUTO_PORT: 'invalid',
        WECHAT_CLI: 'not-installed',
        WECHAT_AUTOMATOR_PATH: 'not-installed',
      },
    },
  );
  assert.equal(help.status, 0, help.stderr);
  assert.match(help.stdout, /WECHAT_AUTO_PORT/);
  assert.match(help.stdout, /--media/);
});

test('supervisor returns when its worker fails preflight instead of leaving an IPC handle', () => {
  const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
  const result = spawnSync(
    process.execPath,
    ['--experimental-strip-types', 'scripts/verify-wechat.mts'],
    {
      cwd: root,
      encoding: 'utf8',
      windowsHide: true,
      timeout: 5000,
      env: {
        ...process.env,
        WECHAT_AUTO_PORT: '9541',
        WECHAT_IDE_PORT: '9542',
        WECHAT_CLI: path.join(root, 'not-installed-cli'),
        WECHAT_AUTOMATOR_PATH: 'not-installed',
      },
    },
  );
  assert.equal(result.status, 1, result.error?.message || result.stderr);
  assert.match(result.stderr, /CLI not found|Build the API/);
});
