import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse, compileScript } from '@vue/compiler-sfc';
import ts from 'typescript';
import * as domain from '../src/lib/domain';

const require = createRequire(import.meta.url);
function deferred() {
  let resolve!: (value: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<any>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const before = { id: 'old-order', status: 'pending', note: '旧点单', items: [] };
const after = { ...before, status: 'done', note: '最新点单' };
function setup() {
  const vue = require('vue');
  const reads: ReturnType<typeof deferred>[] = [];
  const notices: string[] = [];
  const filename = fileURLToPath(new URL('../src/pages/menu/index.vue', import.meta.url));
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor;
  const output = ts.transpileModule(
    compileScript(descriptor, { id: 'uni-order-history' }).content,
    {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    },
  ).outputText;
  const module = { exports: {} as any };
  const dependencies: Record<string, any> = {
    '@dcloudio/uni-app': { onShow() {} },
    '../../lib/domain': domain,
    '../../lib/useResource': {
      useResource: () => ({
        session: { theme: 'cream' },
        items: vue.ref([{ id: 'rice', name: '米饭', priceCents: 200 }]),
        loading: vue.ref(false),
        error: vue.ref(''),
      }),
    },
    '../../lib/api': {
      notify: (message: string) => notices.push(message),
      confirm: async () => true,
      request: (path: string, method = 'GET') => {
        if (method !== 'GET') return Promise.resolve({});
        assert.equal(path, '/orders');
        const read = deferred();
        reads.push(read);
        return read.promise;
      },
    },
  };
  new Function('require', 'module', 'exports', output)(
    (specifier: string) =>
      dependencies[specifier] || (specifier.endsWith('.vue') ? {} : require(specifier)),
    module,
    module.exports,
  );
  const view = module.exports.default.setup({}, { expose() {} });
  return { view, reads, notices };
}
async function tick() {
  for (let i = 0; i < 6; i++) await Promise.resolve();
}

for (const action of ['create', 'complete', 'delete'] as const) {
  test(`an old mini-program history response cannot undo an order ${action}`, async () => {
    const s = setup();
    s.view.orders.value = [before];
    const oldRead = s.view.loadOrders();
    s.view.change('rice', 1);
    const changed =
      action === 'create'
        ? s.view.submitOrder()
        : action === 'complete'
          ? s.view.completeOrder(before)
          : s.view.deleteOrder(before);
    await tick();
    assert.equal(s.reads.length, 2);
    const latest = action === 'delete' ? [] : [after];
    s.reads[1].resolve(latest);
    await changed;
    assert.deepEqual(JSON.parse(JSON.stringify(s.view.orders.value)), latest);
    s.reads[0].resolve([before]);
    await oldRead;
    assert.deepEqual(JSON.parse(JSON.stringify(s.view.orders.value)), latest);
  });
}

test('a stale mini-program history failure does not notify after a newer success', async () => {
  const s = setup();
  const oldRead = s.view.loadOrders();
  const latestRead = s.view.loadOrders();
  s.reads[1].resolve([]);
  await latestRead;
  s.reads[0].reject(new Error('过期请求断网'));
  await oldRead;
  assert.deepEqual(s.notices, []);
  assert.deepEqual([...s.view.orders.value], []);
});

test('the latest mini-program history failure notifies and an older success stays ignored', async () => {
  const s = setup();
  s.view.orders.value = [after];
  const oldRead = s.view.loadOrders();
  const latestRead = s.view.loadOrders();
  s.reads[1].reject(new Error('最新请求断网'));
  await latestRead;
  assert.deepEqual(s.notices, ['最新请求断网']);
  s.reads[0].resolve([before]);
  await oldRead;
  assert.equal(s.view.orders.value[0].note, after.note);
  const retry = s.view.loadOrders();
  s.reads[2].resolve([]);
  await retry;
  assert.deepEqual([...s.view.orders.value], []);
});
