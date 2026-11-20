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
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
const existing = {
  id: 'baby-profile',
  name: '小团子',
  birthday: '2025-06-01',
  gender: 'girl',
  notes: '喜欢听睡前故事',
  avatarId: 'original-avatar',
};
function component(
  file: string,
  dependencies: Record<string, any> = {},
  props = {},
  emit = () => {},
) {
  const filename = fileURLToPath(new URL(file, import.meta.url));
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor;
  const script = compileScript(descriptor, { id: 'baby-profile-test' });
  function execute(source: string, deps = dependencies) {
    const module = { exports: {} as any };
    new Function(
      'require',
      'module',
      'exports',
      ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText,
    )(
      (name: string) => deps[name] || (name.endsWith('.vue') ? {} : require(name)),
      module,
      module.exports,
    );
    return module.exports;
  }
  const view = execute(script.content).default.setup(props, { expose() {}, emit });
  const template = compileTemplate({
    source: descriptor.template!.content,
    filename,
    id: 'baby-profile-test',
    compilerOptions: {
      isCustomElement: (tag) => tag !== 'el-alert',
      bindingMetadata: script.bindings,
    },
  });
  assert.deepEqual(template.errors, []);
  const context = proxyRefs({ ...view, $emit: emit });
  // Inspect real template VNodes and slots without mounting form directives or UI components.
  const render = execute(template.code, {
    vue: {
      ...require('vue'),
      resolveComponent: (name: string) => name,
      withCtx: (slot: any) => slot,
      withDirectives: (vnode: any) => vnode,
      renderSlot: () => null,
    },
  }).render;
  return { view, render: () => render(context, [], props, context) };
}
function setup(
  options: { recordId?: string; profileSource?: boolean; growth?: any[]; loading?: boolean } = {},
) {
  const writes: any[] = [];
  const errors: string[] = [];
  const growthLoading = ref(options.loading || false);
  const growthError = ref('');
  let mounted!: () => Promise<void>;
  let reads = 0;
  const api = {
    get: async (path: string): Promise<any> => {
      if (path === '/assets') return [];
      reads++;
      return structuredClone(existing);
    },
    put: async (path: string, body: any) => {
      writes.push({ path, body: structuredClone(body) });
      return { id: existing.id, ...structuredClone(body) };
    },
  };
  const page = component(
    '../src/pages/BabyPage.vue',
    {
      vue: {
        ...require('vue'),
        onMounted(callback: typeof mounted) {
          mounted = callback;
        },
      },
      '../api': { api, assetUrl: () => '' },
      '../domain': domain,
      '../composables/record-focus': { useRecordFocus: () => () => {} },
      '../composables/resource': {
        useResource: () => ({
          items: ref(options.growth || []),
          loading: growthLoading,
          error: growthError,
          saving: ref(false),
          load() {},
          save() {},
          remove() {},
        }),
      },
      'element-plus': {
        ElMessage: {
          success() {},
          warning() {},
          error(message: string) {
            errors.push(message);
          },
        },
      },
    },
    { recordId: options.recordId, profileSource: options.profileSource },
  );
  const rendered = () => nodes(page.render());
  const action = () =>
    rendered().find((node) => node.type === 'el-button' && node.props?.type === 'primary');
  const status = () =>
    rendered().find(
      (node) => node.type === 'LoadState' && node.props?.onRetry === page.view.loadBaby,
    );
  const saveButton = () =>
    rendered().find((node) => node.type === 'el-button' && node.children === '保存小档案');
  const submitProfile = async () => {
    const tree = rendered();
    const button = tree.find((node) => node.type === 'el-button' && node.children === '保存小档案');
    assert.equal(button?.props?.['native-type'], 'submit');
    const form = tree.find(
      (node) => node.type === 'el-form' && nodes(node).includes(button),
    );
    assert.equal(typeof form?.props?.onSubmit, 'function');
    await form.props.onSubmit({ preventDefault() {} });
  };
  return {
    ...page,
    api,
    writes,
    errors,
    rendered,
    growthLoading,
    growthError,
    action,
    status,
    saveButton,
    submitProfile,
    reads: () => reads,
    mount: () => mounted(),
  };
}

