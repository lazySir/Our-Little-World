/** Optional, isolated acceptance in the official WeChat simulator. */
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import type { ChildProcess } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { setTimeout as delay } from 'node:timers/promises';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { projectRoot, stopChild, waitForExit } from './runtime.mts';
import {
  assertAutomationPortFree,
  assertProjectIdentity,
  connectAfterLaunch,
  createVerificationProject,
  runBounded,
  verificationOptions,
  verificationResult,
  waitForAppReady,
} from './wechat-verification.mts';

interface Element {
  text(): Promise<string>;
  offset(): Promise<{ top: number; left: number }>;
  size(): Promise<{ width: number; height: number }>;
  attribute(name: string): Promise<string | null>;
  input(value: string): Promise<void>;
  tap(): Promise<void>;
}
interface Page {
  path: string;
  scrollTop(): Promise<string | number>;
  $(selector: string): Promise<Element | null>;
  $$(selector: string): Promise<Element[]>;
}
interface MiniProgram {
  on(event: 'exception', listener: (error: unknown) => void): void;
  systemInfo(): Promise<{
    platform: string;
    SDKVersion: string;
    windowWidth: number;
    windowHeight: number;
  }>;
  currentPage(): Promise<Page | undefined>;
  reLaunch(url: string): Promise<Page | undefined>;
  switchTab(url: string): Promise<Page | undefined>;
  navigateTo(url: string): Promise<Page | undefined>;
  callWxMethod<T = unknown>(method: string, ...args: unknown[]): Promise<T>;
  evaluate<T = unknown>(source: string, ...args: unknown[]): Promise<T>;
  mockWxMethod(method: string, result: unknown): Promise<void>;
  restoreWxMethod(method: string): Promise<void>;
  screenshot(options: { path: string }): Promise<unknown>;
  close(): Promise<void>;
  disconnect(): Promise<void>;
}
interface Automator {
  connect(options: { wsEndpoint: string }): Promise<MiniProgram>;
}
interface Entry {
  id: string;
  title?: string;
  mood?: string;
  amountCents?: number;
  assets?: Asset[];
}
interface Asset {
  id: string;
  url: string;
}

const help = `Official WeChat simulator acceptance (optional developer tooling)

Usage: npm run test:wechat -- [--media]

First build: npm run build:api && npm run build:mp-weixin
Install SDK separately: npm install --prefix test-results/wechat-tooling --no-save --package-lock=false miniprogram-automator@0.13.0

Environment:
  WECHAT_CLI             Official cli.bat / cli path (required if not found in its usual location)
  WECHAT_AUTOMATOR_PATH  External miniprogram-automator package path
                        Default: test-results/wechat-tooling/node_modules/miniprogram-automator
  WECHAT_AUTO_PORT       Unoccupied loopback automation port (default 9431)
  WECHAT_IDE_PORT        IDE HTTP service port (default 9432; configure the same port in the IDE)
  WECHAT_TIMEOUT_MS      Whole-run limit, 1000..1800000 ms (default 240000)

Uses a temporary project copy, database, uploads and random API port.
Requires the official IDE with its local service enabled; tourist simulator is supported.
Never reuses an occupied automation port.
--media also checks real upload/download and ZIP restore with controlled picker/share/confirmation results.
Reports and screenshots: test-results/wechat-verify-<run-id>/.
This does not verify physical devices, real WeChat contacts, AppID ownership or publication.
`;
const require = createRequire(import.meta.url);

function officialCli() {
  const candidates =
    process.platform === 'win32'
      ? [
          'D:/微信web开发者工具/cli.bat',
          'C:/Program Files (x86)/Tencent/微信web开发者工具/cli.bat',
          'C:/Program Files/Tencent/微信web开发者工具/cli.bat',
        ]
      : ['/Applications/wechatwebdevtools.app/Contents/MacOS/cli'];
  const configured = process.env.WECHAT_CLI;
  const cli = configured ? path.resolve(projectRoot, configured) : candidates.find(existsSync);
  if (!cli || !existsSync(cli))
    throw new Error('Official WeChat CLI not found; set WECHAT_CLI to its cli.bat or cli path');
  // The official Windows batch file only forwards to this adjacent Node entry.
  // Invoke that entry directly so paths are arguments and never shell commands.
  if (process.platform === 'win32' && /\.(bat|cmd)$/i.test(cli)) {
    const executable = path.join(path.dirname(cli), 'node.exe');
    const entry = path.join(path.dirname(cli), 'cli.js');
    if (!existsSync(executable) || !existsSync(entry))
      throw new Error(
        'WECHAT_CLI must point to the official installation with adjacent node.exe and cli.js',
      );
    return { executable, prefix: [entry] };
  }
  return { executable: cli, prefix: [] as string[] };
}

