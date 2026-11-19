import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import { createRenderer, h, proxyRefs } from 'vue';
import * as pinia from 'pinia';
import ts from 'typescript';
import * as domain from '../src/lib/domain';
import * as transport from '../src/lib/transport';

const require = createRequire(import.meta.url);
const original = {
  user: { id: 'owner', username: 'owner', nickname: '原昵称', role: 'owner' },
  space: { id: 'space', name: '原空间', startDate: '2026-01-01', theme: 'sage' },
  partner: null,
};
const savedSpace = { name: '保存后的空间', startDate: '2026-02-03', theme: 'rose' };
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
async function drain() {
  for (let i = 0; i < 12; i++) await Promise.resolve();
}
function succeed(request: any, data = original) {
  assert.ok(request, 'The page must issue the expected real transport request');
  request.success({ statusCode: 200, data });
}
function fail(request: any, message: string) {
  assert.ok(request, 'The page must issue the expected real transport request');
  request.success({ statusCode: 500, data: { message } });
}

// Run the real settings SFC, Pinia store and transport; replace only platform APIs.
function setup(knownSession = true) {
  const storage = new Map([
    ['little-world-api', 'https://world.example/api'],
    ['little-world-token', 'owner-token'],
  ]);
  const requests: any[] = [],
    uploads: any[] = [],
    notices: string[] = [],
    navigation: string[] = [],
    events: string[] = [];
  let show!: () => Promise<void>;
  const uni = {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: string) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
    request(options: any) {
      requests.push({
        ...options,
        data: options.data === undefined ? undefined : JSON.parse(JSON.stringify(options.data)),
      });
    },
    uploadFile(options: any) {
      uploads.push(options);
    },
    showToast: (options: any) => notices.push(options.title),
    reLaunch: (options: any) => navigation.push(options.url),
    switchTab: (options: any) => navigation.push(options.url),
    $emit: (event: string) => events.push(event),
  };
  function execute(source: string, dependencies: Record<string, any>) {
    const output = ts.transpileModule(source, {
      compilerOptions: {
        module: ts.ModuleKind.CommonJS,
        target: ts.ScriptTarget.ES2022,
        esModuleInterop: true,
      },
    }).outputText;
    const module = { exports: {} as any };
    new Function('require', 'module', 'exports', 'uni', output)(
      (specifier: string) => {
        if (specifier in dependencies) return dependencies[specifier];
        if (specifier.endsWith('.vue')) return {};
        return require(specifier);
      },
      module,
      module.exports,
      uni,
    );
    return module.exports;
  }
  const api = execute(
    readFileSync(new URL('../src/lib/api.ts', import.meta.url), 'utf8').replace(
      'import.meta.env.VITE_API_BASE',
      "''",
    ),
    { './domain': domain, './transport': transport },
  );
  pinia.setActivePinia(pinia.createPinia());
  const store = execute(
    readFileSync(new URL('../src/stores/session.ts', import.meta.url), 'utf8'),
    { '../lib/api': api, pinia },
  ).useSession();
  if (knownSession) Object.assign(store, structuredClone(original), { loaded: true });
  const filename = fileURLToPath(new URL('../src/pages/settings/index.vue', import.meta.url));
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor;
  const script = compileScript(descriptor, { id: 'settings-draft-test' });
  const component = execute(script.content, {
    '@dcloudio/uni-app': { onShow: (callback: typeof show) => (show = callback) },
    '../../lib/api': api,
    '../../lib/domain': domain,
    '../../stores/session': { useSession: () => store },
  }).default;
  const view = component.setup({}, { expose() {} });
  const template = compileTemplate({
    source: descriptor.template!.content,
    filename,
    id: 'settings-draft-test',
    compilerOptions: { isCustomElement: () => true, bindingMetadata: script.bindings },
  });
  assert.deepEqual(template.errors, []);
  const render = execute(template.code, {}).render;
  const context = proxyRefs(view);
  return {
    view,
    store,
    api,
    requests,
    uploads,
    notices,
    navigation,
    events,
    show: () => show(),
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
  };
}
async function load(s: ReturnType<typeof setup>, data = original) {
  const pending = s.show();
  succeed(s.requests.at(-1), data);
  await pending;
}
function field(s: ReturnType<typeof setup>, label: string) {
  const result = nodes(s.render()).find((node) => node.props?.label === label);
  assert.ok(result, `The real settings template must contain ${label}`);
  return result;
}
function button(s: ReturnType<typeof setup>, label: string) {
  const result = nodes(s.render()).find((node) => node.props?.onClick && textOf(node) === label);
  assert.ok(result, `The real settings template must expose ${label}`);
  return result;
}

