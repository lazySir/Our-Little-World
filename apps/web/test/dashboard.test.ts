import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import { createSSRApp } from 'vue';
import { renderToString } from '@vue/server-renderer';
import ts from 'typescript';
import * as domain from '../src/domain.ts';

const require = createRequire(import.meta.url);
const serverDate = '2026-10-31';
function setup(t: any, withDate = true) {
  const previousTZ = process.env.TZ;
  process.env.TZ = 'Asia/Shanghai';
  t.after(() => {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  });
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 1, 0, 30) });
  assert.equal(domain.today(), '2026-11-01');
  let date = withDate ? serverDate : domain.today();
  const dashboard: any = {
    ...(withDate ? { date } : {}),
    daysTogether: 1,
    monthly: { incomeCents: 0, expenseCents: 123, balanceCents: -123 },
    moods: [
      {
        id: 'mine',
        authorId: 'owner',
        date,
        mood: 'good',
        note: '今天收好',
        author: { nickname: '我' },
      },
      {
        id: 'partner',
        authorId: 'partner',
        date,
        mood: 'great',
        note: '一起开心',
        author: { nickname: '你' },
      },
    ],
    upcomingAnniversaries: [{ id: 'today', title: '就在今天', date, recurring: false }],
  };
  const writes: any[] = [];
  const api = {
    get: async () => structuredClone(dashboard),
    post: async (path: string, body: any) => {
      writes.push({ path, body });
      if (body.date === undefined || body.date === date) {
        const saved = { ...body, date };
        const mine = dashboard.moods.find((row: any) => row.authorId === 'owner');
        if (mine) Object.assign(mine, saved);
        else dashboard.moods.push({ id: 'mine', authorId: 'owner', ...saved });
      }
    },
  };
  const filename = fileURLToPath(new URL('../src/pages/DashboardPage.vue', import.meta.url));
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor;
  const script = compileScript(descriptor, { id: 'dashboard-test' });
  function execute(source: string, dependencies: Record<string, any>) {
    const output = ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    const module = { exports: {} as any };
    new Function('require', 'module', 'exports', output)(
      (specifier: string) =>
        dependencies[specifier] || (specifier.endsWith('.vue') ? {} : require(specifier)),
      module,
      module.exports,
    );
    return module.exports;
  }
  const component = execute(script.content, {
    '../api': { api, assetUrl: () => '' },
    '../domain': domain,
    '../stores/session': { useSession: () => ({ user: { id: 'owner' }, space: { name: '我们' } }) },
    vue: { ...require('vue'), onMounted() {} },
    'element-plus': {
      ElMessage: {
        success() {},
        error(message: string) {
          throw new Error(message);
        },
      },
    },
  }).default;
  const view = component.setup({}, { expose() {} });
  async function render() {
    const template = compileTemplate({
      source: descriptor.template!.content,
      filename,
      id: 'dashboard-test',
      ssr: true,
      ssrCssVars: [],
      compilerOptions: { bindingMetadata: script.bindings },
    });
    assert.deepEqual(template.errors, []);
    const app = createSSRApp({
      setup: () => view,
      ssrRender: execute(template.code, {}).ssrRender,
    });
    app.config.warnHandler = () => {};
    app.component('LoadState', { template: '<div><slot /></div>' });
    return renderToString(app);
  }
  function advanceServiceDay(nextDate: string) {
    date = nextDate;
    if (withDate) dashboard.date = date;
    dashboard.moods = [];
  }
  return { view, writes, render, advanceServiceDay };
}

test('dashboard keeps the service day moods visible across a device date boundary', async (t) => {
  const s = setup(t);
  await s.view.load();
  assert.equal(s.view.ownMood.value?.id, 'mine');
  assert.equal(s.view.note.value, '今天收好');
  assert.deepEqual(
    s.view.moods.value.map((row: any) => row.id),
    ['mine', 'partner'],
  );
});

test('saving a dashboard mood leaves its date to the service and remains visible on reload', async (t) => {
  const s = setup(t);
  await s.view.load();
  s.view.mood.value = 'great';
  s.view.note.value = '更新的今天';
  await s.view.saveMood();
  assert.deepEqual(s.writes[0].body, { mood: 'great', note: '更新的今天' });
  assert.equal(s.view.ownMood.value?.note, '更新的今天');
});

test('a dashboard left open past service midnight does not submit its cached date', async (t) => {
  const s = setup(t);
  await s.view.load();
  t.mock.timers.tick(86400000);
  s.advanceServiceDay('2026-11-01');
  s.view.note.value = '新一天的心情';
  await s.view.saveMood();
  assert.equal(Object.hasOwn(s.writes[0].body, 'date'), false);
  assert.equal(s.view.dashboardDate.value, '2026-11-01');
  assert.equal(s.view.ownMood.value?.note, '新一天的心情');
});

test('a dashboard reload on a day without my mood resets the previous day input', async (t) => {
  const s = setup(t);
  await s.view.load();
  s.view.mood.value = 'low';
  s.advanceServiceDay('2026-11-01');
  await s.view.load();
  assert.equal(s.view.ownMood.value, undefined);
  assert.equal(s.view.mood.value, 'good');
  assert.equal(s.view.note.value, '');
});

test('dashboard anniversary countdown uses the same date as its response', async (t) => {
  const s = setup(t);
  await s.view.load();
  assert.equal(s.view.upcoming.value.length, 1);
  assert.equal(s.view.upcoming.value[0].next.days, 0);
});

test('dashboard renders its service date and the month matching the monthly totals', async (t) => {
  const s = setup(t);
  await s.view.load();
  const html = await s.render();
  assert.match(html, /10\.31/);
  assert.match(html, /10 月的小账本/);
});

test('dashboard remains compatible with an older response without a calendar date', async (t) => {
  const s = setup(t, false);
  await s.view.load();
  await s.view.saveMood();
  assert.equal(Object.hasOwn(s.writes[0].body, 'date'), false);
  assert.equal(s.view.ownMood.value?.id, 'mine');
});
