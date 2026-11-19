import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { uniEchartsLifecycle } from '../scripts/echarts-lifecycle';

const require = createRequire(import.meta.url);
const componentFilename = fileURLToPath(import.meta.resolve('uni-echarts'));
const publishedFilename = resolve(dirname(componentFilename), '../../shared-core.js');
const publishedSource = readFileSync(publishedFilename, 'utf8');
const workspaceRoot = resolve(import.meta.dirname, '../..');
const generatedFilename = resolve(
  workspaceRoot,
  'apps/uni/src/uni_modules/uni-echarts/src/shared-core.js',
).replaceAll('\\', '/');
const unpatched = process.env.UNI_ECHARTS_TEST_UNPATCHED === '1';
const lifecycle = uniEchartsLifecycle(undefined, generatedFilename);
const transformHook = lifecycle.transform;
const transformHandler =
  typeof transformHook === 'function' ? transformHook : transformHook?.handler;
assert.equal(typeof transformHandler, 'function');
const transformResult = Reflect.apply(transformHandler as Function, {}, [
  publishedSource,
  generatedFilename,
]);
const transformedSource = transformResult?.code ?? publishedSource;
const start = publishedSource.indexOf('function useEchartsTouch(');
const end = publishedSource.indexOf('// src/composables/useEchartsUpdateOptions.ts', start);
assert.ok(start >= 0 && end > start, 'Read the exact published touch composable');
const rawFunction = publishedSource.slice(start, end).trim();
const patchedStart = transformedSource.indexOf('function useEchartsTouch(');
const patchedEnd = transformedSource.indexOf(
  '// src/composables/useEchartsUpdateOptions.ts',
  patchedStart,
);
assert.ok(patchedStart >= 0 && patchedEnd > patchedStart);
const patchedFunction = transformedSource.slice(patchedStart, patchedEnd).trim();

type Deferred<T> = { promise: Promise<T>; resolve(value: T): void; reject(error: Error): void };
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
type TouchEvent = { touches: any[]; changedTouches: any[] };
function event(x: number): TouchEvent {
  const touch = { x, y: x + 1, clientX: x, clientY: x + 1 };
  return { touches: [touch], changedTouches: [touch] };
}
function setup(source: string) {
  const events: { type: string; x?: number }[] = [];
  const gestures: string[] = [];
  const queries: (() => Promise<{ top: number; left: number }>)[] = [];
  const instance = {
    disposed: false,
    isDisposed() {
      return this.disposed;
    },
    getDom() {
      return { requestAnimationFrame: () => 1, cancelAnimationFrame() {} };
    },
    getZr() {
      return {
        handler: {
          dispatch(type: string, value: { zrX?: number }) {
            events.push({ type, x: value.zrX });
          },
          processGesture(_value: unknown, phase: string) {
            gestures.push(phase);
          },
        },
      };
    },
  };
  const chart: { value: typeof instance | null } = { value: instance };
  const canvasRect = { top: 5, left: 7 };
  const factory = new Function(
    'shallowRef',
    'UniCanvas',
    'querySelect',
    'toValue',
    'defaultTo',
    'vueThis',
    'canvasId',
    'chart',
    'canvasRect',
    'getTouch',
    `${source}\nreturn useEchartsTouch;`,
  ) as (...args: any[]) => (options: any) => any;
  const useEchartsTouch = factory(
    (value: unknown) => ({ value }),
    {
      dispatch(handler: any, type: string, touch: { x: number }) {
        handler.dispatch(type, { zrX: touch.x });
      },
    },
    (_vueThis: unknown, _selector: string, _fields: unknown) => {
      const query = queries.shift();
      assert.ok(query, 'Each actual start must query the selected canvas');
      return query();
    },
    (value: unknown) => value,
    (value: unknown, fallback: unknown) => value ?? fallback,
    {},
    'growth-chart',
    chart,
    canvasRect,
    (value: TouchEvent) => ({ x: value.touches[0].x, y: value.touches[0].y }),
  );
  const touch = useEchartsTouch({
    vueThis: {},
    supportHover: false,
    isPc: false,
    canvasId: 'growth-chart',
    chart,
    canvasRect,
    getTouch: (value: TouchEvent) => ({ x: value.touches[0].x, y: value.touches[0].y }),
  });
  return { touch, chart, canvasRect, events, gestures, queries };
}

