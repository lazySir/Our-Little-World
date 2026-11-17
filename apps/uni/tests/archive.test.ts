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
  new Function('require', 'module', 'exports', 'uni', output)(
    (specifier: string) => (specifier === './domain' ? domain : transport),
    module,
    module.exports,
    runtime,
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
