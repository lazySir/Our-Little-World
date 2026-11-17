import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';
import * as domain from '../src/lib/domain';
import * as transport from '../src/lib/transport';

const require = createRequire(import.meta.url);
const { initPreContext, preJs } = require('@dcloudio/uni-cli-shared/dist/preprocess/index.js');

function loadApi(platform: 'mp-weixin' | 'h5', runtime: Record<string, any>) {
  initPreContext(platform);
  const filename = new URL('../src/lib/api.ts', import.meta.url);
  const source = preJs(readFileSync(filename, 'utf8'), filename.pathname).replace(
    'import.meta.env.VITE_API_BASE',
    "''",
  );
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as typeof import('../src/lib/api') };
  new Function('require', 'module', 'exports', 'uni', 'fetch', output)(
    (specifier: string) => (specifier === './domain' ? domain : transport),
    module,
    module.exports,
    runtime,
    runtime.fetch || globalThis.fetch,
  );
  return module.exports;
}

function wechat() {
  const shares: any[] = [],
    saves: any[] = [],
    downloads: any[] = [];
  const file = { statusCode: 200, tempFilePath: 'wxfile://temporary-backup.zip' };
  const runtime = {
    canIUse: () => true,
    getStorageSync: (key: string) =>
      key === 'little-world-token' ? 'test-token' : 'https://home.example/api',
    downloadFile(options: any) {
      downloads.push(options);
      options.success(file);
    },
    saveFile(options: any) {
      saves.push(options);
      options.success({ savedFilePath: 'wxfile://saved-backup.zip' });
    },
    shareFileMessage(options: any) {
      shares.push(options);
      options.success({ errMsg: 'shareFileMessage:ok' });
    },
  };
  return { runtime, file, shares, saves, downloads };
}

test('WeChat shares the downloaded temporary archive without accumulating saved files', async () => {
  const view = wechat();
  const api = loadApi('mp-weixin', view.runtime);
  assert.equal(await api.downloadArchive('/backup/download', 'our-world.zip'), view.file);
  assert.equal(view.downloads[0].url, 'https://home.example/api/backup/download');
  assert.equal(view.downloads[0].header.Authorization, 'Bearer test-token');
  assert.equal(view.saves.length, 0, 'Each backup must not consume permanent cache space');
  assert.equal(view.shares[0].filePath, view.file.tempFilePath);
  assert.equal(view.shares[0].fileName, 'our-world.zip');
});

test('cancelling WeChat archive sharing is a neutral result', async () => {
  const view = wechat();
  view.runtime.shareFileMessage = (options) =>
    options.fail({ errMsg: 'shareFileMessage:fail cancel' });
  const api = loadApi('mp-weixin', view.runtime);
  assert.equal(await api.downloadArchive('/backup/download', 'our-world.zip'), null);
});

test('a WeChat sharing failure provides a readable Error', async () => {
  const view = wechat();
  view.runtime.shareFileMessage = (options) =>
    options.fail({ errMsg: 'shareFileMessage:fail permission denied' });
  const api = loadApi('mp-weixin', view.runtime);
  await assert.rejects(api.downloadArchive('/backup/download', 'our-world.zip'), (error: Error) => {
    assert.ok(error instanceof Error);
    assert.match(error.message, /分享.*失败/);
    return true;
  });
});

test('an unsupported WeChat version explains how to download without starting a transfer', async () => {
  const view = wechat();
  view.runtime.canIUse = () => false;
  const api = loadApi('mp-weixin', view.runtime);
  await assert.rejects(api.downloadArchive('/backup/download', 'our-world.zip'), /更新微信.*网页/);
  assert.equal(view.downloads.length, 0);
});

for (const [status, message] of [
  [409, '有照片文件缺失，请先恢复完整备份'],
  [413, '数据超出备份范围，请停止服务后进行离线备份'],
] as const)
  test(`WeChat backup download preserves HTTP ${status} server guidance without sharing its error file`, async () => {
    const view = wechat();
    view.file.statusCode = status;
    let reads = 0;
    const runtime = {
      ...view.runtime,
      getFileSystemManager: () => ({
        readFile(options: any) {
          reads++;
          assert.equal(options.filePath, view.file.tempFilePath);
          assert.equal(options.encoding, 'utf8');
          options.success({ data: JSON.stringify({ message }) });
        },
      }),
    };
    const api = loadApi('mp-weixin', runtime);
    await assert.rejects(
      api.downloadArchive('/backup/download', 'our-world.zip'),
      (error: Error & { status?: number }) => {
        assert.equal(error.message, message);
        assert.equal(error.status, status);
        return true;
      },
    );
    assert.equal(reads, 1);
    assert.equal(view.shares.length, 0);
  });

test('WeChat backup download retains its HTTP status when the error file cannot be read', async () => {
  const view = wechat();
  view.file.statusCode = 500;
  const api = loadApi('mp-weixin', {
    ...view.runtime,
    getFileSystemManager: () => ({
      readFile: (options: any) => options.fail({ errMsg: 'readFile:fail' }),
    }),
  });
  await assert.rejects(api.downloadArchive('/backup/download', 'our-world.zip'), /500/);
  assert.equal(view.shares.length, 0);
});

test('H5 backup download decodes a failed temporary response instead of saving an error as a ZIP', async () => {
  const view = wechat();
  view.file.statusCode = 413;
  const api = loadApi('h5', {
    ...view.runtime,
    fetch: async (path: string) => {
      assert.equal(path, view.file.tempFilePath);
      return new Response(JSON.stringify({ message: '请停止服务后进行离线备份' }));
    },
  });
  await assert.rejects(api.downloadArchive('/backup/download', 'our-world.zip'), /离线备份/);
});
