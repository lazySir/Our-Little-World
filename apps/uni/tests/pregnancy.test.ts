import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import { ref } from 'vue';
import ts from 'typescript';
import * as domain from '../src/lib/domain';

const require = createRequire(import.meta.url);
function setup() {
  const writes: { data: any; id?: string }[] = [];
  const resource = {
    session: { theme: 'cream', user: { id: 'owner' } },
    items: ref<any[]>([
      { id: 'checkup', title: '第一次产检', date: '2026-11-21', type: 'checkup' },
      { id: 'mood', title: '今天的心情', date: '2026-11-20', type: 'mood' },
    ]),
    hasLoaded: ref(true),
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
    load() {},
  };
  const filename = fileURLToPath(new URL('../src/pages/pregnancy/index.vue', import.meta.url));
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor;
  const script = compileScript(descriptor, { id: 'pregnancy-test' });
  const output = ts.transpileModule(script.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as any };
  const dependencies = {
    '../../lib/useResource': { useResource: () => resource },
    '../../lib/api': { assetUrl: () => '', previewPhotos() {}, refreshAssetOnError() {} },
    '../../lib/domain': domain,
  };
  new Function('require', 'module', 'exports', output)(
    (specifier: string) => dependencies[specifier] || (specifier.endsWith('.vue') ? {} : require(specifier)),
    module,
    module.exports,
  );
  return {
    view: module.exports.default.setup({}, { expose() {} }),
    writes,
    resource,
    descriptor,
    script,
    filename,
  };
}

test('pregnancy editor saves date, type, text and attachment ids', async () => {
  const s = setup();
  s.view.openNew();
  Object.assign(s.view.form, {
    title: '第一次产检',
    date: '2026-11-21',
    type: 'checkup',
    content: '今天有点紧张，也很期待。',
    assets: [{ id: 'asset-1' }],
  });
  await s.view.saveForm();
  assert.deepEqual(s.writes, [
    {
      id: undefined,
      data: {
        title: '第一次产检',
        date: '2026-11-21',
        type: 'checkup',
        content: '今天有点紧张，也很期待。',
        assetIds: ['asset-1'],
      },
    },
  ]);
});

test('pregnancy editor requires a title and date', async () => {
  const s = setup();
  s.view.openNew();
  await s.view.saveForm();
  assert.equal(s.writes.length, 0);
  assert.match(s.view.formError.value, /标题和日期/);
});

test('pregnancy list filters by record type as well as search text', () => {
  const s = setup();
  s.view.typeFilter.value = 'checkup';
  assert.deepEqual(s.view.filtered.value.map((record: any) => record.id), ['checkup']);
  s.view.typeFilter.value = 'all';
  s.view.query.value = '心情';
  assert.deepEqual(s.view.filtered.value.map((record: any) => record.id), ['mood']);
});

test('pregnancy editor keeps the API content limit', () => {
  const s = setup();
  const template = compileTemplate({
    source: s.descriptor.template!.content,
    filename: s.filename,
    id: 'pregnancy-limit-test',
    compilerOptions: { bindingMetadata: s.script.bindings },
  });
  assert.deepEqual(template.errors, []);
  assert.match(template.code, /maxlength: 10000/);
});
