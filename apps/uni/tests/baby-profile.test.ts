import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import { createRenderer, h, proxyRefs } from 'vue';
import ts from 'typescript';
import * as domain from '../src/lib/domain';
import type { Baby } from '../src/types';

const require = createRequire(import.meta.url);
const existing: Baby = {
  id: 'baby-existing',
  name: '原来的宝宝',
  birthday: '2025-03-04',
  gender: 'girl',
  notes: '已经保存的家庭备注',
  avatarId: 'avatar-existing',
  asset: { id: 'avatar-existing', url: '/api/assets/avatar-existing/file' },
};
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function drain() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
const nodes = (node: any): any[] =>
  Array.isArray(node)
    ? node.flatMap(nodes)
    : node && typeof node === 'object'
      ? [node, ...nodes(node.children)]
      : [];
const textOf = (node: any): string =>
  Array.isArray(node)
    ? node.map(textOf).join('')
    : node && typeof node === 'object'
      ? textOf(node.children)
      : typeof node === 'string'
        ? node
        : '';
const renderer = createRenderer<any, any>({
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  setText() {},
  setElementText() {},
  patchProp() {},
  insert() {},
  remove() {},
  parentNode: () => null,
  nextSibling: () => null,
});

// Compile the real page and resource composable. Only platform hooks and network I/O are replaced.
function setup(initial: Baby | null = existing) {
  let stored = structuredClone(initial);
  const requests: { path: string; method: string; data?: any }[] = [];
  const notices: string[] = [];
  const shows: (() => Promise<void>)[] = [];
  const session = { theme: 'cream', user: { id: 'owner' }, load: async () => true };
  const api = {
    readBaby: async (): Promise<Baby | null> => structuredClone(stored),
    putBaby: async (data: any): Promise<Baby> => {
      stored = { ...structuredClone(existing), ...structuredClone(data) };
      return structuredClone(stored);
    },
    async request(path: string, method = 'GET', data?: any) {
      requests.push({ path, method, data: data === undefined ? undefined : structuredClone(data) });
      if (path === '/baby') return method === 'GET' ? api.readBaby() : api.putBaby(data);
      return method === 'GET' ? [] : { id: 'growth-saved', ...data };
    },
    notify(message: string) {
      notices.push(message);
    },
    confirm: async () => true,
    assetUrl: (asset: any) => asset.url,
    previewPhotos() {},
  };
  const platform = {
    onShow(callback: () => Promise<void>) {
      shows.push(callback);
    },
    onPullDownRefresh() {},
    onResize() {},
  };
  const evaluate = (source: string, dependencies: Record<string, unknown>) => {
    const module = { exports: {} as any };
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function('require', 'module', 'exports', 'uni', output)(
      (specifier: string) =>
        dependencies[specifier] || (specifier.endsWith('.vue') ? {} : require(specifier)),
      module,
      module.exports,
      { stopPullDownRefresh() {} },
    );
    return module.exports;
  };
  const resource = evaluate(
    readFileSync(new URL('../src/lib/useResource.ts', import.meta.url), 'utf8'),
    {
      '@dcloudio/uni-app': platform,
      './api': api,
      '../stores/session': { useSession: () => session },
    },
  );
  const filename = fileURLToPath(new URL('../src/pages/baby/index.vue', import.meta.url));
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor;
  const script = compileScript(descriptor, { id: 'baby-profile-test' });
  const page = evaluate(script.content, {
    '@dcloudio/uni-app': platform,
    '../../lib/useResource': resource,
    '../../lib/api': api,
    '../../lib/domain': domain,
  });
  const view = page.default.setup({}, { expose() {} });
  const template = compileTemplate({
    source: descriptor.template!.content,
    filename,
    id: 'baby-profile-test',
    compilerOptions: { isCustomElement: () => true, bindingMetadata: script.bindings },
  });
  assert.deepEqual(template.errors, []);
  const render = evaluate(template.code, {}).render;
  const context = proxyRefs(view);
  return {
    view,
    api,
    requests,
    notices,
    show: () => Promise.all(shows.map((show) => show())),
    render() {
      let rendered: any;
      const root = {};
      renderer.render(
        h({
          render() {
            rendered = render(context, [], {}, context);
            return null;
          },
        }),
        root,
      );
      renderer.render(null, root);
      return rendered;
    },
    writes: () =>
      requests.filter((request) => request.path === '/baby' && request.method === 'PUT'),
    reads: () => requests.filter((request) => request.path === '/baby' && request.method === 'GET'),
  };
}
function creationIsVisible(s: ReturnType<typeof setup>) {
  return nodes(s.render()).some((node) => node.props?.action === '建立宝宝档案');
}
function retry(s: ReturnType<typeof setup>) {
  const button = nodes(s.render()).find(
    (node) => node.props?.onClick && textOf(node) === '重试宝宝档案',
  );
  assert.ok(button, 'A failed profile read must provide a visible retry action');
  return button.props.onClick();
}

test('an unknown baby profile cannot display creation or open and save an empty editor', async () => {
  const s = setup();
  assert.equal(creationIsVisible(s), false, 'An unread profile is not evidence that none exists');
  s.view.editBaby();
  assert.equal(s.view.profileEditor.value, false);
  s.view.profile.name = '不能覆盖原档案';
  await s.view.saveBaby();
  assert.equal(s.writes().length, 0);
});

