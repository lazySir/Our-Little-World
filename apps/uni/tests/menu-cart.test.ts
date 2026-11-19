import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import { createRenderer, h, proxyRefs } from 'vue';
import ts from 'typescript';
import * as domain from '../src/lib/domain';

const require = createRequire(import.meta.url);
const menu = [
  { id: 'rice', name: '米饭', category: 'dish', priceCents: 200 },
  { id: 'tea', name: '茶', category: 'drink', priceCents: 500 },
  { id: 'soup', name: '汤', category: 'dish', priceCents: 1250 },
];
const nodes = (node: any): any[] =>
  Array.isArray(node)
    ? node.flatMap(nodes)
    : node && typeof node === 'object'
      ? [node, ...nodes(node.children)]
      : [];
const textOf = (node: any): string =>
  Array.isArray(node)
    ? node.map(textOf).join('')
    : node && typeof node === 'object'
      ? textOf(node.children)
      : typeof node === 'string'
        ? node
        : '';
const renderer = createRenderer<any, any>({
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  setText() {},
  setElementText() {},
  patchProp() {},
  insert() {},
  remove() {},
  parentNode: () => null,
  nextSibling: () => null,
});

// Run the real page and resource lifecycle; replace only platform hooks and network I/O.
function setup() {
  let storedMenu = structuredClone(menu);
  const shows: (() => Promise<void>)[] = [];
  const refreshes: (() => Promise<void>)[] = [];
  const writes: { path: string; method: string; data: any }[] = [];
  const notices: string[] = [];
  const platform = {
    onShow(callback: () => Promise<void>) {
      shows.push(callback);
    },
    onPullDownRefresh(callback: () => Promise<void>) {
      refreshes.push(callback);
    },
  };
  const api = {
    async postOrder(_data: any): Promise<any> {
      return { id: 'order-saved' };
    },
    async request(path: string, method = 'GET', data?: any) {
      if (method !== 'GET') writes.push({ path, method, data: structuredClone(data) });
      if (path === '/menu' && method === 'GET') return structuredClone(storedMenu);
      if (path.startsWith('/menu/') && method === 'DELETE') {
        storedMenu = storedMenu.filter((item) => item.id !== path.slice('/menu/'.length));
        return { ok: true };
      }
      if (path === '/orders' && method === 'GET') return [];
      if (path === '/orders' && method === 'POST') return api.postOrder(data);
      throw new Error(`Unexpected request: ${method} ${path}`);
    },
    notify(message: string) {
      notices.push(message);
    },
    confirm: async () => true,
    assetUrl: (asset: any) => asset.url,
    previewPhotos() {},
  };
  const evaluate = (source: string, dependencies: Record<string, unknown>) => {
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} as any };
    new Function('require', 'module', 'exports', 'uni', output)(
      (specifier: string) =>
        dependencies[specifier] || (specifier.endsWith('.vue') ? {} : require(specifier)),
      module,
      module.exports,
      { stopPullDownRefresh() {} },
    );
    return module.exports;
  };
  const resource = evaluate(
    readFileSync(new URL('../src/lib/useResource.ts', import.meta.url), 'utf8'),
    {
      '@dcloudio/uni-app': platform,
      './api': api,
      '../stores/session': { useSession: () => ({ theme: 'cream', load: async () => true }) },
    },
  );
  const filename = fileURLToPath(new URL('../src/pages/menu/index.vue', import.meta.url));
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor;
  const script = compileScript(descriptor, { id: 'menu-cart-test' });
  const page = evaluate(script.content, {
    '@dcloudio/uni-app': platform,
    '../../lib/useResource': resource,
    '../../lib/api': api,
    '../../lib/domain': domain,
  });
  const view = page.default.setup({}, { expose() {} });
  const template = compileTemplate({
    source: descriptor.template!.content,
    filename,
    id: 'menu-cart-test',
    compilerOptions: { isCustomElement: () => true, bindingMetadata: script.bindings },
  });
  assert.deepEqual(template.errors, []);
  const render = evaluate(template.code, {}).render;
  const context = proxyRefs(view);
  return {
    view,
    api,
    writes,
    notices,
    show: () => Promise.all(shows.map((callback) => callback())),
    refresh: () => Promise.all(refreshes.map((callback) => callback())),
    removeRemotely(id: string) {
      storedMenu = storedMenu.filter((item) => item.id !== id);
    },
    orderWrites: () => writes.filter((write) => write.path === '/orders'),
    render() {
      let rendered: any;
      const root = {};
      renderer.render(
        h({
          render() {
            rendered = render(context, [], {}, context);
            return null;
          },
        }),
        root,
      );
      renderer.render(null, root);
      return rendered;
    },
  };
}
function basket(s: ReturnType<typeof setup>) {
  return nodes(s.render()).find((node) => node.props?.class === 'sticky-cart');
}
async function fillBasket(s: ReturnType<typeof setup>) {
  await s.show();
  s.view.change('rice', 2);
  s.view.change('tea', 3);
  s.view.change('soup', 1);
  s.view.orderNote.value = '少糖，今晚一起吃';
  assert.equal(s.view.cartCount.value, 6);
  assert.equal(s.view.cartTotal.value, 3150);
}

