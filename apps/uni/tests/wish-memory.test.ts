import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import { proxyRefs, ref } from 'vue';
import ts from 'typescript';
import * as domain from '../src/lib/domain';

const require = createRequire(import.meta.url);
const nodes = (node: any): any[] =>
  Array.isArray(node)
    ? node.flatMap(nodes)
    : node && typeof node === 'object'
      ? [
          node,
          ...nodes(
            typeof node.children?.default === 'function' ? node.children.default() : node.children,
          ),
        ]
      : [];
const textOf = (node: any): string =>
  Array.isArray(node)
    ? node.map(textOf).join('')
    : node && typeof node === 'object'
      ? textOf(node.children)
      : typeof node === 'string'
        ? node
        : '';

function setup(
  initialItems = [
    {
      id: 'wish-sunset',
      title: '一起看日落',
      description: '去海边慢慢散步',
      status: 'done',
      category: 'travel',
      completedAt: '2026-11-19',
    },
  ],
) {
  const wish = {
    id: 'wish-sunset',
    title: '一起看日落',
    description: '去海边慢慢散步',
    status: 'done',
    category: 'travel',
    completedAt: '2026-11-19',
  };
  const writes: {
    path: string;
    method: string;
    body: any;
    resolve: (value?: any) => void;
    reject: (error: Error) => void;
  }[] = [];
  const notices: string[] = [];
  const navigations: string[] = [];
  const hasLoaded = ref(true);
  const items = ref(initialItems);
  const filename = fileURLToPath(new URL('../src/pages/wishes/index.vue', import.meta.url));
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor;
  const script = compileScript(descriptor, { id: 'wish-memory-test' });
  function evaluate(source: string, dependencies: Record<string, any>) {
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
  const view = evaluate(script.content, {
    '../../lib/api': {
      request: (path: string, method: string, body: any) =>
        new Promise((resolve, reject) => writes.push({ path, method, body, resolve, reject })),
      notify: (message: string) => notices.push(message),
      navigate: (url: string) => navigations.push(url),
    },
    '../../lib/domain': domain,
    '../../lib/useResource': {
      useResource: () => ({
        session: { theme: 'cream' },
        items,
        loading: ref(false),
        error: ref(''),
        hasLoaded,
        saving: ref(false),
        editor: ref(false),
        formError: ref(''),
        load() {},
        save() {},
        remove() {},
      }),
    },
    '../../lib/calendar-source': {
      useCalendarSource: () => ({ calendarSource: ref(undefined), clearCalendarSource() {} }),
    },
  }).default.setup({}, { expose() {} });
  const template = compileTemplate({
    source: descriptor.template!.content,
    filename,
    id: 'wish-memory-test',
    compilerOptions: { isCustomElement: () => true, bindingMetadata: script.bindings },
  });
  assert.deepEqual(template.errors, []);
  const render = evaluate(template.code, {
    vue: {
      ...require('vue'),
      resolveComponent: (name: string) => name,
      withCtx: (slot: any) => slot,
      withDirectives: (node: any) => node,
    },
  }).render;
  const context = proxyRefs(view);
  function action() {
    const button = nodes(render(context, [], {}, context)).find(
      (node) =>
        typeof node.props?.onClick === 'function' &&
        ['收藏为回忆', '已收藏为回忆'].includes(textOf(node).trim()),
    );
    assert.ok(button, 'The real wish template must render the conversion action');
    return button;
  }
  return {
    wish,
    writes,
    notices,
    navigations,
    action,
    items,
    hasLoaded,
    render: () => render(context, [], {}, context),
  };
}

test('a delayed mini-program wish conversion shows progress and a double tap writes and navigates once', async () => {
  const s = setup();
  const action = s.action();
  const first = action.props.onClick();
  const repeated = action.props.onClick();
  try {
    assert.equal(s.writes.length, 1, 'Repeated taps must share the pending conversion');
    assert.equal(
      s.action().type,
      'wd-button',
      'The action must use the existing Wot loading button',
    );
    assert.equal(s.action().props.loading, true, 'The actual action must show progress');
    assert.equal(s.action().props.disabled, true);
    assert.deepEqual(s.notices, []);
    assert.deepEqual(s.navigations, []);
  } finally {
    for (const write of s.writes) write.resolve({ id: 'memory-saved' });
    await Promise.all([first, repeated]);
  }
  assert.equal(s.writes[0].path, '/memories');
  assert.equal(s.writes[0].method, 'POST');
  assert.deepEqual(s.writes[0].body, {
    title: s.wish.title,
    content: s.wish.description,
    date: domain.today(),
    tags: ['愿望完成'],
    assetIds: [],
    kind: 'couple',
  });
  assert.deepEqual(s.notices, ['已经放入回忆相册']);
  assert.deepEqual(s.navigations, ['/pages/memories/index']);
  assert.equal(s.action().props.loading, false);
  assert.equal(s.action().props.disabled, true);
  assert.equal(textOf(s.action()), '已收藏为回忆');
});

test('a failed mini-program wish conversion releases its action and a real retry navigates once', async () => {
  const s = setup();
  const first = s.action().props.onClick();
  s.writes[0].reject(new Error('回忆暂时没有保存'));
  await first;
  assert.deepEqual(s.notices, ['回忆暂时没有保存']);
  assert.deepEqual(s.navigations, []);
  assert.equal(s.action().props.loading, false);
  assert.equal(s.action().props.disabled, false);
  const retry = s.action().props.onClick();
  const repeated = s.action().props.onClick();
  try {
    assert.equal(s.writes.length, 2, 'Retry must create exactly one new request');
    assert.equal(s.action().props.loading, true);
  } finally {
    for (const write of s.writes.slice(1)) write.resolve({ id: 'memory-retried' });
    await Promise.all([retry, repeated]);
  }
  assert.deepEqual(s.writes[1].body, s.writes[0].body, 'The retry must keep the wish content');
  assert.deepEqual(s.notices, ['回忆暂时没有保存', '已经放入回忆相册']);
  assert.deepEqual(s.navigations, ['/pages/memories/index']);
  assert.equal(s.action().props.loading, false);
  assert.equal(s.action().props.disabled, true);
  assert.equal(textOf(s.action()), '已收藏为回忆');
});

test('a successful mini-program wish conversion disables the action and blocks a duplicate record', async () => {
  const s = setup();
  const first = s.action().props.onClick();
  s.writes[0].resolve({ id: 'memory-saved' });
  await first;

  assert.equal(s.action().props.disabled, true);
  assert.equal(s.action().props.loading, false);
  assert.equal(textOf(s.action()), '已收藏为回忆');

  const repeated = s.action().props.onClick();
  await repeated;
  assert.equal(s.writes.length, 1, 'A converted wish must not create a duplicate memory');
});

test('a first wishes read failure does not render an empty-state action', () => {
  const s = setup([]);
  s.hasLoaded.value = false;
  const rendered = nodes(s.render());
  assert.equal(
    rendered.some((node) => node.props?.action === '写下第一件事'),
    false,
    'A failed first read must not look like a brand-new empty list',
  );
});
