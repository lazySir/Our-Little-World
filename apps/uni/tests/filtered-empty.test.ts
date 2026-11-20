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

function compilePage(path: string, kind: 'baby' | 'ledger' | 'work', initialItems: any[]) {
  const filename = fileURLToPath(new URL(path, import.meta.url));
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor;
  const script = compileScript(descriptor, { id: `filtered-empty-${kind}` });
  const items = ref(initialItems);
  const refs = {
    session: { theme: 'cream', user: { nickname: '我' } },
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
  const serverBusinessDate = ref('2026-11-21');
  const previewCalls: { assets: any[]; index: number }[] = [];
  const emptyStateComponent = { name: 'EmptyState' };
  const imports: Record<string, any> = {
    '../../components/EmptyState.vue': emptyStateComponent,
    '../../lib/useResource': { useResource: () => refs },
    '../../lib/calendar-source': {
      useCalendarSource: () => ({ calendarSource: ref(undefined), clearCalendarSource() {} }),
    },
    '../../lib/api': {
      request: async () => null,
      notify() {},
      navigate() {},
      confirm: async () => true,
      assetUrl: () => '',
      previewPhotos(assets: any[], index: number) {
        previewCalls.push({ assets, index });
      },
      refreshAssetOnError() {},
    },
    '../../lib/domain': {
      today: () => '2026-11-21',
      serverBusinessDate,
      splitTags: (value: string) => value.split(',').filter(Boolean),
      money: (value: number) => String(value),
      centsFromInput: (value: string) => Number(value),
      daysBetween: () => 0,
    },
    '@our-little-world/shared/baby-album': { collectBabyAlbumPhotos: () => [] },
    '@dcloudio/uni-app': { onShow() {}, onPullDownRefresh() {}, onResize() {} },
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
      resolveComponent: (name: string) => (name === 'EmptyState' ? emptyStateComponent : name),
      withDirectives: (node: any) => node,
    },
  }).render;
  const context = proxyRefs(view);
  return { view, items, previewCalls, render: () => render(context, [], {}, context) };
}

function childrenOf(value: any): any {
  if (Array.isArray(value)) return value;
  const children = value?.children;
  if (Array.isArray(children)) return children;
  if (children && typeof children === 'object' && typeof children.default === 'function')
    return children.default();
  return [];
}

function findNode(value: any, predicate: (node: any) => boolean): any {
  if (!value || typeof value !== 'object') return undefined;
  if (Array.isArray(value)) {
    for (const child of value) {
      const found = findNode(child, predicate);
      if (found) return found;
    }
    return undefined;
  }
  if (predicate(value)) return value;
  return findNode(childrenOf(value), predicate);
}

