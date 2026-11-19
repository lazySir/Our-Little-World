import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse, compileScript } from '@vue/compiler-sfc';
import { ref } from 'vue';
import ts from 'typescript';
import * as domain from '../src/lib/domain';

const require = createRequire(import.meta.url);
function setup(t: any) {
  const previousTZ = process.env.TZ;
  process.env.TZ = 'Asia/Shanghai';
  t.after(() => {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  });
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 18, 15, 59) });
  const writes: any[] = [];
  const resource = {
    session: { theme: 'cream', user: { id: 'owner' } },
    items: ref([]),
    loading: ref(false),
    error: ref(''),
    saving: ref(false),
    editor: ref(false),
    formError: ref(''),
    async save(data: any, id?: string) {
      writes.push({ data, id });
      return true;
    },
    remove() {},
  };
  const filename = fileURLToPath(new URL('../src/pages/letters/index.vue', import.meta.url));
  const source = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, {
    id: 'letters-test',
  }).content;
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies = {
    '../../lib/useResource': { useResource: () => resource },
    '../../lib/domain': domain,
  };
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', output)(
    (specifier: string) =>
      dependencies[specifier] || (specifier.endsWith('.vue') ? {} : require(specifier)),
    module,
    module.exports,
  );
  return { view: module.exports.default.setup({}, { expose() {} }), writes };
}

test('reopening a letter on the same page after midnight defaults to the new tomorrow', async (t) => {
  const s = setup(t);
  assert.equal(domain.today(), '2026-11-18');
  s.view.openNew();
  assert.equal(s.view.form.unlockDate, '2026-11-19');
  s.view.editor.value = false;
  t.mock.timers.setTime(Date.UTC(2026, 10, 18, 16, 1));
  assert.equal(domain.today(), '2026-11-19');
  s.view.openNew();
  assert.equal(s.view.form.unlockDate, '2026-11-20');
  Object.assign(s.view.form, { title: '跨过午夜的信', content: '留给明天的我们' });
  await s.view.saveForm();
  assert.equal(
    s.writes.length,
    1,
    'The newly opened default must pass the actual future-date check',
  );
  assert.equal(s.writes[0].data.unlockDate, '2026-11-20');
  assert.equal(s.view.formError.value, '');
});
