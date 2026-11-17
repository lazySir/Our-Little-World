import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse, compileScript } from '@vue/compiler-sfc';
import ts from 'typescript';
import * as domain from '../src/domain.ts';

const require = createRequire(import.meta.url);
function setup() {
  const vue = require('vue');
  const rice = { id: 'rice', name: '米饭', priceCents: 200 };
  const tea = { id: 'tea', name: '茶', priceCents: 500 };
  const writes: { body: any; resolve: (value?: any) => void; reject: (error: Error) => void }[] =
    [];
  const filename = fileURLToPath(new URL('../src/pages/MealsPage.vue', import.meta.url));
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor;
  const output = ts.transpileModule(compileScript(descriptor, { id: 'meals-test' }).content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as any };
  const dependencies: Record<string, any> = {
    vue: { ...vue, onMounted() {} },
    'element-plus': { ElMessage: { success() {}, error() {}, warning() {} }, ElMessageBox: {} },
    '../domain': domain,
    '../composables/resource': {
      useResource: () => ({
        items: vue.ref([rice, tea]),
        loading: vue.ref(false),
        error: vue.ref(''),
      }),
    },
    '../api': {
      api: {
        get: async () => [],
        post: (_path: string, body: any) =>
          new Promise((resolve, reject) => writes.push({ body, resolve, reject })),
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
  view.add(rice);
  view.orderNote.value = '第一单';
  view.orderDialog.value = true;
  return { view, writes, rice, tea };
}

test('a pending order cannot change the submitted basket or clear a new selection', async () => {
  const s = setup();
  const pending = s.view.submitOrder();
  s.view.add(s.tea);
  s.view.minus(s.rice);
  const cart = { ...s.view.cart };
  s.writes[0].resolve({ id: 'saved' });
  await pending;
  assert.deepEqual(cart, { rice: 1 });
  assert.deepEqual(s.writes[0].body.items, [{ menuItemId: 'rice', quantity: 1 }]);
  assert.equal(s.view.orderBusy.value, false);
});

test('a failed order retains its basket and note for retry', async () => {
  const s = setup();
  const pending = s.view.submitOrder();
  s.writes[0].reject(new Error('点单暂时中断'));
  await pending;
  assert.equal(s.view.orderBusy.value, false);
  assert.equal(s.view.orderDialog.value, true);
  assert.deepEqual({ ...s.view.cart }, { rice: 1 });
  assert.equal(s.view.orderNote.value, '第一单');
  s.view.add(s.tea);
  const retry = s.view.submitOrder();
  assert.equal(s.writes.length, 2);
  s.writes[1].resolve({ id: 'saved' });
  await retry;
  assert.deepEqual(s.writes[1].body.items, [
    { menuItemId: 'rice', quantity: 1 },
    { menuItemId: 'tea', quantity: 1 },
  ]);
  assert.deepEqual({ ...s.view.cart }, {});
  assert.equal(s.view.orderDialog.value, false);
});