test('the source of a birthday opens the existing profile rather than a growth card or editor', async () => {
  const s = setup({
    recordId: existing.id,
    profileSource: true,
    growth: [{ id: 'growth-record', type: 'growth', date: '2026-11-20', title: '第一次坐稳' }],
  });
  await s.mount();
  assert.equal(
    s.rendered().find((node) => node.props?.['data-record-id'] === existing.id)?.type,
    'section',
  );
  assert.equal(
    s.rendered().some((node) => node.type === 'article'),
    false,
  );
  assert.equal(s.view.profileOpen.value, false);
});

test('the source of a growth event remains visible through an unrelated growth filter', async () => {
  const s = setup({
    recordId: 'growth-record',
    growth: [{ id: 'growth-record', type: 'growth', date: '2026-11-20', title: '第一次坐稳' }],
  });
  await s.mount();
  s.view.tab.value = 'feeding';
  assert.equal(
    s.rendered().find((node) => node.props?.['data-record-id'] === 'growth-record')?.type,
    'article',
  );
  assert.equal(
    s.rendered().some((node) => node.props?.['data-record-id'] === existing.id),
    false,
  );
  assert.equal(s.view.dialog.value, false);
});

test('a deleted growth source stays hidden until its read succeeds, then restores the regular growth list', async () => {
  const s = setup({
    recordId: 'deleted-growth-record',
    growth: [{ id: 'remaining-growth-record', type: 'growth', date: '2026-11-19', title: '第一次挥手' }],
    loading: true,
  });
  await s.mount();
  assert.equal(
    s.rendered().some((node) => node.props?.['data-record-id'] === 'remaining-growth-record'),
    false,
  );
  assert.equal(s.rendered().some((node) => node.type === 'CalendarSourceStatus'), false);

  s.growthLoading.value = false;
  const rendered = s.rendered();

  assert.equal(
    rendered.find((node) => node.type === 'CalendarSourceStatus')?.props.missing,
    true,
  );
  assert.equal(
    rendered.find((node) => node.props?.['data-record-id'] === 'remaining-growth-record')?.type,
    'article',
  );
  assert.ok(rendered.some((node) => node.type === 'GrowthChart'));
  assert.ok(rendered.some((node) => node.props?.class === 'baby-profile panel'));
  assert.ok(rendered.some((node) => node.props?.class === 'toolbar'));
  assert.ok(s.action(), 'The regular page action must return with the regular list');
});

test('a birthday source offers retry before treating a successfully read missing profile as deleted', async () => {
  const s = setup({ recordId: existing.id, profileSource: true });
  const sourceStatus = () => s.rendered().find((node) => node.type === 'CalendarSourceStatus');
  s.api.get = async () => {
    throw new Error('档案暂时无法读取');
  };
  await s.mount();
  assert.equal(s.status()?.props.error, '档案暂时无法读取');
  assert.equal(sourceStatus(), undefined);
  s.api.get = async () => null;
  await s.status()?.props.onRetry();
  assert.equal(sourceStatus()?.props.missing, true);
  assert.equal(sourceStatus()?.props.path, '/baby');
  assert.equal(
    s.rendered().some((node) => node.props?.class === 'panel baby-onboarding'),
    false,
  );
});

test('a different baby profile is hidden when the requested birthday source is absent', async () => {
  const s = setup({ recordId: 'old-profile', profileSource: true });
  await s.mount();
  assert.equal(
    s.rendered().find((node) => node.type === 'CalendarSourceStatus')?.props.missing,
    true,
  );
  assert.equal(
    s.rendered().some((node) => node.props?.['data-record-id'] === existing.id),
    false,
  );
});

test('a source marker without a record ID opens the regular growth page', async () => {
  const s = setup({ profileSource: true });
  await s.mount();
  assert.ok(s.rendered().some((node) => node.type === 'GrowthChart'));
  assert.equal(
    s.rendered().some((node) => node.type === 'CalendarSourceStatus'),
    false,
  );
});

