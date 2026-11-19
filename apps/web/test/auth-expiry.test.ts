import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse, compileScript } from '@vue/compiler-sfc';
import * as pinia from 'pinia';
import ts from 'typescript';

const require = createRequire(import.meta.url);
const account = {
  token: 'current-token',
  user: { id: 'owner', username: 'owner', nickname: '我', role: 'owner' },
  space: { id: 'home', name: '我们', startDate: '2026-01-01', theme: 'cream' },
};

function setup(t: any, fetch: typeof globalThis.fetch) {
  const storage = new Map<string, string>();
  const localStorage = {
    getItem: (key: string) => storage.get(key) || null,
    setItem: (key: string, value: string) => storage.set(key, value),
    removeItem: (key: string) => storage.delete(key),
  };
  const window = new EventTarget();
  const navigations: string[] = [];
  const successes: string[] = [];
  const warnings: string[] = [];
  const unmount: (() => void)[] = [];
  function execute(source: string, dependencies: Record<string, any>) {
    // Vite's build-time environment is absent from the Node test host.
    const output = ts.transpileModule(source.replaceAll('import.meta.env', '({})'), {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} as any };
    new Function(
      'require',
      'module',
      'exports',
      'localStorage',
      'window',
      'navigator',
      'fetch',
      output,
    )(
      (specifier: string) =>
        dependencies[specifier] || (specifier.endsWith('.vue') ? {} : require(specifier)),
      module,
      module.exports,
      localStorage,
      window,
      { onLine: true },
      fetch,
    );
    return module.exports;
  }
  const api = execute(readFileSync(new URL('../src/api.ts', import.meta.url), 'utf8'), {});
  pinia.setActivePinia(pinia.createPinia());
  const store = execute(
    readFileSync(new URL('../src/stores/session.ts', import.meta.url), 'utf8'),
    { '../api': api, pinia },
  ).useSession();
  function page(name: 'App' | 'AuthPage') {
    const filename = fileURLToPath(
      new URL(name === 'App' ? '../src/App.vue' : '../src/pages/AuthPage.vue', import.meta.url),
    );
    const source = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, {
      id: 'auth-expiry-test',
    }).content;
    return execute(source, {
      '../api': api,
      '../stores/session': { useSession: () => store },
      './stores/session': { useSession: () => store },
      '../domain': { today: () => '2026-11-19' },
      vue: {
        ...require('vue'),
        onMounted(callback: () => void) {
          if (name === 'App') callback();
        },
        onUnmounted(callback: () => void) {
          unmount.push(callback);
        },
      },
      'vue-router': {
        useRouter: () => ({ replace: async (path: string) => navigations.push(path) }),
        useRoute: () => ({ query: {} }),
      },
      'element-plus': {
        ElMessage: {
          success: (message: string) => successes.push(message),
          warning: (message: string) => warnings.push(message),
        },
      },
    }).default.setup({}, { expose() {} });
  }
  // Register the production listener that actually clears a rejected session.
  page('App');
  t.after(() => unmount.forEach((callback) => callback()));
  return {
    api,
    store,
    storage,
    navigations,
    successes,
    warnings,
    auth: () => page('AuthPage'),
  };
}

for (const mode of ['setup', 'join', 'login']) {
  test(`${mode} does not report success when its profile refresh returns 401`, async (t) => {
    const calls: string[] = [];
    const s = setup(t, async (url) => {
      calls.push(String(url));
      return String(url).endsWith(`/auth/${mode}`)
        ? Response.json(account)
        : Response.json({ message: '登录已过期，请重新登录' }, { status: 401 });
    });
    const view = s.auth();
    view.mode.value = mode;
    view.checking.value = false;
    view.formRef.value = { validate: async () => true };
    await view.submit();
    assert.deepEqual(calls, [`/api/auth/${mode}`, '/api/auth/me']);
    assert.equal(s.store.authenticated, false);
    assert.equal(s.storage.has('little-world-token'), false);
    assert.deepEqual(s.navigations, ['/auth']);
    assert.deepEqual(s.successes, []);
    assert.equal(s.warnings.length, 1);
    assert.equal(view.loading.value, false);
  });
}

test('a server error during profile enrichment retains the accepted login', async (t) => {
  const s = setup(t, async (url) =>
    String(url).endsWith('/auth/login')
      ? Response.json(account)
      : Response.json({ message: '服务暂时出错' }, { status: 500 }),
  );
  const view = s.auth();
  view.checking.value = false;
  view.formRef.value = { validate: async () => true };
  await view.submit();
  assert.equal(s.store.authenticated, true);
  assert.equal(s.storage.get('little-world-token'), account.token);
  assert.deepEqual(s.navigations, ['/']);
  assert.equal(s.successes.length, 1);
  assert.deepEqual(s.warnings, []);
});

