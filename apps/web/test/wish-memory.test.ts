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

function setup(options: { kind?: string; records?: any[]; record?: string } = {}) {
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
    body: any;
    resolve: (value?: any) => void;
    reject: (error: Error) => void;
  }[] = [];
  const successes: string[] = [];
  const errors: string[] = [];
  const props = { kind: options.kind ?? 'wishes', recordId: options.record };
  const loading = ref(false);
  const error = ref('');
  const filename = fileURLToPath(new URL('../src/pages/ResourcePage.vue', import.meta.url));
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
      (name: string) => dependencies[name] || (name.endsWith('.vue') ? name : require(name)),
      module,
      module.exports,
    );
    return module.exports;
  }
  const view = evaluate(script.content, {
    '../api': {
      api: {
        post: (path: string, body: any) =>
          new Promise((resolve, reject) => writes.push({ path, body, resolve, reject })),
      },
      assetUrl: () => '',
    },
    '../domain': domain,
    '../stores/session': { useSession: () => ({ user: { id: 'owner' } }) },
    '../composables/record-focus': { useRecordFocus: () => () => {} },
    '../components/CalendarSourceStatus.vue': 'CalendarSourceStatus',
    '../composables/resource': {
      useResource: () => ({
        items: ref(options.records ?? [wish]),
        loading,
        error,
        saving: ref(false),
        load() {},
        save() {},
        remove() {},
      }),
    },
    'element-plus': {
      ElMessage: {
        success: (message: string) => successes.push(message),
        error: (message: string) => errors.push(message),
      },
    },
  }).default.setup(props, { expose() {} });
  const template = compileTemplate({
    source: descriptor.template!.content,
    filename,
    id: 'wish-memory-test',
    compilerOptions: {
      isCustomElement: (tag) => tag !== 'el-input',
      bindingMetadata: script.bindings,
    },
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
  const context = proxyRefs({ ...view, ...props });
  const rendered = () => nodes(render(context, [], props, context));
  function action() {
    const button = rendered().find(
      (node) => node.type === 'el-button' && textOf(node).includes('收藏为回忆'),
    );
    assert.ok(button, 'The real wish template must render the conversion action');
    return button;
  }
  return { wish, writes, successes, errors, action, rendered, loading, error, view };
}

test('a calendar link shows the chosen locked letter outside filters without opening its editor', () => {
  const s = setup({
    kind: 'letters',
    record: 'locked',
    records: [
      { id: 'open', title: '已经打开', isLocked: false, authorId: 'owner' },
      {
        id: 'locked',
        title: '给未来的我们',
        isLocked: true,
        authorId: 'partner',
        unlockDate: '2099-11-20',
        content: '受保护的正文',
      },
    ],
  });
  s.view.tab.value = 'open';
  s.view.query.value = '已经打开';
  const cards = s.rendered().filter((node) => node.type === 'article');
  assert.equal(cards.length, 1);
  assert.equal(cards[0].props['data-record-id'], 'locked');
  assert.match(textOf(cards[0]), /给未来的我们/);
  assert.match(textOf(cards[0]), /未到解锁日/);
  assert.doesNotMatch(textOf(cards[0]), /受保护的正文/);
  assert.equal(s.view.dialog.value, false);
});

test('a missing source warning waits for a successful list read', () => {
  const s = setup({ record: 'removed' });
  s.loading.value = true;
  const hasWarning = () =>
    s.rendered().some((node) => node.type === 'CalendarSourceStatus' && node.props.missing);
  assert.equal(hasWarning(), false);
  s.loading.value = false;
  s.error.value = '网络错误';
  assert.equal(hasWarning(), false);
  s.error.value = '';
  assert.equal(hasWarning(), true);
  assert.match(textOf(s.rendered().find((node) => node.type === 'article')), /一起看日落/);
});

test('a delayed Web wish conversion shows progress and a double click writes and notifies once', async () => {
  const s = setup();
  const action = s.action();
  const first = action.props.onClick();
  const repeated = action.props.onClick();
  try {
    assert.equal(s.writes.length, 1, 'Repeated clicks must share the pending conversion');
    assert.equal(
      s.action().props.loading,
      true,
      'The actual Element Plus action must show progress',
    );
    assert.equal(s.action().props.disabled, true);
    assert.deepEqual(s.successes, []);
  } finally {
    for (const write of s.writes) write.resolve({ id: 'memory-saved' });
    await Promise.all([first, repeated]);
  }
  assert.equal(s.writes[0].path, '/memories');
  assert.deepEqual(s.writes[0].body, {
    title: s.wish.title,
    content: s.wish.description,
    date: domain.today(),
    assetIds: [],
    tags: ['愿望实现'],
    kind: 'couple',
  });
  assert.deepEqual(s.successes, ['已把完成的愿望收藏为回忆']);
  assert.deepEqual(s.errors, []);
  assert.equal(s.action().props.loading, false);
  assert.equal(s.action().props.disabled, true);
  assert.equal(textOf(s.action()), '已收藏为回忆');
});

test('a failed Web wish conversion releases its action and a real retry succeeds once', async () => {
  const s = setup();
  const first = s.action().props.onClick();
  s.writes[0].reject(new Error('回忆暂时没有保存'));
  await first;
  assert.deepEqual(s.errors, ['回忆暂时没有保存']);
  assert.deepEqual(s.successes, []);
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
  assert.deepEqual(s.successes, ['已把完成的愿望收藏为回忆']);
  assert.equal(s.action().props.loading, false);
  assert.equal(s.action().props.disabled, true);
  assert.equal(textOf(s.action()), '已收藏为回忆');
});

test('a successful Web wish conversion disables the action and blocks a duplicate record', async () => {
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