test('settings fills an unknown session before enabling edits or saving default space fields', async () => {
  const s = setup(false);
  assert.equal(field(s, '小世界的名字').props.disabled, true);
  await s.view.saveSpace();
  assert.equal(s.requests.length, 0);
  await load(s);
  assert.equal(s.view.nickname.value, original.user.nickname);
  assert.deepEqual(
    { ...s.view.space },
    {
      name: original.space.name,
      startDate: original.space.startDate,
      theme: original.space.theme,
    },
  );
  assert.equal(field(s, '小世界的名字').props.disabled, false);
});

test('a failed first read remains disabled and offers an on-page retry without empty defaults', async () => {
  const s = setup(false);
  const first = s.show();
  fail(s.requests[0], '暂时读不到设置');
  await first;
  assert.equal(field(s, '怎么称呼我').props.disabled, true);
  const retry = button(s, '重新读取设置').props.onClick();
  succeed(s.requests[1]);
  await retry;
  assert.equal(s.view.nickname.value, original.user.nickname);
  assert.equal(s.view.space.theme, 'sage');
  assert.equal(field(s, '怎么称呼我').props.disabled, false);
  assert.equal(s.view.error.value, '');
});

test('a slow initial onShow preserves pure edits made from the known session', async () => {
  const s = setup();
  assert.equal(s.view.nickname.value, original.user.nickname);
  const first = s.show();
  s.view.nickname.value = '正在写的昵称';
  Object.assign(s.view.space, savedSpace);
  succeed(s.requests[0]);
  await first;
  assert.equal(s.view.nickname.value, '正在写的昵称');
  assert.deepEqual({ ...s.view.space }, savedSpace);
});

test('late initial data and later onShow keep a failed nickname draft and its retry payload', async () => {
  const s = setup();
  const initial = s.show();
  s.view.nickname.value = '失败后要重试的昵称';
  const saving = s.view.saveProfile();
  fail(s.requests[1], '昵称暂时保存失败');
  await saving;
  succeed(s.requests[0]);
  await initial;
  await load(s);
  assert.equal(s.view.nickname.value, '失败后要重试的昵称');
  assert.equal(s.view.error.value, '昵称暂时保存失败');
  const retry = s.view.saveProfile();
  assert.deepEqual(s.requests[3].data, { nickname: '失败后要重试的昵称' });
  succeed(s.requests[3]);
  await drain();
  succeed(s.requests[4], {
    ...original,
    user: { ...original.user, nickname: '失败后要重试的昵称' },
  });
  await retry;
  assert.equal(s.view.error.value, '');
});

test('returning from a native picker keeps a failed space draft and retries all its fields', async () => {
  const s = setup();
  await load(s);
  Object.assign(s.view.space, savedSpace);
  const saving = s.view.saveSpace();
  fail(s.requests[1], '空间暂时保存失败');
  await saving;
  await load(s);
  assert.deepEqual({ ...s.view.space }, savedSpace);
  const retry = s.view.saveSpace();
  assert.deepEqual(s.requests[3].data, savedSpace);
  succeed(s.requests[3]);
  await drain();
  succeed(s.requests[4], { ...original, space: { ...original.space, ...savedSpace } });
  await retry;
  assert.deepEqual({ ...s.view.space }, savedSpace);
});

