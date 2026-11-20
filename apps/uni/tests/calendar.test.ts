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
  const paths: string[] = [];
  let show!: () => void | Promise<void>;
  let currentDate = '2026-11-20';
  const filename = fileURLToPath(new URL('../src/pages/calendar/index.vue', import.meta.url));
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor;
  const script = compileScript(descriptor, { id: 'calendar-test' });
  const output = ts.transpileModule(script.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const module = { exports: {} as any };
  const dependencies = {
    '@dcloudio/uni-app': {
      onShow(callback: () => void | Promise<void>) {
        show = callback;
      },
      onPullDownRefresh() {},
    },
    '../../lib/api': {
      request: async (path: string) => {
        const read = deferred<any>();
        paths.push(path);
        reads.push(read);
        return read.promise;
      },
      loadBusinessDate: async () => {
        currentDate = '2026-08-17';
        return { date: currentDate, month: '2026-08' };
      },
    },
    '../../lib/domain': { today: () => currentDate },
    '../../stores/session': { useSession: () => ({ theme: 'cream' }) },
    '../../lib/calendar-source': {
      useCalendarSource: () => ({ calendarSource: { value: undefined }, clearCalendarSource() {} }),
    },
  };
  new Function('require', 'module', 'exports', 'uni', output)(
    (specifier: string) => dependencies[specifier] || (specifier.endsWith('.vue') ? {} : require(specifier)),
    module,
    module.exports,
    { stopPullDownRefresh() {} },
  );
  return { view: module.exports.default.setup({}, { expose() {} }), reads, paths, triggerShow: () => show() };
}

test('a stale mini program calendar response cannot replace a newer successful load', async () => {
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

test('mini program calendar template exposes semantic controls for filters and dates', () => {
  const source = readFileSync(new URL('../src/pages/calendar/index.vue', import.meta.url), 'utf8');
  const filterButton = source.match(/<button\s+v-for="item in filters"[\s\S]*?<\/button>/)?.[0];
  const dayButton = source.match(/<button\s+v-for="\(date, index\) in cells"[\s\S]*?<\/button>/)?.[0];
  assert.ok(filterButton);
  assert.match(filterButton, /:aria-label=/);
  assert.match(filterButton, /:aria-pressed="filter === item\.value"/);
  assert.ok(dayButton);
  assert.match(dayButton, /:aria-label=/);
  assert.match(dayButton, /:aria-pressed="date \? date === selectedDate : undefined"/);
  assert.match(dayButton, /:aria-current=/);
});

test('calendar uses the business month on first show and keeps a manually selected month on later shows', async () => {
  const s = setup();

  const firstShow = s.triggerShow();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(s.paths[0], '/calendar?month=2026-08');
  s.reads[0].resolve({ month: '2026-08', date: '2026-08-17', events: [] });
  await firstShow;
  assert.equal(s.view.month.value, '2026-08');

  const previousMonthLoad = s.view.shiftMonth(-1);
  assert.equal(s.paths[1], '/calendar?month=2026-07');
  s.reads[1].resolve({ month: '2026-07', date: '2026-08-17', events: [] });
  await previousMonthLoad;
  assert.equal(s.view.month.value, '2026-07');

  const laterShow = s.triggerShow();
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(s.paths[2], '/calendar?month=2026-07');
  s.reads[2].resolve({ month: '2026-07', date: '2026-08-17', events: [] });
  await laterShow;
  assert.equal(s.view.month.value, '2026-07');
});
