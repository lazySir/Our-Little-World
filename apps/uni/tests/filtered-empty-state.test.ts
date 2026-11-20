import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import { proxyRefs, ref } from 'vue';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const vue = require('vue');

function compilePage(path: string, kind: 'wishes' | 'memories' | 'menu', initialItems: any[]) {
  const filename = fileURLToPath(new URL(path, import.meta.url));
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor;
  const script = compileScript(descriptor, { id: `filtered-empty-${kind}` });
  const items = ref(initialItems);
  const refs = {
    session: { theme: 'cream' },
    items,
    hasLoaded: ref(true),
    loading: ref(false),
    error: ref(''),
    saving: ref(false),
    editor: ref(false),
    formError: ref(''),
    load() {},
    save() {},
    remove() {},
  };
  const imports: Record<string, any> = {
    '../../lib/useResource': { useResource: () => refs },
    '../../lib/calendar-source': {
      useCalendarSource: () => ({ calendarSource: ref(undefined), clearCalendarSource() {} }),
    },
    '../../lib/api': {
      request: async () => ({}),
      notify() {},
      navigate() {},
      confirm: async () => true,
      assetUrl: () => '',
      previewPhotos() {},
      refreshAssetOnError() {},
    },
    '../../lib/domain': {
      today: () => '2026-11-21',
      splitTags: (value: string) => value.split(',').filter(Boolean),
      money: (value: number) => String(value),
      centsFromInput: (value: string) => Number(value),
      buildOrderItems: () => [],
    },
    '@dcloudio/uni-app': { onShow() {}, onPullDownRefresh() {} },
  };
  function evaluate(source: string, dependencies: Record<string, any> = imports) {
    const module = { exports: {} as any };
    new Function(
      'require',
      'module',
      'exports',
      ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText,
    )(
      (name: string) => dependencies[name] || (name.endsWith('.vue') ? {} : require(name)),
      module,
      module.exports,
    );
    return module.exports;
  }
  const view = evaluate(script.content).default.setup({}, { expose() {} });
  const compiledTemplate = compileTemplate({
    source: descriptor.template!.content,
    filename,
    id: `filtered-empty-${kind}`,
    compilerOptions: { isCustomElement: () => true, bindingMetadata: script.bindings },
  });
  assert.deepEqual(compiledTemplate.errors, []);
  const render = evaluate(compiledTemplate.code, {
    vue: {
      ...vue,
      resolveComponent: (name: string) => name,
      withDirectives: (node: any) => node,
    },
  }).render;
  const context = proxyRefs(view);
  return {
    view,
    items,
    render: () => render(context, [], {}, context),
  };
}

function findEmptyState(value: any): any {
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findEmptyState(child);
      if (found) return found;
    }
    return undefined;
  }
  if (!value || typeof value !== 'object') return undefined;
  if (value.type === 'EmptyState') return value;
  const children = typeof value.children === 'object' ? value.children : undefined;
  return findEmptyState(children?.default?.() || children);
}

test('wish search and status filters show a clear-filter empty state', () => {
  const page = compilePage('../src/pages/wishes/index.vue', 'wishes', [
    { id: 'wish-1', title: '一起看日落', description: '海边散步', status: 'todo', category: 'travel' },
  ]);
  page.view.query.value = '不存在的愿望';
  page.view.filter.value = 'done';

  const emptyState = findEmptyState(page.render());
  assert.ok(emptyState);
  assert.equal(emptyState.props.title, '没有匹配的愿望');
  assert.equal(emptyState.props.action, '清除筛选');
  emptyState.props.onAction();
  assert.equal(page.view.query.value, '');
  assert.equal(page.view.filter.value, 'all');
});

test('wish search ignores whitespace and trims and normalizes a real query', () => {
  const page = compilePage('../src/pages/wishes/index.vue', 'wishes', [
    { id: 'wish-1', title: 'Plan a Sunset Walk', description: 'Visit the coast', status: 'todo', category: 'travel' },
  ]);
  page.view.query.value = '   ';
  assert.equal(page.view.hasFilter.value, false);
  assert.deepEqual(page.view.filtered.value.map((record: any) => record.id), ['wish-1']);

  page.view.query.value = '  SUNSET WALK  ';
  assert.equal(page.view.hasFilter.value, true);
  assert.deepEqual(page.view.filtered.value.map((record: any) => record.id), ['wish-1']);
});

test('memory search and category filters show a clear-filter empty state', () => {
  const page = compilePage('../src/pages/memories/index.vue', 'memories', [
    { id: 'memory-1', title: '一起看日落', content: '海边散步', tags: ['旅行'], kind: 'couple' },
  ]);
  page.view.query.value = '没有这条回忆';
  page.view.kind.value = 'baby';

  const emptyState = findEmptyState(page.render());
  assert.ok(emptyState);
  assert.equal(emptyState.props.title, '没有匹配的回忆');
  assert.equal(emptyState.props.action, '清除筛选');
  emptyState.props.onAction();
  assert.equal(page.view.query.value, '');
  assert.equal(page.view.kind.value, 'all');
});

test('memory search ignores whitespace and trims and normalizes a real query', () => {
  const page = compilePage('../src/pages/memories/index.vue', 'memories', [
    { id: 'memory-1', title: 'A Summer Evening', content: 'A walk together', tags: ['Coast'], kind: 'couple' },
  ]);
  page.view.query.value = '   ';
  assert.equal(page.view.hasFilter.value, false);
  assert.deepEqual(page.view.filtered.value.map((record: any) => record.id), ['memory-1']);

  page.view.query.value = '  SUMMER EVENING  ';
  assert.equal(page.view.hasFilter.value, true);
  assert.deepEqual(page.view.filtered.value.map((record: any) => record.id), ['memory-1']);
});

test('menu search, category and favorite filters can be cleared to reveal existing items', () => {
  const page = compilePage('../src/pages/menu/index.vue', 'menu', [
    { id: 'menu-1', name: '绿茶', category: 'drink', favorite: false, priceCents: 0 },
  ]);
  page.view.category.value = 'drink';
  page.view.query.value = '咖啡';
  page.view.favoriteOnly.value = true;

  const emptyState = findEmptyState(page.render());
  assert.ok(emptyState);
  assert.equal(emptyState.props.title, '没有匹配的菜单');
  assert.equal(emptyState.props.action, '清除筛选');
  emptyState.props.onAction();
  assert.equal(page.view.query.value, '');
  assert.equal(page.view.category.value, 'all');
  assert.equal(page.view.favoriteOnly.value, false);
  assert.equal(page.view.filtered.value.length, 1);
});

test('menu search ignores whitespace and trims and normalizes a real query', () => {
  const page = compilePage('../src/pages/menu/index.vue', 'menu', [
    { id: 'menu-1', name: 'Green Tea', description: 'Light and fresh', category: 'drink', favorite: true, priceCents: 0 },
  ]);
  page.view.category.value = 'all';
  page.view.query.value = '   ';
  assert.equal(page.view.hasFilter.value, false);
  assert.deepEqual(page.view.filtered.value.map((record: any) => record.id), ['menu-1']);

  page.view.query.value = '  GREEN TEA  ';
  assert.equal(page.view.hasFilter.value, true);
  assert.deepEqual(page.view.filtered.value.map((record: any) => record.id), ['menu-1']);
});