test('deleting a selected menu item refreshes basket portions without losing surviving selections', async () => {
  const s = setup();
  await fillBasket(s);
  await s.view.remove(menu[0]);
  assert.equal(s.view.cartCount.value, 4);
  assert.equal(s.view.cartTotal.value, 2750);
  assert.ok(textOf(basket(s)).includes('这一顿 · 4 份'));
  assert.ok(textOf(basket(s)).includes('¥27.50'));
  assert.equal(s.view.cart.tea, 3);
  assert.equal(s.view.cart.soup, 1);
  assert.equal(s.view.orderNote.value, '少糖，今晚一起吃');
  await s.view.submitOrder();
  assert.deepEqual(s.orderWrites()[0].data, {
    items: [
      { menuItemId: 'tea', name: '茶', quantity: 3 },
      { menuItemId: 'soup', name: '汤', quantity: 1 },
    ],
    note: '少糖，今晚一起吃',
    status: 'pending',
  });
});

for (const lifecycle of ['show', 'refresh'] as const) {
  test(`a partner deletion followed by ${lifecycle} counts only menu items that still exist`, async () => {
    const s = setup();
    await fillBasket(s);
    s.removeRemotely('tea');
    await s[lifecycle]();
    assert.equal(s.view.cartCount.value, 3);
    assert.equal(s.view.cartTotal.value, 1650);
    assert.ok(textOf(basket(s)).includes('这一顿 · 3 份'));
    assert.ok(textOf(basket(s)).includes('¥16.50'));
    assert.equal(s.view.cart.rice, 2);
    assert.equal(s.view.cart.soup, 1);
    await s.view.submitOrder();
    assert.deepEqual(s.orderWrites()[0].data.items, [
      { menuItemId: 'rice', name: '米饭', quantity: 2 },
      { menuItemId: 'soup', name: '汤', quantity: 1 },
    ]);
  });
}

test('a basket whose selected menu items were all deleted is hidden and cannot submit a ghost order', async () => {
  const s = setup();
  await fillBasket(s);
  for (const item of menu) s.removeRemotely(item.id);
  await s.refresh();
  assert.equal(s.view.cartCount.value, 0);
  assert.equal(s.view.cartTotal.value, 0);
  assert.equal(basket(s), undefined);
  await s.view.submitOrder();
  assert.equal(s.orderWrites().length, 0);
  assert.equal(s.view.orderNote.value, '少糖，今晚一起吃');
  assert.equal(s.view.orderSaving.value, false);
});

test('a refreshed basket retains its surviving draft and note after a failed locked submission', async () => {
  const s = setup();
  await fillBasket(s);
  s.removeRemotely('tea');
  await s.show();
  let reject!: (reason: Error) => void;
  s.api.postOrder = () =>
    new Promise((_resolve, fail) => {
      reject = fail;
    });
  const submitting = s.view.submitOrder();
  assert.equal(s.view.orderSaving.value, true);
  s.view.change('rice', -1);
  s.view.change('soup', 1);
  await s.view.submitOrder();
  assert.equal(s.orderWrites().length, 1);
  assert.equal(s.view.cart.rice, 2);
  assert.equal(s.view.cart.soup, 1);
  reject(new Error('暂时无法点单'));
  await submitting;
  assert.equal(s.view.orderSaving.value, false);
  assert.equal(s.view.cartCount.value, 3);
  assert.equal(s.view.cartTotal.value, 1650);
  assert.equal(s.view.cart.rice, 2);
  assert.equal(s.view.cart.soup, 1);
  assert.equal(s.view.orderNote.value, '少糖，今晚一起吃');
  assert.deepEqual(s.orderWrites()[0].data.items, [
    { menuItemId: 'rice', name: '米饭', quantity: 2 },
    { menuItemId: 'soup', name: '汤', quantity: 1 },
  ]);
  s.view.change('rice', 1);
  assert.equal(s.view.cartCount.value, 4);
});