test('a clean form reads partner updates while an unrelated nickname draft stays intact', async () => {
  const s = setup();
  await load(s);
  s.view.nickname.value = '尚未保存的昵称';
  await load(s, { ...original, space: { ...original.space, ...savedSpace } });
  assert.equal(s.view.nickname.value, '尚未保存的昵称');
  assert.deepEqual({ ...s.view.space }, savedSpace);
  s.view.nickname.value = original.user.nickname;
  await load(s, { ...original, user: { ...original.user, nickname: '伙伴更新后的称呼' } });
  assert.equal(s.view.nickname.value, '伙伴更新后的称呼');
});

test('a successful save marks normalized nickname and space drafts clean for later partner updates', async () => {
  const s = setup();
  await load(s);
  s.view.nickname.value = '  保存后的昵称  ';
  const profile = s.view.saveProfile();
  assert.deepEqual(s.requests[1].data, { nickname: '保存后的昵称' });
  succeed(s.requests[1]);
  await drain();
  succeed(s.requests[2], { ...original, user: { ...original.user, nickname: '保存后的昵称' } });
  await profile;
  assert.equal(s.view.nickname.value, '保存后的昵称');
  Object.assign(s.view.space, savedSpace);
  const space = s.view.saveSpace();
  succeed(s.requests[3]);
  await drain();
  succeed(s.requests[4], {
    ...original,
    user: { ...original.user, nickname: '保存后的昵称' },
    space: { ...original.space, ...savedSpace },
  });
  await space;
  await load(s, {
    ...original,
    user: { ...original.user, nickname: '另一设备更新的昵称' },
    space: { ...original.space, name: '伙伴更新的空间', theme: 'cream' },
  });
  assert.equal(s.view.nickname.value, '另一设备更新的昵称');
  assert.equal(s.view.space.name, '伙伴更新的空间');
  assert.equal(s.view.space.theme, 'cream');
});

test('a committed PATCH followed by a refresh failure retains its values and can read newer data', async () => {
  const s = setup();
  await load(s);
  Object.assign(s.view.space, savedSpace);
  const saving = s.view.saveSpace();
  succeed(s.requests[1]);
  await drain();
  fail(s.requests[2], '保存后的读取暂时失败');
  await saving;
  assert.deepEqual({ ...s.view.space }, savedSpace);
  assert.equal(field(s, '小世界的名字').props.disabled, false);
  await load(s, { ...original, space: { ...original.space, ...savedSpace, name: '后续新资料' } });
  assert.equal(s.view.space.name, '后续新资料');
  assert.equal(s.view.space.theme, 'rose');
});

test('a pending save locks the actual fields and theme handler and skips onShow reads', async () => {
  const s = setup();
  await load(s);
  Object.assign(s.view.space, savedSpace);
  const saving = s.view.saveSpace();
  const count = s.requests.length;
  assert.equal(field(s, '怎么称呼我').props.disabled, true);
  assert.equal(field(s, '小世界的名字').props.disabled, true);
  assert.equal(field(s, '故事开始的那一天').props.disabled, true);
  button(s, '奶油手账').props.onClick();
  assert.equal(s.view.space.theme, 'rose');
  await s.show();
  assert.equal(s.requests.length, count, 'A foreground return must not race the pending PATCH');
  fail(s.requests[1], '保留这份空间草稿');
  await saving;
  assert.equal(field(s, '小世界的名字').props.disabled, false);
  assert.deepEqual({ ...s.view.space }, savedSpace);
  button(s, '奶油手账').props.onClick();
  assert.equal(s.view.space.theme, 'cream');
});

test('an older same-session read cannot roll back a saved space or its global theme', async () => {
  const s = setup();
  await load(s);
  const oldRead = s.store.load();
  Object.assign(s.view.space, savedSpace);
  const saving = s.view.saveSpace();
  succeed(s.requests[2]);
  await drain();
  succeed(s.requests[3], { ...original, space: { ...original.space, ...savedSpace } });
  await saving;
  succeed(s.requests[1]);
  assert.equal(await oldRead, false);
  assert.equal(s.store.space.name, savedSpace.name);
  assert.equal(s.store.theme, savedSpace.theme);
  assert.deepEqual({ ...s.view.space }, savedSpace);
  s.view.space.theme = 'cream';
  const nextSave = s.view.saveSpace();
  assert.equal(s.requests[4].data.name, savedSpace.name);
  fail(s.requests[4], '结束本次测试');
  await nextSave;
});

