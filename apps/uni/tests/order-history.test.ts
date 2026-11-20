import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import { proxyRefs, ref } from 'vue';
import ts from 'typescript';
import * as domain from '../src/lib/domain';

const require = createRequire(import.meta.url);
const nodes = (node: any): any[] =>
  Array.isArray(node)
    ? node.flatMap(nodes)
    : node && typeof node === 'object'
      ? [node, ...nodes(node.children)]
      : [];
function evaluate(source: string, dependencies: Record<string, unknown> = {}) {
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', output)(
    (specifier: string) =>
      dependencies[specifier] || (specifier.endsWith('.vue') ? {} : require(specifier)),
    module,
    module.exports,
  );
  return module.exports;
}
function deferred() {
  let resolve!: (value: any) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<any>((ok, fail) => {
    resolve = ok;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const before = { id: 'old-order', status: 'pending', note: '旧点单', items: [], totalCents: 200 };
const after = { ...before, status: 'done', note: '最新点单' };
function setup() {
  const reads: ReturnType<typeof deferred>[] = [];
  const notices: string[] = [];
  const filename = fileURLToPath(new URL('../src/pages/menu/index.vue', import.meta.url));
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor;
  const id = 'uni-order-history';
  const script = compileScript(descriptor, { id });
  let show!: () => Promise<void>;
  const page = evaluate(script.content, {
    '@dcloudio/uni-app': {
      onShow(callback: typeof show) {
        show = callback;
      },
    },
    '../../lib/domain': domain,
    '../../lib/useResource': {
      useResource: () => ({
        session: { theme: 'cream' },
        items: ref([{ id: 'rice', name: '米饭', priceCents: 200, category: 'dish' }]),
        hasLoaded: ref(true),
        loading: ref(false),
        error: ref(''),
        editor: ref(false),
        formError: ref(''),
        saving: ref(false),
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
  }).default;
  const view = page.setup({}, { expose() {} });
  const template = compileTemplate({
    source: descriptor.template!.content,
    filename,
    id,
    compilerOptions: { isCustomElement: () => true, bindingMetadata: script.bindings },
  });
  assert.deepEqual(template.errors, []);
  const render = evaluate(template.code, {
    vue: { ...require('vue'), withDirectives: (node: any) => node },
  }).render;
  const context = proxyRefs(view);
  const rendered = () => nodes(render(context, [], {}, context));
  return {
    view,
    reads,
    notices,
    show,
    hasText: (text: string) => rendered().some((node) => node.children === text),
    retry() {
      const button = rendered().find(
        (node) => node.type === 'wd-button' && node.children === '重新加载',
      );
      assert.ok(button, 'The menu must offer a retry for the failed order history read');
      return button.props.onClick();
    },
  };
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

test('a stale mini-program history failure stays hidden after a newer success', async () => {
  const s = setup();
  const oldRead = s.view.loadOrders();
  const latestRead = s.view.loadOrders();
  s.reads[1].resolve([]);
  await latestRead;
  s.reads[0].reject(new Error('过期请求断网'));
  await oldRead;
  assert.deepEqual(s.notices, []);
  assert.deepEqual([...s.view.orders.value], []);
  assert.equal(s.hasText('过期请求断网'), false);
});

test('the latest mini-program history failure stays visible after an older success', async () => {
  const s = setup();
  s.view.orders.value = [after];
  const oldRead = s.view.loadOrders();
  const latestRead = s.view.loadOrders();
  s.reads[1].reject(new Error('最新请求断网'));
  await latestRead;
  assert.equal(s.hasText('最新请求断网'), true);
  s.reads[0].resolve([before]);
  await oldRead;
  assert.equal(s.hasText('最新请求断网'), true);
  assert.equal(s.hasText(after.note), true);
  assert.equal(s.hasText(before.note), false);
  const retry = s.retry();
  s.reads[2].resolve([]);
  await retry;
  assert.deepEqual([...s.view.orders.value], []);
});

test('the menu displays empty order history only after a successful read', async () => {
  const s = setup();
  const firstRead = s.show();
  const emptyMessage = '想吃的选好后，在这里一起开饭。';
  assert.equal(s.hasText('点单记录打开中…'), true);
  s.reads[0].reject(new Error('点单记录暂时无法读取'));
  await firstRead;

  assert.equal(s.hasText('点单记录打开中…'), false);
  assert.equal(s.hasText('点单记录暂时无法读取'), true);
  assert.equal(s.hasText('0 单'), false);
  assert.equal(s.hasText(emptyMessage), false);

  const retry = s.retry();
  s.reads[1].resolve([]);
  await retry;

  assert.equal(s.hasText('点单记录暂时无法读取'), false);
  assert.equal(s.hasText('0 单'), true);
  assert.equal(s.hasText(emptyMessage), true);
});

test('a refresh failure preserves existing mini-program history for retry', async () => {
  const s = setup();
  const firstRead = s.show();
  s.reads[0].resolve([before]);
  await firstRead;

  const refresh = s.show();
  s.reads[1].reject(new Error('点单记录刷新失败'));
  await refresh;

  assert.equal(s.hasText(before.note), true);
  assert.equal(s.hasText('1 单'), true);
  assert.equal(s.hasText('点单记录刷新失败'), true);

  const retry = s.retry();
  s.reads[2].resolve([after]);
  await retry;

  assert.equal(s.hasText('点单记录刷新失败'), false);
  assert.equal(s.hasText(before.note), false);
  assert.equal(s.hasText(after.note), true);
});
