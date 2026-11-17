import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse, compileScript } from '@vue/compiler-sfc';
import * as pinia from 'pinia';
import ts from 'typescript';
import * as domain from '../src/lib/domain';
import * as transport from '../src/lib/transport';

const require = createRequire(import.meta.url);
const previous = 'https://old.example/api';
const candidate = 'https://new.example/api';

// Execute the real page scripts, transport and Pinia store; replace only platform APIs.
function setup(page: 'auth' | 'settings') {
  const storage = new Map([
    ['little-world-api', previous],
    ['little-world-token', 'old-token'],
  ]);
  const requests: any[] = [],
    navigation: string[] = [],
    notices: string[] = [],
    hooks: Record<string, Function> = {};
  const uni = {
    getStorageSync: (key: string) => storage.get(key),
    setStorageSync: (key: string, value: string) => storage.set(key, value),
    removeStorageSync: (key: string) => storage.delete(key),
    request: (options: any) => requests.push(options),
    showToast: (options: any) => notices.push(options.title),
    reLaunch: (options: any) => navigation.push(options.url),
    switchTab: (options: any) => navigation.push(options.url),
    $emit() {},
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
  store.user = { id: 'old-owner', username: 'old-user', nickname: '旧用户', role: 'owner' };
  store.space = { id: 'old-space', name: '旧空间', theme: 'cream', startDate: '2026-01-01' };
  store.loaded = true;
  const filename = fileURLToPath(new URL(`../src/pages/${page}/index.vue`, import.meta.url));
  const source = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, {
    id: 'connection-test',
  }).content;
  const component = execute(source, {
    '@dcloudio/uni-app': {
      onLoad: (hook: Function) => (hooks.load = hook),
      onShow: (hook: Function) => (hooks.show = hook),
    },
    '../../lib/api': api,
    '../../lib/domain': domain,
    '../../stores/session': { useSession: () => store },
  }).default;
  const view = component.setup({}, { expose() {} });
  return { api, store, view, storage, requests, navigation, notices, hooks };
}

for (const page of ['auth', 'settings'] as const) {
  const connect = (view: any) => (page === 'auth' ? view.saveBase() : view.saveServer());
  test(`${page} validates a candidate anonymously before replacing the working address`, async () => {
    const s = setup(page);
    s.view.apiBase.value = candidate;
    const pending = connect(s.view);
    assert.equal(s.requests[0].url, `${candidate}/auth/status`);
    assert.equal(s.requests[0].header.Authorization, undefined);
    const duringProbe = s.storage.get('little-world-api');
    s.requests[0].fail();
    await pending;
    assert.equal(duringProbe, previous);
    assert.equal(s.storage.get('little-world-api'), previous);
    assert.equal(s.storage.get('little-world-token'), 'old-token');
    assert.equal(s.store.user.nickname, '旧用户');
  });

  test(`${page} rejects an unrelated JSON service without changing the connection`, async () => {
    const s = setup(page);
    s.view.apiBase.value = candidate;
    const pending = connect(s.view);
    s.requests[0].success({ statusCode: 200, data: {} });
    await pending;
    assert.equal(s.storage.get('little-world-api'), previous);
    assert.match(s.view.error.value, /服务地址/);
    assert.equal(s.notices.includes('服务地址已保存'), false);
  });

  test(`${page} ignores a second connection attempt while the first one is pending`, async () => {
    const s = setup(page);
    s.view.apiBase.value = candidate;
    const first = connect(s.view);
    s.view.apiBase.value = 'https://third.example/api';
    const second = connect(s.view);
    const count = s.requests.length;
    for (const request of s.requests)
      request.success({ statusCode: 200, data: { initialized: true } });
    await Promise.all([first, second]);
    assert.equal(count, 1);
    assert.equal(s.storage.get('little-world-api'), candidate);
  });
}

test('settings clears the old session and returns to login after connecting to a new service', async () => {
  const s = setup('settings');
  s.view.apiBase.value = candidate;
  const pending = s.view.saveServer();
  s.requests[0].success({ statusCode: 200, data: { initialized: true } });
  await pending;
  assert.equal(s.storage.get('little-world-api'), candidate);
  assert.equal(s.storage.has('little-world-token'), false);
  assert.equal(s.store.user, null);
  assert.equal(s.store.space, null);
  assert.deepEqual(s.navigation, ['/pages/auth/index']);
});

test('auth clears a retained session after connecting to a new service', async () => {
  const s = setup('auth');
  s.view.apiBase.value = candidate;
  const pending = s.view.saveBase();
  s.requests[0].success({ statusCode: 200, data: { initialized: false } });
  await pending;
  assert.equal(s.storage.has('little-world-token'), false);
  assert.equal(s.store.user, null);
  assert.equal(s.store.space, null);
  assert.equal(s.view.mode.value, 'setup');
});