test('a failed growth source keeps its retry without showing unrelated records or baby panels', async () => {
  const s = setup({
    recordId: 'growth-record',
    growth: [{ id: 'unrelated-growth-record', type: 'growth', date: '2026-11-20', title: '无关记录' }],
  });
  await s.mount();
  s.growthError.value = '成长记录暂时无法读取';
  const rendered = s.rendered();
  assert.equal(
    rendered.find((node) => node.type === 'LoadState')?.props.error,
    s.growthError.value,
  );
  assert.equal(
    typeof rendered.find((node) => node.type === 'LoadState')?.props.onRetry,
    'function',
  );
  assert.equal(
    rendered.some((node) => node.props?.['data-record-id'] === existing.id),
    false,
  );
  assert.equal(
    rendered.some((node) => node.props?.['data-record-id'] === 'unrelated-growth-record'),
    false,
  );
  assert.equal(
    rendered.some((node) => node.type === 'GrowthChart'),
    false,
  );
  assert.equal(
    rendered.some((node) => node.type === 'CalendarSourceStatus'),
    false,
  );
});

test('unknown baby profile disables creation and refuses saves while the first read is pending', async () => {
  const s = setup();
  const read = deferred<any>();
  s.api.get = async () => read.promise;
  const loading = s.mount();
  try {
    assert.equal(s.action().props.disabled, true, 'The real header action must be disabled');
    assert.equal(
      s.rendered().some((node) => node.props?.class === 'panel baby-onboarding'),
      false,
    );
    s.action().props.onClick();
    assert.equal(s.view.profileOpen.value, false);
    s.view.profile.name = '不能覆盖原档案';
    await s.view.saveProfile();
    assert.deepEqual(s.writes, []);
  } finally {
    read.resolve(existing);
    await loading;
  }
});

test('failed baby profile read shows a real error and retry without a create state or writable profile', async () => {
  const s = setup();
  s.api.get = async () => {
    throw new Error('宝宝档案暂时没有读到');
  };
  await s.mount();
  const status = s.status();
  assert.ok(status, 'The actual page must expose its profile loading state');
  const feedback = component('../src/components/LoadState.vue', {}, status.props);
  const visible = nodes(feedback.render());
  assert.ok(
    visible.some((node) => node.type === 'el-alert' && node.props.title === '宝宝档案暂时没有读到'),
  );
  assert.ok(visible.some((node) => node.type === 'el-button' && node.children === '重新连接'));
  assert.equal(s.action().props.disabled, true);
  assert.equal(
    s.rendered().some((node) => node.props?.class === 'panel baby-onboarding'),
    false,
  );
  s.view.editProfile();
  assert.equal(s.view.profileOpen.value, false);
  s.view.profile.name = '错误的新档案';
  await s.view.saveProfile();
  assert.deepEqual(s.writes, []);
});

test('a profile failure without a message still shows retry and never unlocks creation', async () => {
  const s = setup();
  s.api.get = async () => {
    throw new Error('');
  };
  await s.mount();
  assert.equal(s.status()?.props.error, '宝宝档案暂时无法读取，请重试');
  assert.equal(s.action().props.disabled, true);
  s.view.editProfile();
  assert.equal(s.view.profileOpen.value, false);
  s.view.profile.name = '不能当成新档案';
  await s.view.saveProfile();
  assert.deepEqual(s.writes, []);
});