function debugTree(value: any): any {
  if (!value || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(debugTree);
  return {
    type: typeof value.type === 'string' ? value.type : typeof value.type,
    props: value.props,
    children: debugTree(value.children),
  };
}

function findEmptyState(value: any): any {
  return findNode(
    value,
    (node) =>
      (node.type === 'EmptyState' || node.type?.name === 'EmptyState') &&
      typeof node.props?.title === 'string' &&
      typeof node.props?.description === 'string' &&
      typeof node.props?.action === 'string',
  );
}

test('baby growth search and type filters offer a clear-filter empty state', () => {
  const page = compilePage('../src/pages/baby/index.vue', 'baby', [
    {
      id: 'growth-1',
      title: '第一次翻身',
      content: '今天学会翻身',
      type: 'milestone',
      date: '2026-11-20',
    },
  ]);
  page.view.query.value = '没有这条记录';
  page.view.filter.value = 'feeding';

  const emptyState = findEmptyState(page.render());
  assert.ok(emptyState);
  assert.equal(emptyState.props.title, '没有匹配的成长记录');
  assert.equal(emptyState.props.action, '清除筛选');
  emptyState.props.onAction();
  assert.equal(page.view.query.value, '');
  assert.equal(page.view.filter.value, 'all');
  assert.equal(page.view.filtered.value.length, 1);
});

test('ledger month and type filters can be cleared together to reveal current-month entries', () => {
  const page = compilePage('../src/pages/ledger/index.vue', 'ledger', [
    { id: 'ledger-nov', date: '2026-11-05', type: 'income', amountCents: 2000, category: '收入' },
    { id: 'ledger-oct', date: '2026-10-05', type: 'income', amountCents: 1000, category: '收入' },
  ]);
  page.view.selectMonth('2026-10');
  page.view.filter.value = 'expense';

  const emptyState = findEmptyState(page.render());
  assert.ok(emptyState);
  assert.equal(emptyState.props.title, '没有匹配的账本记录');
  assert.equal(emptyState.props.action, '清除筛选');
  emptyState.props.onAction();
  assert.equal(page.view.month.value, '2026-11');
  assert.equal(page.view.filter.value, 'all');
  assert.deepEqual(
    page.view.filtered.value.map((record: any) => record.id),
    ['ledger-nov'],
  );
});

test('choosing the current ledger month still counts as an explicit filter', () => {
  const page = compilePage('../src/pages/ledger/index.vue', 'ledger', []);
  page.view.selectMonth('2026-11');

  assert.equal(page.view.hasFilter.value, true);
  assert.equal(findEmptyState(page.render()).props.title, '没有匹配的账本记录');
});

test('ledger search matches category, note, and payer with normalized whitespace and case', () => {
  const page = compilePage('../src/pages/ledger/index.vue', 'ledger', [
    {
      id: 'ledger-match',
      date: '2026-11-05',
      type: 'expense',
      amountCents: 2000,
      category: 'Food',
      note: '晚餐小灯',
      payer: 'Xiao Xiong',
    },
    {
      id: 'ledger-other',
      date: '2026-11-06',
      type: 'expense',
      amountCents: 1000,
      category: '出行',
      note: '打车',
      payer: '另一位',
    },
  ]);

  const searchInput = findNode(
    page.render(),
    (node) => node.type === 'input' && node.props?.class === 'search',
  );
  assert.equal(searchInput?.props?.['aria-label'], '搜索分类、备注或付款人');

  for (const query of ['  FOOD  ', ' 小灯 ', ' xIaO xIoNg ']) {
    page.view.query.value = query;
    assert.deepEqual(
      page.view.filtered.value.map((record: any) => record.id),
      ['ledger-match'],
    );
  }
});

test('ledger search empty state clears the query and restores matching records', () => {
  const page = compilePage('../src/pages/ledger/index.vue', 'ledger', [
    {
      id: 'ledger-match',
      date: '2026-11-05',
      type: 'expense',
      amountCents: 2000,
      category: '餐饮',
      note: '周末晚餐',
      payer: '我们',
    },
  ]);
  page.view.query.value = '不存在的账目';

  const emptyState = findEmptyState(page.render());
  assert.ok(emptyState);
  assert.equal(emptyState.props.title, '没有匹配的账本记录');
  assert.equal(emptyState.props.action, '清除筛选');
  emptyState.props.onAction();
  assert.equal(page.view.query.value, '');
  assert.deepEqual(
    page.view.filtered.value.map((record: any) => record.id),
    ['ledger-match'],
  );
});

test('work search offers a clear-filter empty state and resets the query', () => {
  const page = compilePage('../src/pages/work/index.vue', 'work', [
    {
      id: 'work-1',
      title: '项目复盘',
      content: '整理了本周进展',
      tags: ['复盘'],
      date: '2026-11-20',
    },
  ]);
  page.view.query.value = '不存在的手记';

  const emptyState = findEmptyState(page.render());
  assert.ok(emptyState);
  assert.equal(emptyState.props.title, '没有匹配的手记');
  assert.equal(emptyState.props.action, '清除筛选');
  emptyState.props.onAction();
  assert.equal(page.view.query.value, '');
  assert.equal(page.view.filtered.value.length, 1);
});

test('work journal photo previews are keyboard-operable labeled buttons', () => {
  const page = compilePage('../src/pages/work/index.vue', 'work', [
    {
      id: 'work-1',
      title: '项目复盘',
      content: '',
      tags: [],
      date: '2026-11-20',
      assets: [{ id: 'asset-1', url: '/photo.webp' }],
    },
  ]);
  const preview = findNode(
    page.render(),
    (node) =>
      (node.type === 'button' || node.type?.name === 'button') &&
      String(node.props?.class || '').includes('photo-preview'),
  );
  assert.ok(preview, JSON.stringify(debugTree(page.render())));
  assert.equal(preview.props['aria-label'], '预览项目复盘照片 1');
  assert.equal(typeof preview.props.onClick, 'function');
  preview.props.onClick();
  assert.deepEqual(page.previewCalls, [
    { assets: [{ id: 'asset-1', url: '/photo.webp' }], index: 0 },
  ]);
});

test('mini-program search inputs expose readable labels on every searchable page', () => {
  const cases = [
    ['baby', '../src/pages/baby/index.vue', '搜索成长记录'],
    ['menu', '../src/pages/menu/index.vue', '搜索想吃的'],
    ['memories', '../src/pages/memories/index.vue', '搜索标题或标签'],
    ['pregnancy', '../src/pages/pregnancy/index.vue', '搜索标题或记录内容'],
    ['wishes', '../src/pages/wishes/index.vue', '搜索你们想做的事'],
    ['work', '../src/pages/work/index.vue', '搜索标题、内容或标签'],
  ] as const;

  for (const [kind, path, label] of cases) {
    const page = compilePage(path, kind, []);
    const searchInput = findNode(
      page.render(),
      (node) => node.type === 'input' && node.props?.class === 'search',
    );
    assert.equal(searchInput?.props?.['aria-label'], label, kind + ' search label');
  }
});