// The API runs in our child process so an interrupted SDK call cannot prevent its shutdown.
const apiChildSource = `
const { createApp } = require(process.argv[1]);
let app;
let stopping = false;
async function stop() {
  stopping = true;
  if (app) { const current = app; app = undefined; await current.close(); }
  if (process.connected) process.disconnect();
}
process.on('message', message => { if (message === 'stop') void stop(); });
process.once('disconnect', () => { void stop(); });
process.once('SIGINT', () => { void stop(); });
process.once('SIGTERM', () => { void stop(); });
createApp({ logger: false }).then(async instance => {
  app = instance;
  if (stopping) { await stop(); return; }
  await app.listen(0, '127.0.0.1');
  if (stopping) { await stop(); return; }
  process.send({ base: (await app.getUrl()) + '/api' });
}).catch(error => { console.error(error); process.exitCode = 1; void stop(); });
`;

async function main() {
  const args = process.argv.slice(2).filter((argument) => argument !== '--verification-worker');
  const media = args.includes('--media');
  const options = verificationOptions(process.env);
  const build = path.join(projectRoot, 'apps/uni/dist/build/mp-weixin');
  const api = path.join(projectRoot, 'apps/api/dist/app.js');
  if (!existsSync(path.join(build, 'app.json')) || !existsSync(api))
    throw new Error('Build the API and mp-weixin first; see --help');
  const cli = officialCli();
  const modulePath = path.resolve(
    projectRoot,
    process.env.WECHAT_AUTOMATOR_PATH ||
      'test-results/wechat-tooling/node_modules/miniprogram-automator',
  );
  let automator: Automator;
  try {
    automator = require(modulePath) as Automator;
  } catch {
    throw new Error(
      'Optional miniprogram-automator SDK not found; see --help or set WECHAT_AUTOMATOR_PATH',
    );
  }
  if (typeof automator.connect !== 'function')
    throw new Error('Configured WeChat SDK does not expose connect()');
  await assertAutomationPortFree(options.automationPort);

  const runId = `${Date.now()}-${randomBytes(6).toString('hex')}`;
  const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'world-wechat-verify-'));
  const project = path.join(temporaryRoot, 'project');
  const artifacts = path.join(projectRoot, 'test-results', `wechat-verify-${runId}`);
  process.send?.({ kind: 'lease', temporaryRoot, project, artifacts });
  const password = randomBytes(24).toString('hex');
  const secrets = [password];
  const redact = (value: unknown) =>
    secrets.reduce((text, secret) => text.replaceAll(secret, '[private]'), String(value));
  const environment = {
    ...process.env,
    DATABASE_URL: `file:${path.join(temporaryRoot, 'world.db').replace(/\\/g, '/')}`,
    STORAGE_DIR: path.join(temporaryRoot, 'storage'),
    SETUP_TOKEN: '',
    ASSET_SECRET: randomBytes(48).toString('hex'),
    AUTO_BACKUP_HOURS: '0',
    HOST: '127.0.0.1',
    RUST_LOG: 'info',
    WEB_DIST_DIR: path.join(temporaryRoot, 'no-web-build'),
  };
  secrets.push(environment.ASSET_SECRET);
  const cancellation = new AbortController();
  let stage = 'preparing isolated project';
  let mini: MiniProgram | undefined;
  let page: Page | undefined;
  let identified = false;
  let launchAttempted = false;
  let primaryError: unknown;
  let hasPrimaryError = false;
  let cliLog = '';
  const children = new Set<ChildProcess>();
  const mockedMethods = new Set<string>();
  const temporaryWxFiles = new Set<string>();
  const exceptions: unknown[] = [];
  const checks: string[] = [];
  const cleanupErrors: string[] = [];
  const interrupt = () =>
    cancellation.abort(new Error(`WeChat verification interrupted at ${stage}`));
  const receiveCancellation = (message: unknown) => {
    if ((message as { kind?: string })?.kind === 'cancel') interrupt();
  };
  const watchdog = setTimeout(
    () => cancellation.abort(new Error(`Whole-run timeout at ${stage}`)),
    options.timeoutMs,
  );
  process.once('SIGINT', interrupt);
  process.once('SIGTERM', interrupt);
  process.once('disconnect', interrupt);
  process.on('message', receiveCancellation);
  const step = <T,>(operation: () => Promise<T>, label: string, timeoutMs = 15000) => {
    stage = label;
    return runBounded(operation, { label, timeoutMs, signal: cancellation.signal }).catch(
      (error: unknown) => {
        // Pending SDK calls cannot be cancelled. Stop their retry loops before cleanup begins.
        if (error instanceof Error && error.message.startsWith('Timed out:'))
          cancellation.abort(error);
        throw error;
      },
    );
  };
  const log = (message: string) => {
    stage = message;
    console.log(message);
  };
  const pass = (message: string) => {
    checks.push(message);
    log(`PASS ${message}`);
  };
  const spawnOwned = (executable: string, arguments_: string[], env = environment, ipc = false) => {
    const child = spawn(executable, arguments_, {
      cwd: projectRoot,
      env,
      windowsHide: true,
      stdio: ipc ? ['ignore', 'pipe', 'pipe', 'ipc'] : ['ignore', 'pipe', 'pipe'],
    });
    children.add(child);
    const append = (data: Buffer) => {
      if (cliLog.length < 20000) cliLog += String(data).slice(0, 20000 - cliLog.length);
    };
    child.stdout?.on('data', append);
    child.stderr?.on('data', append);
    return child;
  };
  const runCli = (arguments_: string[]) =>
    spawnOwned(cli.executable, [...cli.prefix, ...arguments_]);
  const until = async <T,>(
    task: () => Promise<T | undefined | null | false>,
    label: string,
  ): Promise<T> => {
    let reason: unknown;
    for (let attempt = 0; attempt < 32; attempt += 1) {
      cancellation.signal.throwIfAborted();
      try {
        const result = await step(task, label, 6000);
        if (result) return result;
      } catch (error) {
        if (cancellation.signal.aborted) throw error;
        reason = error;
      }
      await delay(170, undefined, { signal: cancellation.signal });
    }
    throw new Error(`Missing ${label}${reason ? `: ${redact(reason)}` : ''}`);
  };
  const textOfPage = async () => (await (await page?.$('.page'))?.text()) || '';
  const has = (label: string) => until(async () => (await textOfPage()).includes(label), label);
  const control = (selector: string, label: string) =>
    until(async () => {
      for (const element of await page!.$$(selector))
        if ((await element.text()).trim() === label) return element;
    }, label);
  const tap = async (label: string, selector = 'button') =>
    step(async () => (await control(selector, label)).tap(), `tap ${label}`);
  const input = async (placeholder: string, value: string) => {
    const element = await until(async () => {
      for (const candidate of await page!.$$('input'))
        if ((await candidate.attribute('placeholder')) === placeholder) return candidate;
    }, placeholder);
    await step(() => element.input(value), `input ${placeholder}`);
  };
  const mock = async (method: string, result: unknown) => {
    // Track before sending so cleanup also handles a command that applied just before a timeout.
    mockedMethods.add(method);
    await step(() => mini!.mockWxMethod(method, result), `mock ${method}`);
  };
  const restoreMock = async (method: string) => {
    await step(() => mini!.restoreWxMethod(method), `restore ${method}`);
    mockedMethods.delete(method);
  };
  const cleanup = async (label: string, operation: () => Promise<unknown>) => {
    try {
      await runBounded(operation, { label: `cleanup ${label}`, timeoutMs: 8000 });
    } catch (error) {
      cleanupErrors.push(`${label}: ${redact(error)}`);
    }
  };

  try {
    await mkdir(artifacts, { recursive: true });
    const identity = await step(() => createVerificationProject(build, project, runId), stage);
    log('Migrate isolated temporary SQLite database');
    await step(
      () =>
        waitForExit(
          spawnOwned(process.execPath, [
            require.resolve('prisma/build/index.js'),
            'migrate',
            'deploy',
            '--config',
            'apps/api/prisma.config.ts',
          ]),
        ),
      stage,
      60000,
    );
    log('Start isolated API on a random loopback port');
    const apiChild = spawnOwned(process.execPath, ['-e', apiChildSource, api], environment, true);
    const base = await step(
      () =>
        new Promise<string>((resolve, reject) => {
          apiChild.once('error', reject);
          apiChild.once('exit', (code) =>
            reject(new Error(`Isolated API stopped before ready (${code})`)),
          );
          apiChild.once('message', (message) => {
            const candidate = (message as { base?: unknown })?.base;
            if (
              typeof candidate !== 'string' ||
              !/^http:\/\/127\.0\.0\.1:\d+\/api$/.test(candidate)
            )
              reject(new Error('Invalid isolated API address'));
            else resolve(candidate);
          });
        }),
      stage,
      30000,
    );
    const status = await fetch(`${base}/auth/status`, {
      signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(5000)]),
    });
    assert.deepEqual(await status.json(), { initialized: false });
    const setupToken = (
      await readFile(path.join(environment.STORAGE_DIR, '.setup-token'), 'utf8')
    ).trim();
    secrets.push(setupToken);

    log(`Open own WeChat project on automation port ${options.automationPort}`);
    // Check again immediately before launch; a previous verification may have started during migration.
    await assertAutomationPortFree(options.automationPort);
    launchAttempted = true;
    process.send?.({ kind: 'launched' });
    await step(
      () =>
        waitForExit(
          runCli([
            'auto',
            '--project',
            project,
            '--auto-port',
            String(options.automationPort),
            '--port',
            String(options.idePort),
            '--trust-project',
            '--lang',
            'zh',
          ]),
        ),
      stage,
      60000,
    );
    mini = await step(
      () =>
        connectAfterLaunch(
          () => automator.connect({ wsEndpoint: `ws://127.0.0.1:${options.automationPort}` }),
          {
            timeoutMs: 30000,
            signal: cancellation.signal,
            lateResult: (late) => late.disconnect(),
          },
        ),
      'connect to own WeChat project',
      31000,
    );
    mini.on('exception', (error) => exceptions.push(error));
    const ready = await step(
      () =>
        waitForAppReady(
          async () => {
            const [info, current] = await Promise.all([mini!.systemInfo(), mini!.currentPage()]);
            return info?.platform === 'devtools' && current?.path ? { info, current } : undefined;
          },
          { timeoutMs: 30000, attemptTimeoutMs: 1000, signal: cancellation.signal },
        ),
      'wait for read-only WeChat App readiness',
      31000,
    );
    await step(
      () =>
        assertProjectIdentity(
          () =>
            mini!.evaluate(
              'function() { try { return getApp().__worldVerificationMarker || null; } catch (error) { return { error: String(error) }; } }',
            ),
          identity.marker,
        ),
      'verify isolated project marker',
    );
    identified = true;
    const info = ready.info;
    assert.equal(info.platform, 'devtools');
    console.log(`WeChat SDK ${info.SDKVersion}; viewport ${info.windowWidth}`);
    await step(() => mini!.callWxMethod('clearStorageSync'), 'clear own simulator storage');
    await step(
      () => mini!.callWxMethod('setStorageSync', 'little-world-api', base),
      'set isolated API',
    );
    page = await step(() => mini!.reLaunch('/pages/auth/index'), 'open auth');
    await has('创建我们的小世界');
    log('Create space through WeChat inputs');
    await input('给自己起一个账号', 'sim_owner');
    await input('至少 8 位，建议使用字母和数字', password);
    await input('对方最熟悉的名字', '模拟器小熊');
    await input('从服务端 storage/.setup-token 读取', setupToken);
    await tap('创建我们的小世界');
    page = await until(async () => {
      const current = await mini!.currentPage();
      return current?.path === 'pages/home/index' && current;
    }, 'home');
    await has('保存今天的心情');
    const token = await step(
      () => mini!.callWxMethod<string>('getStorageSync', 'little-world-token'),
      'read test session',
    );
    assert.equal(typeof token, 'string');
    assert.ok(token);
    secrets.push(token);
    const request = (resource: string, init: RequestInit = {}) =>
      fetch(`${base}/${resource}`, {
        ...init,
        headers: { Authorization: `Bearer ${token}`, ...init.headers },
        signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(10000)]),
      });
    const read = async <T = Entry[],>(resource: string): Promise<T> => {
      const response = await request(resource);
      assert.equal(response.ok, true, `${resource}: HTTP ${response.status}`);
      return (await response.json()) as T;
    };
    assert.equal(
      (await read<{ user: { nickname: string } }>('auth/me')).user.nickname,
      '模拟器小熊',
    );
    pass('space creation and authenticated session');
    await step(async () => (await control('.chip', '☀ 闪闪发光')).tap(), 'select mood');
    await tap('保存今天的心情');
    await until(
      async () => (await read('moods')).some((entry) => entry.mood === 'great'),
      'persisted mood',
    );
    await until(
      async () => (await page!.$('.hero')) && !(await page!.$('.wd-button.is-loading')),
      'home content after mood refresh',
    );
    await step(() => mini!.screenshot({ path: path.join(artifacts, 'home.png') }), 'capture home');
    pass('mood persistence');
    await has('我们的待办愿望');
    await tap('写下第一个愿望');
    page = await until(async () => {
      const current = await mini!.currentPage();
      return current?.path === 'pages/wishes/index' && current;
    }, 'wish list from empty home');
    await tap('＋ 添加');
    await input('例如：去看一场海边日落', '一起看日落');
    await tap('保存这一刻');
    await has('一起看日落');
    const [wish] = await read('wishes');
    assert.equal(wish.title, '一起看日落');
    await tap('编辑', '.text-action');
    await input('例如：去看一场海边日落', '一起看星星');
    await tap('保存这一刻');
    await has('一起看星星');
    const [edited] = await read('wishes');
    assert.equal(edited.id, wish.id);
    assert.equal(edited.title, '一起看星星');
    pass('wish creation and edit through WeChat PATCH transport');
    page = await step(() => mini!.switchTab('/pages/home/index'), 'open home wish preview');
    const homeWish = await control('.home-wishes .wd-cell', '一起看星星');
    const homeWishPosition = await step(() => homeWish.offset(), 'read home wish position');
    await step(
      () =>
        mini!.callWxMethod('pageScrollTo', {
          scrollTop: Math.max(0, Number(homeWishPosition.top) - 80),
          duration: 0,
        }),
      'show home wish preview',
    );
    await until(async () => {
      const [position, size, scrollTop] = await Promise.all([
        homeWish.offset(),
        homeWish.size(),
        page!.scrollTop(),
      ]);
      const top = Number(position.top) - Number(scrollTop);
      return top >= 0 && Number(size.height) > 0 && top + Number(size.height) <= info.windowHeight;
    }, 'home wish preview fully visible');
    await step(
      () => mini!.screenshot({ path: path.join(artifacts, 'home-wishes.png') }),
      'capture saved home wish',
    );
    await step(() => homeWish.tap(), 'open saved wish from home');
    page = await until(async () => {
      const current = await mini!.currentPage();
      return current?.path === 'pages/wishes/index' && current;
    }, 'wish list from home preview');
    await has('一起看星星');
    pass('home previews a saved wish and opens its list');
    page = await step(() => mini!.navigateTo('/pages/ledger/index'), 'open ledger');
    await tap('＋ 记一笔');
    await input('0.00', '12.34');
    await tap('保存这一刻');
    await until(
      async () => (await read('ledger')).some((entry) => entry.amountCents === 1234),
      'ledger 1234 cents',
    );
    pass('ledger saves integer cents');
    const routes = [
      ['more', '我们的日常'],
      ['menu', '今天吃什么'],
      ['anniversaries', '纪念日'],
      ['baby', '宝宝成长'],
      ['work', '工作手记'],
      ['letters', '时光信箱'],
      ['memories', '回忆相册'],
      ['settings', '我们的设置'],
    ];
    for (const [route, title] of routes) {
      page = await step(() => mini!.reLaunch(`/pages/${route}/index`), `open ${route}`);
      await has(title);
      await until(async () => !(await page!.$('.loading')), `loaded ${route} content`);
      const error = await step(() => page!.$('.error-box'), `read ${route} errors`);
      assert.ok(
        !error || !(await step(() => error.text(), `read ${route} error text`)),
        `${route} displayed an error`,
      );
    }
    pass('all 12 routes render without an error box');

    if (media) {
      log('Verify native upload, signed photo download and ZIP restore');
      const fixture = await sharp({
        create: { width: 19, height: 11, channels: 3, background: '#bd786b' },
      })
        .png()
        .toBuffer();
      const fixturePath = await step(
        () =>
          mini!.evaluate<string>(
            'function(base64, name) { var p = wx.env.USER_DATA_PATH + "/" + name; wx.getFileSystemManager().writeFileSync(p, base64, "base64"); return p; }',
            fixture.toString('base64'),
            `proof-${runId}.png`,
          ),
        'write controlled photo fixture',
      );
      temporaryWxFiles.add(fixturePath);
      await mock('chooseImage', {
        tempFilePaths: [fixturePath],
        tempFiles: [{ path: fixturePath, size: fixture.length }],
        errMsg: 'chooseImage:ok',
      });
      page = await step(() => mini!.switchTab('/pages/memories/index'), 'open memories');
      await tap('＋ 写一篇');
      await input('例如：第一次一起看海', '微信模拟器相册验收');
      await step(
        async () => (await until(() => page!.$('.upload-tile'), 'photo picker')).tap(),
        'choose fixture photo',
      );
      const asset = await until(
        async () => (await read<Asset[]>('assets'))[0],
        'native multipart photo upload',
      );
      await until(() => page!.$('.photo-wrap'), 'uploaded photo thumbnail');
      await tap('保存这一刻');
      await has('微信模拟器相册验收');
      const [memory] = await read('memories');
      assert.equal(memory.assets?.[0].id, asset.id);
      await restoreMock('chooseImage');
      const photoUrl = new URL(asset.url, base).href;
      const photo = await fetch(photoUrl, {
        signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(10000)]),
      });
      assert.equal(photo.ok, true);
      const photoBytes = Buffer.from(await photo.arrayBuffer());
      const downloaded = await step(
        () =>
          mini!.evaluate<{ status: number; path: string; bytes: string; error?: string }>(
            'function(url) { return new Promise(function(resolve) { wx.downloadFile({ url: url, success: function(r) { resolve({ status: r.statusCode, path: r.tempFilePath, bytes: wx.getFileSystemManager().readFileSync(r.tempFilePath, "base64") }); }, fail: function(e) { resolve({ error: e.errMsg }); } }); }); }',
            photoUrl,
          ),
        'native signed photo download',
      );
      assert.equal(downloaded.status, 200, downloaded.error);
      temporaryWxFiles.add(downloaded.path);
      assert.deepEqual(Buffer.from(downloaded.bytes, 'base64'), photoBytes);
      await step(
        () => mini!.screenshot({ path: path.join(artifacts, 'memory.png') }),
        'capture memory photo',
      );
      pass('native photo upload, saved thumbnail and signed download bytes');
      page = await step(() => mini!.navigateTo('/pages/settings/index'), 'open backup settings');
      await has('下载完整 ZIP');
      const shareAvailable = await step(
        () =>
          mini!.evaluate<boolean>(
            'function() { return typeof wx.shareFileMessage === "function" && wx.canIUse("shareFileMessage"); }',
          ),
        'read file share capability',
      );
      let archivePath: string;
      if (shareAvailable) {
        await mock(
          'shareFileMessage',
          'function(options) { wx.setStorageSync("world-verify-archive", options.filePath); return { errMsg: "shareFileMessage:ok" }; }',
        );
        await tap('下载完整 ZIP');
        archivePath = await until(
          () => mini!.callWxMethod<string>('getStorageSync', 'world-verify-archive'),
          'archive share handoff',
        );
        await restoreMock('shareFileMessage');
      } else {
        await tap('下载完整 ZIP');
        await has('请更新微信后重试');
        const download = await step(
          () =>
            mini!.callWxMethod<{ statusCode: number; tempFilePath: string }>('downloadFile', {
              url: `${base}/backup/download`,
              header: { Authorization: `Bearer ${token}` },
            }),
          'native backup download',
        );
        assert.equal(download.statusCode, 200);
        archivePath = download.tempFilePath;
      }
      temporaryWxFiles.add(archivePath);
      const signature = await step(
        () =>
          mini!.evaluate<string>(
            'function(file) { return wx.getFileSystemManager().readFileSync(file, "hex").slice(0, 8); }',
            archivePath,
          ),
        'check downloaded ZIP header',
      );
      assert.equal(signature, '504b0304');
      // Let the settings page leave its download busy state before selecting a restore.
      await until(async () => !(await page!.$('.wd-button.is-loading')), 'backup controls ready');
      assert.equal((await request(`memories/${memory.id}`, { method: 'DELETE' })).ok, true);
      assert.equal((await read('memories')).length, 0);
      await mock('chooseMessageFile', {
        tempFiles: [{ path: archivePath, name: 'little-world.zip', type: 'file' }],
        errMsg: 'chooseMessageFile:ok',
      });
      await mock(
        'showModal',
        'function(options) { wx.setStorageSync("world-verify-modal", options.title); return { confirm: true, cancel: false, errMsg: "showModal:ok" }; }',
      );
      await tap('选择 ZIP 并恢复');
      await until(
        async () => (await read('memories')).some((entry) => entry.id === memory.id),
        'restored memory',
      );
      assert.equal(
        await step(
          () => mini!.callWxMethod('getStorageSync', 'world-verify-modal'),
          'read restore confirmation',
        ),
        '恢复完整备份',
      );
      const [restoredMemory] = await read('memories');
      const restoredPhoto = await fetch(new URL(restoredMemory.assets![0].url, base), {
        signal: AbortSignal.any([cancellation.signal, AbortSignal.timeout(10000)]),
      });
      assert.equal(restoredPhoto.ok, true);
      assert.deepEqual(Buffer.from(await restoredPhoto.arrayBuffer()), photoBytes);
      await until(
        async () => (await mini!.currentPage())?.path === 'pages/home/index',
        'home after ZIP restore',
      );
      pass('ZIP native download/restore retains photo bytes and authenticated session');
    }
    assert.deepEqual(exceptions, [], 'WeChat runtime exceptions');
    pass('no WeChat runtime exceptions');
  } catch (error) {
    hasPrimaryError = true;
    primaryError = error;
    console.error(`WeChat verification failed at ${stage}: ${redact(error)}`);
    if (identified && mini) {
      await cleanup('failure screenshot', () =>
        mini!.screenshot({ path: path.join(artifacts, 'failure.png') }),
      );
      await cleanup('failure text', async () => {
        console.error(redact(await textOfPage()).slice(0, 2000));
      });
    }
  } finally {
    process.send?.({ kind: 'cleanup-started' });
    clearTimeout(watchdog);
    if (identified && mini) {
      for (const method of mockedMethods)
        await cleanup(`restore ${method}`, () => mini!.restoreWxMethod(method));
      if (temporaryWxFiles.size)
        await cleanup('temporary simulator files', () =>
          mini!.evaluate(
            'function(files) { var fs = wx.getFileSystemManager(); files.forEach(function(file) { try { fs.unlinkSync(file); } catch (e) {} }); }',
            [...temporaryWxFiles],
          ),
        );
      await cleanup('own simulator storage', () => mini!.callWxMethod('clearStorageSync'));
      await cleanup('own simulator project', () => mini!.close());
    }
    if (mini) await cleanup('automation connection', () => mini!.disconnect());
    if (launchAttempted)
      await cleanup('own project window', () =>
        waitForExit(runCli(['close', '--project', project, '--port', String(options.idePort)])),
      );
    if (launchAttempted)
      await cleanup('automation port release', async () => {
        let lastError: unknown;
        for (let attempt = 0; attempt < 8; attempt += 1) {
          try {
            await assertAutomationPortFree(options.automationPort);
            return;
          } catch (error) {
            lastError = error;
          }
          await delay(250);
        }
        throw new Error(
          `Automation port ${options.automationPort} is still occupied after closing this project; choose another port for a new run. Shared IDE processes were left intact.`,
          { cause: lastError },
        );
      });
    for (const child of children) {
      if (child.exitCode !== null || child.signalCode !== null) continue;
      if (child.connected) {
        await cleanup('isolated API', async () => {
          await new Promise<void>((resolve, reject) =>
            child.send('stop', (error) => (error ? reject(error) : resolve())),
          );
          await waitForExit(child);
        });
      }
      if (child.exitCode === null && child.signalCode === null) {
        await cleanup('owned process', async () => {
          const stopped = waitForExit(child).catch(() => {});
          stopChild(child);
          await stopped;
        });
      }
    }
    await cleanup('temporary project and data', async () => {
      if (
        path.dirname(path.resolve(temporaryRoot)) !== path.resolve(os.tmpdir()) ||
        !path.basename(temporaryRoot).startsWith('world-wechat-verify-')
      )
        throw new Error('Unexpected temporary project path');
      await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
    });
    process.removeListener('SIGINT', interrupt);
    process.removeListener('SIGTERM', interrupt);
    process.removeListener('disconnect', interrupt);
    process.removeListener('message', receiveCancellation);
    await mkdir(artifacts, { recursive: true });
    await writeFile(path.join(artifacts, 'cli.log'), redact(cliLog));
    const outcome = verificationResult(
      { hasPrimaryError, primaryError, stage, cleanupErrors },
      redact,
    );
    await writeFile(
      path.join(artifacts, 'result.json'),
      JSON.stringify(
        {
          runId,
          mode: media ? 'core-and-media' : 'core',
          ...outcome,
          checks,
          runtimeExceptions: exceptions.map(redact),
          automationPort: options.automationPort,
          idePort: options.idePort,
        },
        null,
        2,
      ),
    );
    if (!outcome.ok) {
      process.exitCode = 1;
      for (const error of cleanupErrors) console.error(`Cleanup: ${error}`);
    } else console.log(`WeChat acceptance passed (${checks.length} checks).`);
    console.log(`Artifacts: ${artifacts}`);
  }
}

