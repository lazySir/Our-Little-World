import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse, compileScript } from '@vue/compiler-sfc';
import ts from 'typescript';
import * as domain from '../src/lib/domain';

const require = createRequire(import.meta.url);
function setup() {
  const vue = require('vue');
  const menu = [
    { id: 'rice', name: '米饭', priceCents: 200 },
    { id: 'tea', name: '茶', priceCents: 500 },
  ];
  const writes: { body: any; resolve: (value?: any) => void; reject: (error: Error) => void }[] =
    [];
  const filename = fileURLToPath(new URL('../src/pages/menu/index.vue', import.meta.url));
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor;
  const output = ts.transpileModule(compileScript(descriptor, { id: 'orders-test' }).content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as any };
  const dependencies: Record<string, any> = {
    '@dcloudio/uni-app': { onShow() {} },
    '../../lib/domain': domain,
    '../../lib/useResource': {
      useResource: () => ({
        session: { theme: 'cream' },
        items: vue.ref(menu),
        loading: vue.ref(false),
        error: vue.ref(''),
      }),
    },
    '../../lib/api': {
      notify() {},
      request: (_path: string, method = 'GET', body?: any) =>
        method === 'POST'
          ? new Promise((resolve, reject) => writes.push({ body, resolve, reject }))
          : Promise.resolve([]),
    },
  };
  new Function('require', 'module', 'exports', output)(
    (specifier: string) =>
      dependencies[specifier] || (specifier.endsWith('.vue') ? {} : require(specifier)),
    module,
    module.exports,
  );
  const view = module.exports.default.setup({}, { expose() {} });
  view.change('rice', 1);
  view.orderNote.value = '第一单';
  return { view, writes };
}

test('a pending mini-program order cannot change the basket being submitted', async () => {
  const s = setup();
  const pending = s.view.submitOrder();
  s.view.change('tea', 1);
  s.view.change('rice', -1);
  const cart = { ...s.view.cart };
  s.writes[0].resolve({ id: 'saved' });
  await pending;
  assert.deepEqual(cart, { rice: 1 });
  assert.deepEqual(s.writes[0].body.items, [{ menuItemId: 'rice', name: '米饭', quantity: 1 }]);
});

test('a pending mini-program order cannot submit twice', async () => {
  const s = setup();
  const first = s.view.submitOrder();
  const second = s.view.submitOrder();
  const count = s.writes.length;
  for (const write of s.writes) write.resolve({ id: 'saved' });
  await Promise.all([first, second]);
  assert.equal(count, 1);
});

test('a failed mini-program order keeps its basket and note editable for retry', async () => {
  const s = setup();
  const pending = s.view.submitOrder();
  s.writes[0].reject(new Error('暂时无法点单'));
  await pending;
  assert.equal(s.view.orderSaving.value, false);
  assert.deepEqual({ ...s.view.cart }, { rice: 1 });
  assert.equal(s.view.orderNote.value, '第一单');
  s.view.change('tea', 1);
  const retry = s.view.submitOrder();
  s.writes[1].resolve({ id: 'saved' });
  await retry;
  assert.deepEqual(s.writes[1].body.items, [
    { menuItemId: 'rice', name: '米饭', quantity: 1 },
    { menuItemId: 'tea', name: '茶', quantity: 1 },
  ]);
  assert.deepEqual({ ...s.view.cart }, {});
  assert.equal(s.view.orderNote.value, '');
});