test('a failed baby read stays distinct from no profile and keeps growth recording available', async () => {
  const s = setup();
  s.api.readBaby = async () => {
    throw new Error('宝宝档案暂时无法读取');
  };
  await s.show();
  assert.ok(textOf(s.render()).includes('宝宝档案暂时无法读取'));
  assert.equal(creationIsVisible(s), false);
  s.view.editBaby();
  s.view.profile.name = '不能覆盖原档案';
  await s.view.saveBaby();
  assert.equal(s.view.profileEditor.value, false);
  assert.equal(s.writes().length, 0);
  s.view.openNew();
  assert.equal(s.view.editor.value, true, 'A profile failure must not disable the growth editor');
  assert.ok(s.requests.some((request) => request.path === '/growth'));
});

test('an unreadable profile failure always keeps a visible message and a working retry action', async (t) => {
  for (const [label, reason] of [
    ['an empty Error', new Error()],
    ['an unknown thrown value', 'network interrupted'],
    ['a null thrown value', null],
  ] as const) {
    await t.test(label, async () => {
      const s = setup();
      s.api.readBaby = async () => {
        throw reason;
      };
      await s.show();
      assert.ok(textOf(s.render()).includes('宝宝档案读取失败，请重试'));
      assert.equal(creationIsVisible(s), false);
      s.view.editBaby();
      s.view.profile.name = '不能覆盖原档案';
      await s.view.saveBaby();
      assert.equal(s.view.profileEditor.value, false);
      assert.equal(s.writes().length, 0);
      s.api.readBaby = async () => structuredClone(existing);
      await retry(s);
      assert.ok(textOf(s.render()).includes(existing.name));
    });
  }
});

test('retrying an existing profile preserves all saved fields and its avatar on the next save', async () => {
  const s = setup();
  s.api.readBaby = async () => {
    throw new Error('请重试宝宝档案');
  };
  await s.show();
  s.api.readBaby = async () => structuredClone(existing);
  await retry(s);
  s.view.editBaby();
  assert.equal(s.view.profileEditor.value, true);
  assert.deepEqual(s.view.profile, {
    name: existing.name,
    birthday: existing.birthday,
    gender: existing.gender,
    notes: existing.notes,
    avatarId: existing.avatarId,
  });
  assert.deepEqual(s.view.profilePhotos.value, [existing.asset]);
  s.view.profile.name = '只修改名字';
  await s.view.saveBaby();
  assert.deepEqual(
    s.writes().map((request) => request.data),
    [
      {
        name: '只修改名字',
        birthday: existing.birthday,
        gender: existing.gender,
        notes: existing.notes,
        avatarId: existing.avatarId,
      },
    ],
  );
});

test('retrying a confirmed null profile permits normal creation', async () => {
  const s = setup(null);
  s.api.readBaby = async () => {
    throw new Error('档案读取失败');
  };
  await s.show();
  s.api.readBaby = async () => null;
  await retry(s);
  assert.equal(creationIsVisible(s), true);
  s.view.editBaby();
  assert.equal(s.view.profileEditor.value, true);
  Object.assign(s.view.profile, { name: '新宝宝', notes: '新建的档案' });
  await s.view.saveBaby();
  assert.deepEqual(
    s.writes().map((request) => request.data),
    [
      {
        name: '新宝宝',
        birthday: null,
        gender: 'unknown',
        notes: '新建的档案',
        avatarId: null,
      },
    ],
  );
});

test('a late earlier onShow read cannot replace a newer existing profile with an empty state', async () => {
  const s = setup();
  const older = deferred<Baby | null>();
  const newer = deferred<Baby | null>();
  let reads = 0;
  s.api.readBaby = () => (++reads === 1 ? older.promise : newer.promise);
  const first = s.show();
  const second = s.show();
  newer.resolve(structuredClone(existing));
  await second;
  older.resolve(null);
  await first;
  assert.equal(creationIsVisible(s), false);
  s.view.editBaby();
  assert.equal(s.view.profile.birthday, existing.birthday);
  assert.deepEqual(s.view.profilePhotos.value, [existing.asset]);
});

test('returning from a profile editor or a pending save cannot reload over its known profile', async () => {
  const s = setup();
  await s.show();
  s.view.editBaby();
  s.view.profile.name = '保存中的新名字';
  const readsBefore = s.reads().length;
  await s.show();
  assert.equal(
    s.reads().length,
    readsBefore,
    'Returning from a photo chooser must preserve the profile draft',
  );
  const saved = deferred<Baby>();
  s.api.putBaby = () => saved.promise;
  const writing = s.view.saveBaby();
  await drain();
  await s.show();
  assert.equal(s.reads().length, readsBefore, 'onShow must not race the profile PUT');
  assert.equal(s.view.profileSaving.value, true);
  saved.resolve({ ...structuredClone(existing), name: '保存中的新名字' });
  await writing;
  assert.equal(s.view.baby.value.name, '保存中的新名字');
  assert.equal(s.view.profileEditor.value, false);
  assert.equal(s.view.profileSaving.value, false);
});