test('a stale same-session failure does not reject after a newer successful load', async () => {
  const s = setup();
  const oldRead = s.store.load();
  const newest = s.store.load();
  succeed(s.requests[1], { ...original, space: { ...original.space, ...savedSpace } });
  assert.equal(await newest, true);
  fail(s.requests[0], '迟到的旧读取失败');
  assert.equal(await oldRead, false);
  assert.equal(s.store.theme, 'rose');
});

test('an older same-session 401 cannot clear authentication after a newer successful load', async () => {
  const s = setup();
  const oldRead = s.store.load();
  const newest = s.store.load();
  succeed(s.requests[1], { ...original, space: { ...original.space, ...savedSpace } });
  assert.equal(await newest, true);
  s.requests[0].success({ statusCode: 401, data: { message: '迟到的读取认证错误' } });
  assert.equal(await oldRead, false);
  assert.equal(s.api.getToken(), 'owner-token');
  assert.deepEqual(s.navigation, []);
  assert.deepEqual(s.events, []);
  assert.equal(s.store.theme, 'rose');
});

test('the newest session 401 still clears authentication and returns to login', async () => {
  const s = setup();
  const newest = s.store.load();
  s.requests[0].success({ statusCode: 401, data: { message: '当前登录已过期' } });
  assert.equal(await newest, false);
  assert.equal(s.api.getToken(), '');
  assert.deepEqual(s.navigation, ['/pages/auth/index']);
  assert.deepEqual(s.events, ['session-expired']);
});

test('a post-login session 401 returns to auth without subsequently entering home', async () => {
  const s = setup(false);
  const authenticated = { ...original, token: 'login-token' };
  const signingIn = s.store.authenticate('login', {
    username: 'owner',
    password: 'private-password',
  });
  assert.equal(s.requests[0].url, 'https://world.example/api/auth/login');
  succeed(s.requests[0], authenticated);
  await drain();
  assert.equal(s.requests[1].url, 'https://world.example/api/auth/me');
  s.requests[1].success({ statusCode: 401, data: { message: '登录后的认证已失效' } });
  await signingIn;
  assert.equal(s.api.getToken(), '');
  assert.deepEqual(s.navigation, ['/pages/auth/index']);
  assert.deepEqual(s.events, ['session-expired']);
});

test('a superseded login session load cannot enter home after a newer load succeeds', async () => {
  const s = setup(false);
  const authenticated = { ...original, token: 'login-token' };
  const signingIn = s.store.authenticate('login', {
    username: 'owner',
    password: 'private-password',
  });
  succeed(s.requests[0], authenticated);
  await drain();
  const newest = s.store.load();
  succeed(s.requests[2], { ...original, space: { ...original.space, ...savedSpace } });
  assert.equal(await newest, true);
  succeed(s.requests[1]);
  await signingIn;
  assert.deepEqual(s.navigation, []);
  assert.equal(s.store.theme, 'rose');
  assert.equal(s.api.getToken(), 'login-token');
});

test('a current login session load still enters home after reading the session', async () => {
  const s = setup(false);
  const authenticated = { ...original, token: 'login-token' };
  const signingIn = s.store.authenticate('login', {
    username: 'owner',
    password: 'private-password',
  });
  succeed(s.requests[0], authenticated);
  await drain();
  succeed(s.requests[1]);
  await signingIn;
  assert.deepEqual(s.navigation, ['/pages/home/index']);
  assert.equal(s.store.loaded, true);
});

test('a current post-login session error still rejects without entering home', async () => {
  const s = setup(false);
  const authenticated = { ...original, token: 'login-token' };
  const signingIn = s.store.authenticate('login', {
    username: 'owner',
    password: 'private-password',
  });
  succeed(s.requests[0], authenticated);
  await drain();
  fail(s.requests[1], '当前登录资料读取失败');
  await assert.rejects(signingIn, /当前登录资料读取失败/);
  assert.deepEqual(s.navigation, []);
});