test('checking the current address keeps the existing session', async () => {
  const s = setup('settings');
  const pending = s.view.saveServer();
  s.requests[0].success({ statusCode: 200, data: { initialized: true } });
  await pending;
  assert.equal(s.storage.get('little-world-token'), 'old-token');
  assert.equal(s.store.user.nickname, '旧用户');
  assert.deepEqual(s.navigation, []);
});

test('auth does not leave a pending connection check when an earlier session load finishes', async () => {
  const s = setup('auth');
  const loading = s.hooks.load();
  s.view.apiBase.value = candidate;
  const connecting = s.view.saveBase();
  s.requests[0].success({
    statusCode: 200,
    data: { user: { id: 'old-user' }, space: { id: 'old-space' } },
  });
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const navigation = [...s.navigation];
  s.requests[1].success({ statusCode: 200, data: { initialized: false } });
  for (const request of s.requests.slice(2))
    request.success({ statusCode: 200, data: { initialized: true } });
  await Promise.all([loading, connecting]);
  assert.deepEqual(navigation, []);
  assert.equal(s.storage.get('little-world-api'), candidate);
  assert.equal(s.view.mode.value, 'setup');
});

test('an old status result cannot replace a newer check of the same address', async () => {
  const s = setup('auth');
  const oldCheck = s.view.check();
  const connecting = s.view.saveBase();
  s.requests[1].success({ statusCode: 200, data: { initialized: true } });
  await connecting;
  s.requests[0].success({ statusCode: 200, data: { initialized: false } });
  await oldCheck;
  assert.equal(s.view.mode.value, 'login');
  assert.equal(s.view.initialized.value, true);
  assert.equal(s.view.error.value, '');
});

test('an old status error cannot replace a successful recheck of the same address', async () => {
  const s = setup('auth');
  const oldCheck = s.view.check();
  const connecting = s.view.saveBase();
  s.requests[1].success({ statusCode: 200, data: { initialized: true } });
  await connecting;
  s.requests[0].fail();
  await oldCheck;
  assert.equal(s.view.error.value, '');
  assert.equal(s.view.showServer.value, false);
});

test('an old login-page session load cannot navigate after a newer check of the same address', async () => {
  const s = setup('auth');
  const loading = s.hooks.load();
  const connecting = s.view.saveBase();
  s.requests[1].success({ statusCode: 200, data: { initialized: true } });
  await connecting;
  s.requests[0].success({
    statusCode: 200,
    data: { user: { id: 'old-user' }, space: { id: 'old-space' } },
  });
  await loading;
  assert.deepEqual(s.navigation, []);
  assert.equal(s.view.mode.value, 'login');
});

test('settings cannot save a profile while a connection is being checked', async () => {
  const s = setup('settings');
  s.view.apiBase.value = candidate;
  const pending = s.view.saveServer();
  s.view.nickname.value = '新昵称';
  const editing = s.view.saveProfile();
  const count = s.requests.length;
  for (const request of s.requests) request.fail();
  await Promise.all([pending, editing]);
  assert.equal(count, 1);
});

test('auth cannot submit credentials while a connection is being checked', async () => {
  const s = setup('auth');
  s.view.apiBase.value = candidate;
  const pending = s.view.saveBase();
  s.view.form.username = 'new-user';
  s.view.form.password = 'private-test-123';
  const loggingIn = s.view.submit();
  const count = s.requests.length;
  for (const request of s.requests) request.fail();
  await Promise.all([pending, loggingIn]);
  assert.equal(count, 1);
});

test('a late 401 from the old service cannot clear the new session', async () => {
  const s = setup('auth');
  const oldRequest = s.api.request('/auth/me');
  s.api.setBase(candidate);
  s.api.setToken('new-token');
  s.requests[0].success({ statusCode: 401, data: { message: '旧登录失效' } });
  await assert.rejects(oldRequest, /旧登录失效/);
  assert.equal(s.storage.get('little-world-token'), 'new-token');
  assert.deepEqual(s.navigation, []);
});

test('a late session response from the old service cannot overwrite new session state', async () => {
  const s = setup('auth');
  const oldLoad = s.store.load();
  s.api.setBase(candidate);
  s.api.setToken('new-token');
  s.store.user = { id: 'new-user', nickname: '新用户', role: 'owner' };
  s.store.space = { id: 'new-space', name: '新空间' };
  s.requests[0].success({
    statusCode: 200,
    data: { user: { id: 'stale-user', nickname: '晚到的旧用户' }, space: { id: 'old-space' } },
  });
  assert.equal(await oldLoad, false);
  assert.equal(s.store.user.nickname, '新用户');
  assert.equal(s.store.space.id, 'new-space');
});
