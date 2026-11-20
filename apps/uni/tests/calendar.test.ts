import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import { proxyRefs } from 'vue';
import ts from 'typescript';

const require = createRequire(import.meta.url);
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
const hasClass = (node: any, expected: string): boolean => {
  const value = node?.props?.class;
  if (typeof value === 'string') return value.split(/\s+/).includes(expected);
  if (Array.isArray(value)) return value.some((item) => hasClass({ props: { class: item } }, expected));
  return Boolean(value && typeof value === 'object' && value[expected]);
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

function setup() {
  const reads: ReturnType<typeof deferred<any>>[] = [];
  const paths: string[] = [];
  let show!: () => void | Promise<void>;
  let currentDate = '2026-11-20';
  const filename = fileURLToPath(new URL('../src/pages/calendar/index.vue', import.meta.url));
  const source = readFileSync(filename, 'utf8');
  const descriptor = parse(source, { filename }).descriptor;
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
      hasCalendarSource: () => false,
      openCalendarSource() {},
    },
  };
  new Function('require', 'module', 'exports', 'uni', output)(
    (specifier: string) => dependencies[specifier] || (specifier.endsWith('.vue') ? {} : require(specifier)),
    module,
    module.exports,
    { stopPullDownRefresh() {} },
  );
  const template = compileTemplate({
    source: descriptor.template!.content,
    filename,
    id: 'calendar-test',
    compilerOptions: { isCustomElement: () => true, bindingMetadata: script.bindings },
  });
  assert.deepEqual(template.errors, []);
  const templateOutput = ts.transpileModule(template.code, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const templateModule = { exports: {} as any };
  new Function('require', 'module', 'exports', templateOutput)(
    (specifier: string) =>
      specifier === 'vue'
        ? { ...require('vue'), withCtx: (slot: unknown) => slot, withDirectives: (node: unknown) => node }
        : require(specifier),
    templateModule,
    templateModule.exports,
  );
  const view = module.exports.default.setup({}, { expose() {} });
  const context = proxyRefs(view);
  return {
    view,
    reads,
    paths,
    triggerShow: () => show(),
    render: () => nodes(templateModule.exports.render(context, [], {}, context)),
  };
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

test('a first calendar read failure does not render a false empty calendar and refresh failure keeps saved events', async () => {
  const s = setup();
  const firstRead = s.view.load();
  s.reads[0].reject(new Error('日历暂时不可用'));
  await firstRead;

  let rendered = s.render();
  assert.ok(textOf(rendered).includes('日历暂时不可用'));
  assert.equal(
    rendered.some((node) => hasClass(node, 'calendar-card')),
    false,
  );
  assert.equal(textOf(rendered).includes('这一天还没有安排'), false);

  const successfulRead = s.view.load();
  s.reads[1].resolve({
    month: '2026-11',
    date: '2026-11-20',
    events: [{ id: 'saved', kind: 'wish', date: '2026-11-20', title: '一起看海' }],
  });
  await successfulRead;

  const failedRefresh = s.view.load();
  s.reads[2].reject(new Error('暂时断开连接'));
  await failedRefresh;
  rendered = s.render();
  assert.ok(textOf(rendered).includes('暂时断开连接'));
  assert.equal(
    rendered.some((node) => hasClass(node, 'calendar-card')),
    true,
  );
  assert.ok(textOf(rendered).includes('一起看海'));
});

test('a failed month change restores the last successful month and its selected date', async () => {
  const s = setup();
  const firstRead = s.view.load();
  s.reads[0].resolve({
    month: '2026-11',
    date: '2026-11-20',
    events: [{ id: 'saved', kind: 'wish', date: '2026-11-20', title: '一起看海' }],
  });
  await firstRead;

  const nextMonthRead = s.view.shiftMonth(1);
  assert.equal(s.paths[1], '/calendar?month=2026-12');
  s.reads[1].reject(new Error('暂时断开连接'));
  await nextMonthRead;

  assert.equal(s.view.month.value, '2026-11');
  assert.equal(s.view.selectedDate.value, '2026-11-20');
  const rendered = s.render();
  assert.ok(textOf(rendered).includes('一起看海'));
  assert.ok(rendered.some((node) => hasClass(node, 'calendar-day') && node.props?.['aria-label']?.startsWith('2026-11-30')));
  assert.equal(rendered.some((node) => node.props?.['aria-label']?.startsWith('2026-12-31')), false);
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
