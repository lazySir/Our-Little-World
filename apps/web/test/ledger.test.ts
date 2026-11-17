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
  const writes: { body: any; resolve: (value?: any) => void; reject: (error: Error) => void }[] =
    [];
  function execute(source: string, dependencies: Record<string, any>) {
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
  const dependencies = {
    vue: { ...require('vue'), onMounted() {} },
    'element-plus': { ElMessage: { success() {}, error() {}, warning() {} }, ElMessageBox: {} },
  };
  const resource = execute(
    readFileSync(new URL('../src/composables/resource.ts', import.meta.url), 'utf8'),
    {
      ...dependencies,
      '../api': {
        api: {
          get: async () => [],
          post: (_path: string, body: any) =>
            new Promise((resolve, reject) => writes.push({ body, resolve, reject })),
        },
      },
    },
  );
  const filename = fileURLToPath(new URL('../src/pages/LedgerPage.vue', import.meta.url));
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor;
  const component = execute(compileScript(descriptor, { id: 'ledger-test' }).content, {
    ...dependencies,
    '../composables/resource': resource,
    '../stores/session': { useSession: () => ({ user: { nickname: '我' } }) },
    '../domain': domain,
  }).default;
  const view = component.setup({}, { expose() {} });
  view.edit();
  view.form.amount = '18.50';
  view.form.note = '第一笔';
  return { view, writes };
}

test('a pending ledger save cannot submit the same money twice', async () => {
  const s = setup();
  const first = s.view.submit();
  const second = s.view.submit();
  const count = s.writes.length;
  for (const write of s.writes) write.resolve({ id: 'saved' });
  await Promise.all([first, second]);
  assert.equal(count, 1);
  assert.equal(s.writes[0].body.amountCents, 1850);
});

test('a pending ledger save cannot replace its form with another record', async () => {
  const s = setup();
  const pending = s.view.submit();
  s.view.edit({
    id: 'another',
    type: 'income',
    amountCents: 9900,
    date: '2026-11-17',
    note: '另一本草稿',
  });
  const state = {
    amount: s.view.form.amount,
    note: s.view.form.note,
    editing: s.view.editing.value,
  };
  s.writes[0].resolve({ id: 'saved' });
  await pending;
  assert.deepEqual(state, { amount: '18.50', note: '第一笔', editing: null });
});

test('a failed ledger save retains the draft and allows a successful retry', async () => {
  const s = setup();
  const pending = s.view.submit();
  s.writes[0].reject(new Error('暂时无法记账'));
  await pending;
  assert.equal(s.view.saving.value, false);
  assert.equal(s.view.dialog.value, true);
  assert.equal(s.view.form.amount, '18.50');
  assert.equal(s.view.form.note, '第一笔');
  const retry = s.view.submit();
  assert.equal(s.writes.length, 2);
  s.writes[1].resolve({ id: 'saved' });
  await retry;
  assert.equal(s.view.dialog.value, false);
});