for (const mode of ['setup', 'join', 'login']) {
  test(`a rejected ${mode} credential request does not expire an existing session`, async (t) => {
    const s = setup(t, async () => Response.json({ message: '凭据无效' }, { status: 401 }));
    s.store.accept(account);
    await assert.rejects(s.api.api.post(`/auth/${mode}`, {}), /凭据无效/);
    assert.equal(s.store.authenticated, true);
    assert.equal(s.storage.get('little-world-token'), account.token);
    assert.deepEqual(s.navigations, []);
    assert.deepEqual(s.warnings, []);
  });
}

for (const changed of ['base', 'token']) {
  test(`a late profile 401 cannot expire a session with a newer ${changed}`, async (t) => {
    let respond!: (response: Response) => void;
    const s = setup(t, () => new Promise<Response>((resolve) => (respond = resolve)));
    s.store.accept(account);
    const pending = s.store.refresh();
    if (changed === 'base') s.api.setBase('https://new.example/api');
    const replacement = { ...account, token: changed === 'token' ? 'new-token' : account.token };
    s.store.accept(replacement);
    respond(Response.json({ message: '旧会话过期' }, { status: 401 }));
    await assert.rejects(pending, /旧会话过期/);
    assert.equal(s.store.authenticated, true);
    assert.equal(s.storage.get('little-world-token'), replacement.token);
    assert.deepEqual(s.navigations, []);
    assert.deepEqual(s.warnings, []);
  });
}

for (const earlier of ['refresh', 'hydrate'] as const) {
  test(`an older ${earlier} 401 cannot expire the same session after its newer read succeeds`, async (t) => {
    const responses: ((response: Response) => void)[] = [];
    const s = setup(t, () => new Promise<Response>((resolve) => responses.push(resolve)));
    if (earlier === 'refresh') s.store.accept(account);
    else s.storage.set('little-world-token', account.token);
    const older = s.store[earlier]();
    const settled = older.then(
      (value: unknown) => ({ value }),
      (error: Error) => ({ error }),
    );
    const latest = s.store.refresh();
    responses[1](
      Response.json({
        user: { ...account.user, nickname: '新昵称' },
        space: { ...account.space, theme: 'rose' },
      }),
    );
    assert.equal(await latest, true);
    responses[0](Response.json({ message: '旧读取过期' }, { status: 401 }));
    assert.deepEqual(await settled, { value: earlier === 'refresh' ? false : undefined });
    assert.equal(s.store.user.nickname, '新昵称');
    assert.equal(s.store.space.theme, 'rose');
    assert.equal(s.store.ready, true);
    assert.equal(s.storage.get('little-world-token'), account.token);
    assert.deepEqual(s.navigations, []);
    assert.deepEqual(s.warnings, []);
  });
}

test('the newest profile 401 still expires the session and an older success cannot restore it', async (t) => {
  const responses: ((response: Response) => void)[] = [];
  const s = setup(t, () => new Promise<Response>((resolve) => responses.push(resolve)));
  s.store.accept(account);
  const older = s.store.refresh();
  const latest = s.store.refresh();
  const rejected = assert.rejects(latest, /当前登录过期/);
  responses[1](Response.json({ message: '当前登录过期' }, { status: 401 }));
  await rejected;
  responses[0](Response.json(account));
  assert.equal(await older, false);
  assert.equal(s.store.authenticated, false);
  assert.equal(s.storage.has('little-world-token'), false);
  assert.deepEqual(s.navigations, ['/auth']);
  assert.equal(s.warnings.length, 1);
});

test('a current protected-resource 401 still clears the session through App', async (t) => {
  const s = setup(t, async () => Response.json({ message: '登录过期' }, { status: 401 }));
  s.store.accept(account);
  await assert.rejects(s.api.api.get('/dashboard'), /登录过期/);
  assert.equal(s.store.authenticated, false);
  assert.equal(s.storage.has('little-world-token'), false);
  assert.deepEqual(s.navigations, ['/auth']);
  assert.equal(s.warnings.length, 1);
});

test('a profile read guard cannot silence a protected-resource 401', async (t) => {
  const s = setup(t, async () => Response.json({ message: '登录过期' }, { status: 401 }));
  s.store.accept(account);
  await assert.rejects(s.api.api.get('/dashboard', { canExpireSession: () => false }), /登录过期/);
  assert.equal(s.store.authenticated, false);
  assert.equal(s.storage.has('little-world-token'), false);
  assert.deepEqual(s.navigations, ['/auth']);
  assert.equal(s.warnings.length, 1);
});