test('retrying an existing baby profile retains every saved field when editing and saving', async () => {
  const s = setup();
  s.api.get = async () => {
    throw new Error('读取失败');
  };
  await s.mount();
  const status = s.status();
  assert.ok(status, 'The failed profile read must render a retry handler');
  s.api.get = async (path) => (path === '/assets' ? [] : structuredClone(existing));
  await status.props.onRetry();
  assert.equal(s.action().props.disabled, false);
  const edit = s.rendered().find((node) => node.props?.title === '编辑宝宝档案');
  assert.ok(edit);
  edit.props.onClick();
  assert.deepEqual(
    { ...s.view.profile },
    {
      name: existing.name,
      birthday: existing.birthday,
      gender: existing.gender,
      notes: existing.notes,
      avatarId: existing.avatarId,
    },
  );
  s.view.profile.name = '小团子的新名字';
  await s.submitProfile();
  assert.deepEqual(s.writes, [
    {
      path: '/baby',
      body: {
        name: '小团子的新名字',
        birthday: existing.birthday,
        gender: existing.gender,
        notes: existing.notes,
        avatarId: existing.avatarId,
      },
    },
  ]);
});

test('a successful null retry enables the actual empty state and normal profile creation', async () => {
  const s = setup();
  s.api.get = async () => {
    throw new Error('读取失败');
  };
  await s.mount();
  const status = s.status();
  assert.ok(status);
  s.api.get = async (path) => (path === '/assets' ? [] : null);
  await status.props.onRetry();
  assert.equal(s.action().props.disabled, false);
  const empty = s
    .rendered()
    .find((node) => node.type === 'EmptyState' && node.props.action === '创建宝宝档案');
  assert.ok(empty);
  empty.props.onAction();
  assert.equal(s.view.profileOpen.value, true);
  s.view.profile.name = '新的小家人';
  await s.submitProfile();
  assert.equal(s.writes.length, 1);
  assert.equal(s.writes[0].body.name, '新的小家人');
  assert.equal(s.view.baby.value.name, '新的小家人');
});

for (const outcome of ['empty', 'failure']) {
  test(`an old profile ${outcome} cannot overwrite a newer retry and subsequent save`, async () => {
    const s = setup();
    const old = deferred<any>();
    const latest = deferred<any>();
    let reads = 0;
    s.api.get = async (path) =>
      path === '/assets' ? [] : ++reads === 1 ? old.promise : latest.promise;
    const first = s.mount();
    const second = s.view.loadBaby();
    latest.resolve(existing);
    await second;
    s.view.editProfile();
    s.view.profile.name = '刚刚保存的档案';
    await s.view.saveProfile();
    if (outcome === 'empty') old.resolve(null);
    else old.reject(new Error('旧加载失败'));
    await first;
    assert.equal(s.view.baby.value?.name, '刚刚保存的档案');
    assert.equal(s.status()?.props.error, '');
    assert.equal(s.action().props.disabled, false);
    assert.deepEqual(s.errors, []);
  });
}

test('an open profile editor refuses saving while a newer profile read is pending', async () => {
  const s = setup();
  await s.mount();
  s.view.editProfile();
  s.view.profile.name = '等待档案读取';
  const read = deferred<any>();
  s.api.get = async () => read.promise;
  const loading = s.view.loadBaby();
  try {
    assert.equal(s.saveButton().props.disabled, true);
    assert.ok(
      s
        .rendered()
        .some(
          (node) =>
            node.type === 'el-form' && node.props?.model === s.view.profile && node.props.disabled,
        ),
    );
    await s.view.saveProfile();
    assert.deepEqual(s.writes, []);
  } finally {
    read.resolve(existing);
    await loading;
  }
});

test('profile retries do not start during avatar uploads or profile saves', async () => {
  const s = setup();
  await s.mount();
  const reads = s.reads();
  s.view.profileUploading.value = true;
  await s.view.loadBaby();
  assert.equal(s.reads(), reads, 'Uploading must not start a competing profile read');
  s.view.profileUploading.value = false;
  s.view.editProfile();
  const write = deferred<any>();
  const put = s.api.put;
  s.api.put = async (...args) => {
    await put(...args);
    return write.promise;
  };
  const saving = s.view.saveProfile();
  try {
    await s.view.loadBaby();
    assert.equal(s.reads(), reads, 'Saving must not start a competing profile read');
    await s.view.saveProfile();
    assert.equal(s.writes.length, 1);
  } finally {
    write.resolve(existing);
    await saving;
  }
});
