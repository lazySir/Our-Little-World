import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function setup() {
  const reads: {
    path: string;
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }[] = [];
  let mounted: () => Promise<void>;
  const source = readFileSync(new URL('../src/composables/resource.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as any };
  const dependencies = {
    vue: { ...require('vue'), onMounted: (callback: () => Promise<void>) => (mounted = callback) },
    'element-plus': { ElMessage: { success() {}, error() {} }, ElMessageBox: {} },
    '../api': {
      api: {
        get: (path: string) =>
          new Promise((resolve, reject) => reads.push({ path, resolve, reject })),
        post: async (_path: string, body: object) => ({ id: 'created', ...body }),
      },
    },
  };
  new Function('require', 'module', 'exports', output)(
    (specifier: string) => dependencies[specifier] || require(specifier),
    module,
    module.exports,
  );
  const view = module.exports.useResource('/wishes');
  return { view, reads, mount: () => mounted() };
}

test('a delayed initial list cannot hide a record after saving and refreshing it', async () => {
  const s = setup();
  const initial = s.mount();
  const saving = s.view.save({ title: '一起看日出' });
  await Promise.resolve();
  assert.equal(s.reads.length, 2);
  assert.equal(s.reads[1].path, '/wishes');
  const created = { id: 'created', title: '一起看日出' };
  s.reads[1].resolve([created]);
  await saving;
  assert.deepEqual(s.view.items.value, [created]);
  s.reads[0].resolve([]);
  await initial;
  assert.deepEqual(s.view.items.value, [created]);
});

test('a stale load failure cannot replace the status of a newer successful list', async () => {
  const s = setup();
  const older = s.view.load();
  const newer = s.view.load();
  const latest = [{ id: 'latest', title: '最新愿望' }];
  s.reads[1].resolve(latest);
  await newer;
  s.reads[0].reject(new Error('old connection failed'));
  await older;
  assert.deepEqual(s.view.items.value, latest);
  assert.equal(s.view.error.value, '');
  assert.equal(s.view.loading.value, false);
});

test('an older completion cannot stop the loading state of the latest request', async () => {
  const s = setup();
  const older = s.view.load();
  const newer = s.view.load();
  s.reads[0].resolve([]);
  await older;
  const loadingWhileLatestPending = s.view.loading.value;
  s.reads[1].resolve([{ id: 'latest', title: '最新愿望' }]);
  await newer;
  assert.equal(loadingWhileLatestPending, true);
  assert.equal(s.view.loading.value, false);
});

test('the latest load failure remains retryable and a successful retry clears its error', async () => {
  const s = setup();
  const failed = s.view.load();
  s.reads[0].reject(new Error('latest connection failed'));
  await failed;
  assert.equal(s.view.error.value, 'latest connection failed');
  assert.equal(s.view.loading.value, false);
  const retry = s.view.load();
  assert.equal(s.view.error.value, '');
  assert.equal(s.view.loading.value, true);
  const latest = [{ id: 'latest', title: '重试成功' }];
  s.reads[1].resolve(latest);
  await retry;
  assert.deepEqual(s.view.items.value, latest);
  assert.equal(s.view.error.value, '');
  assert.equal(s.view.loading.value, false);
});
