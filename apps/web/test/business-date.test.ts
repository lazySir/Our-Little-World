import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

function setup() {
  const requests: Promise<any>[] = [];
  let calls = 0;
  let resolveRequest!: (value: any) => void;
  let rejectRequest!: (error: Error) => void;
  const request = () => {
    calls += 1;
    const promise = new Promise((resolve, reject) => {
      resolveRequest = resolve;
      rejectRequest = reject;
    });
    requests.push(promise);
    return promise;
  };
  const output = ts.transpileModule(
    readFileSync(
      fileURLToPath(new URL('../src/composables/business-date.ts', import.meta.url)),
      'utf8',
    ),
    { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } },
  ).outputText;
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', output)(
    (specifier: string) => {
      if (specifier === '../api') return { request };
      throw new Error(`Unexpected dependency: ${specifier}`);
    },
    module,
    module.exports,
  );
  return {
    loadBusinessDate: module.exports.loadBusinessDate as (options?: {
      force?: boolean;
    }) => Promise<any>,
    calls: () => calls,
    requests,
    resolve: (value: any) => resolveRequest(value),
    reject: (error: Error) => rejectRequest(error),
  };
}

test('business date shares an in-flight request and caches successful navigation loads', async () => {
  const s = setup();
  const first = s.loadBusinessDate();
  const second = s.loadBusinessDate();
  assert.equal(s.calls(), 1);
  s.resolve({ date: '2026-11-21', month: '2026-11' });
  assert.deepEqual(await Promise.all([first, second]), [
    { date: '2026-11-21', month: '2026-11' },
    { date: '2026-11-21', month: '2026-11' },
  ]);
  assert.deepEqual(await s.loadBusinessDate(), { date: '2026-11-21', month: '2026-11' });
  assert.equal(s.calls(), 1);
});

test('business date failure is cooled down so later navigations fail immediately', async () => {
  const s = setup();
  const error = new Error('offline');
  const pending = s.loadBusinessDate();
  s.reject(error);
  await assert.rejects(pending, error);
  await assert.rejects(s.loadBusinessDate(), error);
  assert.equal(s.calls(), 1);
});

test('expired business date refreshes in the background without blocking navigation', async (t) => {
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 20) });
  const s = setup();
  const first = s.loadBusinessDate();
  s.resolve({ date: '2026-11-20', month: '2026-11' });
  await first;

  t.mock.timers.tick(5 * 60 * 1000 + 1);
  assert.deepEqual(await s.loadBusinessDate(), { date: '2026-11-20', month: '2026-11' });
  assert.equal(s.calls(), 2);
  assert.deepEqual(await s.loadBusinessDate(), { date: '2026-11-20', month: '2026-11' });
  assert.equal(s.calls(), 2);

  const refresh = s.loadBusinessDate({ force: true });
  s.resolve({ date: '2026-11-21', month: '2026-11' });
  assert.deepEqual(await refresh, { date: '2026-11-21', month: '2026-11' });
  assert.deepEqual(await s.loadBusinessDate(), { date: '2026-11-21', month: '2026-11' });
  assert.equal(s.calls(), 2);
});