interface RunLease {
  temporaryRoot: string;
  project: string;
  artifacts: string;
}

/** A final process boundary covers SDK handshakes that never return a connection to dispose. */
async function superviseVerification() {
  const args = process.argv.slice(2);
  if (args.includes('--help') || args.includes('-h')) {
    console.log(help);
    return;
  }
  if (args.some((argument) => argument !== '--media'))
    throw new Error('Unknown argument; use --help');
  const options = verificationOptions(process.env);
  const worker = spawn(
    process.execPath,
    [
      '--experimental-strip-types',
      fileURLToPath(import.meta.url),
      '--verification-worker',
      ...args,
    ],
    {
      cwd: projectRoot,
      windowsHide: true,
      detached: process.platform !== 'win32',
      stdio: ['ignore', 'inherit', 'inherit', 'ipc'],
    },
  );
  let lease: RunLease | undefined;
  let launched = false;
  let forced = false;
  let interrupted = false;
  let cleanupTimer: ReturnType<typeof setTimeout> | undefined;
  const watchCleanup = () => {
    cleanupTimer ||= setTimeout(() => {
      forced = true;
      console.error(
        'WeChat worker did not finish cleanup in 45 seconds; stopping this run and cleaning its isolated project.',
      );
      stopChild(worker);
    }, 45000);
  };
  worker.on('message', (message: unknown) => {
    const value = message as RunLease & { kind?: string };
    if (value?.kind === 'lease') lease = value;
    if (value?.kind === 'launched') launched = true;
    if (value?.kind === 'cleanup-started') watchCleanup();
  });
  const cancel = () => {
    interrupted = true;
    if (worker.connected) worker.send({ kind: 'cancel' }, () => {});
    watchCleanup();
  };
  const watchdog = setTimeout(cancel, options.timeoutMs + 1000);
  process.once('SIGINT', cancel);
  process.once('SIGTERM', cancel);
  try {
    const code = await new Promise<number>((resolve, reject) => {
      worker.once('error', reject);
      worker.once('exit', (exitCode) => resolve(exitCode ?? 1));
    });
    process.exitCode = code || (interrupted ? 1 : 0);
  } finally {
    clearTimeout(watchdog);
    clearTimeout(cleanupTimer);
    process.removeListener('SIGINT', cancel);
    process.removeListener('SIGTERM', cancel);
    if (lease && (forced || existsSync(lease.temporaryRoot))) {
      const { temporaryRoot, project, artifacts } = lease;
      if (
        path.dirname(path.resolve(temporaryRoot)) !== path.resolve(os.tmpdir()) ||
        !path.basename(temporaryRoot).startsWith('world-wechat-verify-') ||
        project !== path.join(temporaryRoot, 'project') ||
        path.dirname(artifacts) !== path.join(projectRoot, 'test-results') ||
        !/^wechat-verify-\d+-[a-f0-9]+$/.test(path.basename(artifacts))
      ) {
        throw new Error('Refusing supervisor cleanup outside this run’s isolated paths');
      }
      if (launched) {
        const cli = officialCli();
        const close = spawn(
          cli.executable,
          [...cli.prefix, 'close', '--project', project, '--port', String(options.idePort)],
          {
            cwd: projectRoot,
            windowsHide: true,
            detached: process.platform !== 'win32',
            stdio: 'ignore',
          },
        );
        try {
          await runBounded(() => waitForExit(close), {
            label: 'supervisor close own project',
            timeoutMs: 12000,
          });
        } catch (error) {
          stopChild(close);
          console.error((error as Error).message);
        }
      }
      await rm(temporaryRoot, { recursive: true, force: true, maxRetries: 8, retryDelay: 200 });
      await mkdir(artifacts, { recursive: true });
      await writeFile(
        path.join(artifacts, 'supervisor-error.txt'),
        forced
          ? 'The run exceeded its shutdown deadline. The supervisor stopped its worker process tree and removed its temporary project and data.\n'
          : 'The worker left temporary files after exiting. The supervisor removed its isolated project and data; inspect result.json and cli.log.\n',
      );
      process.exitCode = 1;
    }
  }
}

try {
  if (process.argv.includes('--verification-worker')) {
    if (!process.send) throw new Error('The verification worker must be started by its supervisor');
    try {
      await main();
    } finally {
      if (process.connected) process.disconnect();
    }
  } else await superviseVerification();
} catch (error) {
  console.error((error as Error).message);
  process.exitCode = 1;
}
