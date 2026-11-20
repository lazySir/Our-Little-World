import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import { proxyRefs } from 'vue';
import ts from 'typescript';
import * as domain from '../src/lib/domain';

const require = createRequire(import.meta.url);
function evaluate(source: string, dependencies: Record<string, unknown>) {
  const module = { exports: {} as any };
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', 'uni', output)(
    (name: string) => dependencies[name] ?? (name.endsWith('.vue') ? {} : require(name)),
    module,
    module.exports,
    { stopPullDownRefresh() {} },
  );
  return module.exports;
}

const nodes = (node: any): any[] =>
  Array.isArray(node)
    ? node.flatMap(nodes)
    : node && typeof node === 'object'
      ? [node, ...nodes(node.children)]
      : [];

function setup(page: string, endpoint: string) {
  const shows: (() => unknown)[] = [];
  const platform = {
    onShow(callback: () => unknown) {
      shows.push(callback);
    },
    onPullDownRefresh() {},
    onResize() {},
  };
  const name = '已保存的宝宝档案';
  const failure = '读取暂时不可用';
  let result: Error | object[] = new Error(failure);
  const api = {
    async request(path: string) {
      if (page === 'baby' && path === '/baby') return { id: 'baby', name };
      assert.equal(path, '/' + endpoint);
      if (result instanceof Error) throw result;
      return result;
    },
    assetUrl() {},
    previewPhotos() {},
  };
  const resource = evaluate(
    readFileSync(new URL('../src/lib/useResource.ts', import.meta.url), 'utf8'),
    {
      './api': api,
      '../stores/session': { useSession: () => ({ theme: 'cream', load: async () => true }) },
      '@dcloudio/uni-app': platform,
    },
  );
  const filename = fileURLToPath(new URL('../src/pages/' + page + '/index.vue', import.meta.url));
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor;
  const script = compileScript(descriptor, { id: 'resource-page-' + page });
  const component = evaluate(script.content, {
    '../../lib/api': api,
    '../../lib/domain': domain,
    '../../lib/useResource': resource,
    '@dcloudio/uni-app': platform,
    '@our-little-world/shared/baby-album': require('@our-little-world/shared/baby-album'),
  }).default;
  const template = compileTemplate({
    source: descriptor.template!.content,
    filename,
    id: 'resource-page-' + page,
    compilerOptions: { isCustomElement: () => true, bindingMetadata: script.bindings },
  });
  assert.deepEqual(template.errors, []);
  const { render } = evaluate(template.code, {
    vue: {
      ...require('vue'),
      withCtx: (slot: unknown) => slot,
      withDirectives: (node: unknown) => node,
    },
  });
  const context = proxyRefs(component.setup({}, { expose() {} }));
  const rendered = () => nodes(render(context, [], {}, context));
  return {
    failure,
    show: () => Promise.all(shows.map((show) => show())),
    reply(next: Error | object[]) {
      result = next;
    },
    showsText: (text: string) => rendered().some((node) => node.children === text),
    showsEmptyAction: (action: string) => rendered().some((node) => node.props?.action === action),
    retry: () => {
      const button = rendered().find(
        (node) => node.type === 'wd-button' && node.children === '重新加载',
      );
      assert.ok(button, 'The page must offer a retry after its read fails');
      return button.props.onClick();
    },
  };
}

const date = domain.today();
const cases = [
  {
    page: 'anniversaries',
    empty: '添加一个纪念日',
    text: '♡ 纪念第一次约会',
    record: { title: '纪念第一次约会', date },
  },
  {
    page: 'letters',
    empty: '写第一封信',
    text: '写给明天',
    record: { title: '写给明天', unlockDate: date },
  },
  {
    page: 'work',
    empty: '写下第一篇手记',
    text: '完成了一个新想法',
    record: { title: '完成了一个新想法', date },
  },
  {
    page: 'ledger',
    empty: '记第一笔',
    text: '午餐开销',
    record: { category: '午餐开销', type: 'expense', amountCents: 1200, date },
  },
  {
    page: 'memories',
    empty: '写下第一篇回忆',
    text: '一起看海',
    record: { title: '一起看海', date },
  },
  {
    page: 'wishes',
    empty: '写下第一件事',
    text: '周末露营',
    record: { title: '周末露营', date, status: 'todo', category: 'travel' },
  },
  {
    page: 'baby',
    endpoint: 'growth',
    empty: '写下成长记录',
    text: '第一次翻身',
    record: { title: '第一次翻身', date, type: 'milestone' },
  },
];

for (const { page, endpoint, empty, text, record } of cases) {
  test(
    page +
      ' distinguishes first-read failure from empty results and retains saved content after refresh fails',
    async () => {
      const s = setup(page, endpoint || page);
      await s.show();
      assert.ok(s.showsText(s.failure));
      assert.equal(s.showsEmptyAction(empty), false);
      if (page === 'ledger') assert.equal(s.showsText('本月支出'), false);
      if (page === 'baby') assert.equal(s.showsText('宝宝相册'), false);

      s.reply([]);
      await s.retry();
      assert.equal(s.showsText(s.failure), false);
      assert.ok(s.showsEmptyAction(empty), 'A confirmed empty read must show the empty guidance');

      s.reply([{ id: 'saved', ...record }]);
      await s.show();
      assert.ok(s.showsText(text));
      assert.equal(s.showsEmptyAction(empty), false);

      s.reply(new Error(s.failure));
      const refresh = s.show();
      assert.ok(s.showsText(text), 'A pending refresh must keep the previous records visible');
      await refresh;
      assert.ok(s.showsText(s.failure));
      assert.ok(s.showsText(text), 'A failed refresh must keep the previous records visible');
    },
  );
}
