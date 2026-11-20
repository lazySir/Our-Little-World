import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import { proxyRefs, ref } from 'vue';
import ts from 'typescript';
import * as domain from '../src/domain.ts';

const require = createRequire(import.meta.url);

function setup() {
  const writes: any[] = [];
  const records = ref([
    { id: 'checkup', title: '第一次产检', date: '2026-11-21', type: 'checkup' },
    { id: 'mood', title: '今天的心情', date: '2026-11-20', type: 'mood' },
  ]);
  const filename = fileURLToPath(new URL('../src/pages/ResourcePage.vue', import.meta.url));
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor;
  const script = compileScript(descriptor, { id: 'pregnancy-test' });
  const module = { exports: {} as any };
  const dependencies = {
    '../api': { api: { get: async () => [] }, assetUrl: () => '', refreshAssetOnError() {} },
    '../domain': domain,
    '../stores/session': { useSession: () => ({ user: { id: 'owner' } }) },
    '../composables/record-focus': { useRecordFocus: () => () => {} },
    '../components/PhotoUpload.vue': 'PhotoUpload',
    '../components/CalendarSourceStatus.vue': 'CalendarSourceStatus',
    '../composables/resource': {
      useResource: () => ({
        items: records,
        loading: ref(false),
        error: ref(''),
        saving: ref(false),
        load() {},
        async save(data: any, id?: string) {
          writes.push({ data, id });
        },
        remove() {},
      }),
    },
    'element-plus': { ElMessage: { warning() {}, success() {}, error() {} }, ElMessageBox: {} },
  };
  const output = ts.transpileModule(script.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', output)(
    (specifier: string) => dependencies[specifier] || require(specifier),
    module,
    module.exports,
  );
  const props = { kind: 'pregnancy' };
  const view = proxyRefs(module.exports.default.setup(props, { expose() {} }));
  return { view, props, writes, records, descriptor, script, filename };
}

test('Web pregnancy records filter by type and save dated text with attached assets', async () => {
  const s = setup();
  s.view.tab = 'checkup';
  assert.deepEqual(s.view.filtered.map((record: any) => record.id), ['checkup']);

  s.view.resetForm();
  Object.assign(s.view.form, {
    title: '第一次听到心跳',
    date: '2026-11-21',
    type: 'milestone',
    content: '把今天记下来',
    assetIds: ['shared-photo'],
  });
  await s.view.submit();
  assert.deepEqual(s.writes, [
    {
      data: {
        title: '第一次听到心跳',
        date: '2026-11-21',
        type: 'milestone',
        content: '把今天记下来',
        assetIds: ['shared-photo'],
      },
      id: undefined,
    },
  ]);
});

test('Web pregnancy page template compiles with a type selector and photo picker', () => {
  const s = setup();
  const template = compileTemplate({
    source: s.descriptor.template!.content,
    filename: s.filename,
    id: 'pregnancy-test',
    compilerOptions: { bindingMetadata: s.script.bindings },
  });
  assert.deepEqual(template.errors, []);
  assert.match(template.code, /typeOptions/);
  assert.match(template.code, /PhotoUpload/);
  assert.match(s.descriptor.template!.content, /v-for="\(asset, index\) in item\.assets"/);
  assert.match(s.descriptor.template!.content, /preview-src-list="item\.assets\?\.map\(assetUrl\)"/);
});

test('Web pregnancy empty state treats a type-only filter as an active filter', () => {
  const s = setup();
  const template = s.descriptor.template!.content;
  const start = template.indexOf('<EmptyState');
  const end = template.indexOf('/>', start) + 2;
  const emptyState = template.slice(start, end);
  assert.match(emptyState, /hasFilter/);
  assert.match(emptyState, /clearFilters()/);
});
