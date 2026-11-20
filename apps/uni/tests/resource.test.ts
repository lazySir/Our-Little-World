import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import ts from 'typescript';

const require = createRequire(import.meta.url);
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const drain = async () => {
  for (let i = 0; i < 6; i++) await Promise.resolve();
};
function setup() {
  const reads: ReturnType<typeof deferred<any[]>>[] = [];
  let show!: () => Promise<void>;
  let refresh!: () => Promise<void>;
  let stopped = 0;
  const dependencies = {
    '@dcloudio/uni-app': {
      onShow(callback: typeof show) {
        show = callback;
      },
      onPullDownRefresh(callback: typeof refresh) {
        refresh = callback;
      },
    },
    '../stores/session': { useSession: () => ({ load: async () => true }) },
    './api': {
      request: async (_path: string, method?: string) => {
        if (method) return {};
        const read = deferred<any[]>();
        reads.push(read);
        return read.promise;
      },
      notify() {},
      confirm: async () => true,
    },
  };
  const source = readFileSync(new URL('../src/lib/useResource.ts', import.meta.url), 'utf8');
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', 'uni', output)(
    (specifier: string) => dependencies[specifier] || require(specifier),
    module,
    module.exports,
    {
      stopPullDownRefresh() {
        stopped++;
      },
    },
  );
  const resource = module.exports.useResource('memories');
  return { resource, reads, show: () => show(), refresh: () => refresh(), stopped: () => stopped };
}

test('an older on-show response cannot replace the list refreshed after a successful save', async () => {
  const s = setup();
  const initial = s.show();
  await drain();
  assert.equal(s.reads.length, 1);
  const saving = s.resource.save({ title: '刚刚写好的回忆' });
  await drain();
  assert.equal(s.reads.length, 2);
  const latest = [{ id: 'new', title: '刚刚写好的回忆' }];
  s.reads[1].resolve(latest);
  await saving;
  assert.deepEqual(s.resource.items.value, latest);
  s.reads[0].resolve([]);
  await initial;
  assert.deepEqual(
    s.resource.items.value,
    latest,
    'A slow earlier list must not hide the saved record',
  );
});

test('an older failed refresh cannot clear the latest loading state or publish its stale error', async () => {
  const s = setup();
  const initial = s.show();
  await drain();
  const latest = s.refresh();
  await drain();
  assert.equal(s.reads.length, 2);
  try {
    s.reads[0].reject(new Error('旧请求的网络错误'));
    await initial;
    assert.equal(s.resource.loading.value, true, 'The newest request is still pending');
    assert.equal(s.resource.error.value, '');
    assert.equal(s.stopped(), 0, 'Only the latest load can finish pull-to-refresh');
  } finally {
    s.reads[1].resolve([{ id: 'latest' }]);
    await latest;
  }
  assert.deepEqual(s.resource.items.value, [{ id: 'latest' }]);
  assert.equal(s.resource.loading.value, false);
  assert.equal(s.resource.error.value, '');
  assert.equal(s.stopped(), 1);
});

test('resource distinguishes an initial failure from a loaded list refresh failure', async () => {
  const s = setup();
  assert.equal(s.resource.hasLoaded?.value, false, 'The resource must expose first-load state');
  const initial = s.show();
  await drain();
  s.reads[0].reject(new Error('第一次读取失败'));
  await initial;
  assert.equal(s.resource.hasLoaded.value, false);
  assert.deepEqual(s.resource.items.value, []);
  assert.equal(s.resource.error.value, '第一次读取失败');

  const retry = s.refresh();
  await drain();
  s.reads[1].resolve([{ id: 'saved' }]);
  await retry;
  assert.equal(s.resource.hasLoaded.value, true);
  assert.deepEqual(s.resource.items.value, [{ id: 'saved' }]);

  const refresh = s.refresh();
  await drain();
  s.reads[2].reject(new Error('刷新失败'));
  await refresh;
  assert.equal(s.resource.hasLoaded.value, true);
  assert.deepEqual(s.resource.items.value, [{ id: 'saved' }]);
  assert.equal(s.resource.error.value, '刷新失败');
});