function enqueue(s: ReturnType<typeof setup>, query: Promise<{ top: number; left: number }>) {
  s.queries.push(() => query);
}
test(
  'a canvas query rejected after touch cleanup settles without an unhandled rejection',
  { skip: unpatched },
  async () => {
    const s = setup(patchedFunction);
    const pending = deferred<{ top: number; left: number }>();
    enqueue(s, pending.promise);
    const started = s.touch.onStart(event(20));
    s.touch.cleanup();
    pending.reject(new Error('canvas disappeared'));
    await assert.doesNotReject(started);
    assert.deepEqual(s.events, []);
  },
);

test(
  'a resolved canvas query after cleanup cannot overwrite geometry or dispatch a stale start',
  { skip: unpatched },
  async () => {
    const s = setup(patchedFunction);
    const pending = deferred<{ top: number; left: number }>();
    enqueue(s, pending.promise);
    const started = s.touch.onStart(event(20));
    s.touch.cleanup();
    pending.resolve({ top: 200, left: 300 });
    await started;
    assert.deepEqual(s.canvasRect, { top: 5, left: 7 });
    assert.deepEqual(s.events, []);
  },
);

test(
  'touch end invalidates a pending start before its late query resolves',
  { skip: unpatched },
  async () => {
    const s = setup(patchedFunction);
    const pending = deferred<{ top: number; left: number }>();
    enqueue(s, pending.promise);
    const started = s.touch.onStart(event(20));
    s.touch.onEnd(event(21));
    const eventsAtEnd = s.events.length;
    pending.resolve({ top: 200, left: 300 });
    await started;
    assert.deepEqual(s.canvasRect, { top: 5, left: 7 });
    assert.equal(
      s.events.slice(eventsAtEnd).some(({ type }) => type === 'mousedown'),
      false,
    );
  },
);

for (const invalidation of ['instance replacement', 'instance disposal']) {
  test(
    'a pending start query cannot dispatch after ' + invalidation,
    { skip: unpatched },
    async () => {
      const s = setup(patchedFunction);
      const pending = deferred<{ top: number; left: number }>();
      enqueue(s, pending.promise);
      const started = s.touch.onStart(event(20));
      if (invalidation === 'instance replacement') {
        s.chart.value = {
          ...s.chart.value!,
          getZr() {
            assert.fail('A stale start must not dispatch to a replacement chart');
          },
        } as typeof s.chart.value;
      } else {
        s.chart.value!.disposed = true;
      }
      pending.resolve({ top: 200, left: 300 });
      await started;
      assert.deepEqual(s.canvasRect, { top: 5, left: 7 });
      assert.deepEqual(s.events, []);
    },
  );
}

test(
  'the newest touch owns geometry and dispatch across overlap and cleanup reuse',
  { skip: unpatched },
  async () => {
    const s = setup(patchedFunction);
    const oldQuery = deferred<{ top: number; left: number }>();
    const newestQuery = deferred<{ top: number; left: number }>();
    enqueue(s, oldQuery.promise);
    const oldStart = s.touch.onStart(event(10));
    enqueue(s, newestQuery.promise);
    const newestStart = s.touch.onStart(event(30));
    newestQuery.resolve({ top: 30, left: 31 });
    await newestStart;
    oldQuery.resolve({ top: 10, left: 11 });
    await oldStart;
    assert.deepEqual(s.canvasRect, { top: 30, left: 31 });
    assert.deepEqual(
      s.events.filter(({ type }) => type === 'mousedown').map(({ x }) => x),
      [30],
    );

    s.touch.cleanup();
    const nextQuery = deferred<{ top: number; left: number }>();
    enqueue(s, nextQuery.promise);
    const nextStart = s.touch.onStart(event(40));
    nextQuery.resolve({ top: 40, left: 41 });
    await nextStart;
    assert.deepEqual(s.canvasRect, { top: 40, left: 41 });
    assert.deepEqual(
      s.events.filter(({ type }) => type === 'mousedown').map(({ x }) => x),
      [30, 40],
    );
  },
);

test(
  'an active query failure remains observable and retains the published finally dispatch',
  { skip: unpatched },
  async () => {
    const s = setup(patchedFunction);
    const failure = new Error('active canvas query failed');
    enqueue(s, Promise.reject(failure));
    await assert.rejects(s.touch.onStart(event(50)), (error) => error === failure);
    assert.deepEqual(
      s.events
        .filter(({ type }) => ['mousedown', 'mousemove'].includes(type))
        .map(({ type, x }) => ({ type, x })),
      [
        { type: 'mousedown', x: 50 },
        { type: 'mousemove', x: 50 },
      ],
    );
  },
);
