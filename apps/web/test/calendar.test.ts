import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse, compileScript } from '@vue/compiler-sfc';
import ts from 'typescript';

const require = createRequire(import.meta.url);

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

function setup() {
  const reads: ReturnType<typeof deferred<any>>[] = [];
  const filename = fileURLToPath(new URL('../src/pages/CalendarPage.vue', import.meta.url));
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor;
  const script = compileScript(descriptor, { id: 'calendar-test' });
  const output = ts.transpileModule(script.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as any };
  const dependencies = {
    '../api': {
      api: {
        get: async () => {
          const read = deferred<any>();
          reads.push(read);
          return read.promise;
        },
      },
    },
    '../domain': { monthNow: () => '2026-11' },
    vue: { ...require('vue'), onMounted() {} },
  };
  new Function('require', 'module', 'exports', output)(
    (specifier: string) => dependencies[specifier] || (specifier.endsWith('.vue') ? {} : require(specifier)),
    module,
    module.exports,
  );
  return { view: module.exports.default.setup({}, { expose() {} }), reads };
}

test('a stale calendar response cannot replace a newer successful load', async () => {
  const s = setup();
  const older = s.view.load();
  const newer = s.view.load();
  assert.equal(s.reads.length, 2);
  const latest = { month: '2026-11', date: '2026-11-20', events: [{ id: 'latest', sourceId: 'wish-1', kind: 'wish', date: '2026-11-20', title: '最新事件' }] };
  s.reads[1].resolve(latest);
  await newer;
  s.reads[0].reject(new Error('旧请求失败'));
  await older;
  assert.deepEqual(s.view.data.value, latest);
  assert.equal(s.view.error.value, '');
  assert.equal(s.view.loading.value, false);
});

test('calendar keeps the latest loading state while an older request is pending', async () => {
  const s = setup();
  const older = s.view.load();
  const newer = s.view.load();
  const latest = { month: '2026-11', date: '2026-11-20', events: [] };
  s.reads[0].resolve({ month: '2026-10', date: '2026-10-31', events: [] });
  await older;
  assert.equal(s.view.loading.value, true);
  s.reads[1].resolve(latest);
  await newer;
  assert.deepEqual(s.view.data.value, latest);
  assert.equal(s.view.loading.value, false);
});