test('ordinary authenticated requests keep their existing 401 expiry behavior', async () => {
  const s = setup();
  const saving = s.api.request('/space', 'PATCH', savedSpace);
  s.requests[0].success({ statusCode: 401, data: { message: '保存时登录已过期' } });
  await assert.rejects(saving, /保存时登录已过期/);
  assert.equal(s.api.getToken(), '');
  assert.deepEqual(s.navigation, ['/pages/auth/index']);
  assert.deepEqual(s.events, ['session-expired']);
});

test('an authenticated photo upload 401 expires the current session and returns to login', async () => {
  const s = setup();
  const uploading = s.api.uploadFile('/tmp/photo.png');
  assert.equal(s.uploads[0].url, 'https://world.example/api/assets');
  assert.equal(s.uploads[0].header.Authorization, 'Bearer owner-token');
  s.uploads[0].success({ statusCode: 401, data: { message: '上传时登录已过期' } });
  await assert.rejects(uploading, /上传时登录已过期/);
  assert.equal(s.api.getToken(), '');
  assert.deepEqual(s.navigation, ['/pages/auth/index']);
  assert.deepEqual(s.events, ['session-expired']);
});

test('a late upload 401 from an old base or token cannot expire the current identity', async (t) => {
  for (const changed of ['base', 'token'] as const) {
    await t.test(changed, async () => {
      const s = setup();
      const uploading = s.api.uploadFile('/tmp/photo.png');
      if (changed === 'base') s.api.setBase('https://another-world.example/api');
      else s.api.setToken('new-owner-token');
      const currentToken = s.api.getToken();
      s.uploads[0].success({ statusCode: 401, data: { message: '旧上传身份认证失败' } });
      await assert.rejects(uploading, /旧上传身份认证失败/);
      assert.equal(s.api.getToken(), currentToken);
      assert.deepEqual(s.navigation, []);
      assert.deepEqual(s.events, []);
    });
  }
});

test('a session-read guard cannot suppress expiry for another resource', async () => {
  const s = setup();
  const saving = s.api.request('/space', 'PATCH', savedSpace, false, s.api.getBase(), () => false);
  s.requests[0].success({ statusCode: 401, data: { message: '空间保存认证失败' } });
  await assert.rejects(saving, /空间保存认证失败/);
  assert.equal(s.api.getToken(), '');
  assert.deepEqual(s.navigation, ['/pages/auth/index']);
  assert.deepEqual(s.events, ['session-expired']);
});

test('a 401 from a previous base or token cannot expire the current identity', async (t) => {
  for (const changed of ['base', 'token'] as const) {
    await t.test(changed, async () => {
      const s = setup();
      const oldRead = s.api.request('/auth/me');
      if (changed === 'base') s.api.setBase('https://another-world.example/api');
      else s.api.setToken('new-owner-token');
      const currentToken = s.api.getToken();
      s.requests[0].success({ statusCode: 401, data: { message: '旧身份读取认证失败' } });
      await assert.rejects(oldRead, /旧身份读取认证失败/);
      assert.equal(s.api.getToken(), currentToken);
      assert.deepEqual(s.navigation, []);
      assert.deepEqual(s.events, []);
    });
  }
});

test('an older onShow failure cannot replace a newer save error', async () => {
  const s = setup();
  const oldRead = s.show();
  s.view.nickname.value = '保留失败草稿';
  const saving = s.view.saveProfile();
  fail(s.requests[1], '当前昵称保存错误');
  await saving;
  fail(s.requests[0], '迟到的旧读取错误');
  await oldRead;
  assert.equal(s.view.error.value, '当前昵称保存错误');
  assert.equal(s.view.nickname.value, '保留失败草稿');
});

test('clearing a session makes its pending success and failure obsolete', async (t) => {
  for (const outcome of ['success', 'failure'] as const) {
    await t.test(outcome, async () => {
      const s = setup();
      const pending = s.store.load();
      s.store.clear();
      if (outcome === 'success') succeed(s.requests[0]);
      else fail(s.requests[0], '已经退出后的旧错误');
      assert.equal(await pending, false);
      assert.equal(s.store.user, null);
      assert.equal(s.store.space, null);
    });
  }
});
