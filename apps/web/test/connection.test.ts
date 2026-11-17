import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse, compileScript } from '@vue/compiler-sfc';
import * as pinia from 'pinia';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const previous = 'https://old.example/api';
const candidate = 'https://new.example/api';
function setup() {
  const storage = new Map([
    ['little-world-api', previous],
    ['little-world-token', 'old-token'],
  ]);
  const requests: {
    path: string;
    resolve: (value: any) => void;
    reject: (error: Error) => void;
  }[] = [];
  const api = {
    TOKEN_KEY: 'little-world-token',
    getBase: () => storage.get('little-world-api'),
    api: {
      get(path: string) {
        return new Promise((resolve, reject) => requests.push({ path, resolve, reject }));
      },
      patch(path: string) {
        return new Promise((resolve, reject) => requests.push({ path, resolve, reject }));
      },
      post(path: string) {
        return new Promise((resolve, reject) => requests.push({ path, resolve, reject }));
      },
    },
    connectBase() {
      return new Promise((resolve, reject) => requests.push({ path: '/probe', resolve, reject }));
    },
  };
  const localStorage = {
    getItem: (key: string) => storage.get(key) || null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  };
  function execute(source: string, dependencies: Record<string, any>) {
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} as any };
    new Function('require', 'module', 'exports', 'localStorage', output)(
      (specifier: string) =>
        dependencies[specifier] || (specifier.endsWith('.vue') ? {} : require(specifier)),
      module,
      module.exports,
      localStorage,
    );
    return module.exports;
  }
  pinia.setActivePinia(pinia.createPinia());
  const store = execute(
    readFileSync(new URL('../src/stores/session.ts', import.meta.url), 'utf8'),
    {
      '../api': api,
      pinia,
    },
  ).useSession();
  const acceptNew = () => {
    storage.set('little-world-api', candidate);
    store.accept({
      token: 'new-token',
      user: { id: 'new-user', nickname: '新用户' },
      space: { id: 'new-space', name: '新空间' },
    });
  };
  function page(name: 'SettingsPage' | 'AuthPage') {
    const filename = fileURLToPath(new URL(`../src/pages/${name}.vue`, import.meta.url));
    const source = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, {
      id: 'connection-test',
    }).content;
    return execute(source, {
      '../api': api,
      '../stores/session': { useSession: () => store },
      '../domain': { today: () => '2026-11-17' },
      vue: { ...require('vue'), onMounted() {} },
      'vue-router': {
        useRouter: () => ({ replace: async () => {} }),
        useRoute: () => ({ query: {} }),
      },
      'element-plus': { ElMessage: { success() {}, error() {} }, ElMessageBox: {} },
    }).default.setup({}, { expose() {} });
  }
  return {
    store,
    storage,
    requests,
    acceptNew,
    settings: () => page('SettingsPage'),
    auth: () => page('AuthPage'),
  };
}

test('a late refresh cannot replace a session accepted from a different service', async () => {
  const s = setup();
  const pending = s.store.refresh();
  s.acceptNew();
  s.requests[0].resolve({ user: { id: 'old-user' }, space: { id: 'old-space' } });
  await pending;
  assert.equal(s.store.user.id, 'new-user');
  assert.equal(s.store.space.id, 'new-space');
});

test('a late hydration failure cannot remove the new service token', async () => {
  const s = setup();
  const pending = s.store.hydrate();
  s.acceptNew();
  s.requests[0].reject(new Error('old service unavailable'));
  await pending;
  assert.equal(s.storage.get('little-world-token'), 'new-token');
  assert.equal(s.store.user.id, 'new-user');
});

test('a late hydration success cannot restore an old account after clearing its session', async () => {
  const s = setup();
  const pending = s.store.hydrate();
  s.store.clear();
  s.requests[0].resolve({ user: { id: 'old-user' }, space: { id: 'old-space' } });
  await pending;
  assert.equal(s.store.user, null);
  assert.equal(s.store.space, null);
  assert.equal(s.store.ready, true);
});

test('a failed hydration completes after clearing its own expired token', async () => {
  const s = setup();
  const pending = s.store.hydrate();
  s.requests[0].reject(new Error('session expired'));
  await pending;
  assert.equal(s.storage.has('little-world-token'), false);
  assert.equal(s.store.ready, true);
});

test('settings cannot save a profile while a connection is being checked', async () => {
  const s = setup();
  const view = s.settings();
  view.endpoint.value = candidate;
  view.profile.nickname = '新昵称';
  const connecting = view.saveEndpoint();
  const editing = view.saveProfile();
  const count = s.requests.length;
  for (const request of s.requests) request.reject(new Error('test connection failed'));
  await Promise.all([connecting, editing]);
  assert.equal(count, 1);
});

test('auth cannot submit credentials while a new connection is pending', async () => {
  const s = setup();
  const view = s.auth();
  view.checking.value = false;
  view.formRef.value = { validate: async () => true };
  view.address.value = candidate;
  const connecting = view.saveAddress();
  const submitting = view.submit();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  const count = s.requests.length;
  for (const request of s.requests) request.reject(new Error('connection failed'));
  await Promise.all([connecting, submitting]);
  assert.equal(count, 1);
  assert.equal(s.requests[0].path, '/probe');
});

test('auth cannot change the connection while credentials are being submitted', async () => {
  const s = setup();
  const view = s.auth();
  view.checking.value = false;
  view.formRef.value = { validate: async () => true };
  const submitting = view.submit();
  for (let i = 0; i < 10; i++) await Promise.resolve();
  view.address.value = candidate;
  const connecting = view.saveAddress();
  const count = s.requests.length;
  for (const request of s.requests) request.reject(new Error('login failed'));
  await Promise.all([connecting, submitting]);
  assert.equal(count, 1);
  assert.equal(s.requests[0].path, '/auth/login');
});
