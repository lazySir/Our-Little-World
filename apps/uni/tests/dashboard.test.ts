import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse, compileScript } from '@vue/compiler-sfc';
import ts from 'typescript';
import * as domain from '../src/lib/domain';

const require = createRequire(import.meta.url);
function setup(t: any, withDate = true) {
  const previousTZ = process.env.TZ;
  process.env.TZ = 'Asia/Shanghai';
  t.after(() => {
    if (previousTZ === undefined) delete process.env.TZ;
    else process.env.TZ = previousTZ;
  });
  t.mock.timers.enable({ apis: ['Date'], now: Date.UTC(2026, 10, 1, 0, 30) });
  assert.equal(domain.today(), '2026-11-01');
  const date = withDate ? '2026-10-31' : domain.today();
  let serviceDate = date;
  const dashboard: any = {
    ...(withDate ? { date } : {}),
    moods: [
      { id: 'mine', authorId: 'owner', date, mood: 'good', note: '服务日的心情' },
      { id: 'partner', authorId: 'partner', date, mood: 'great', note: '另一半的心情' },
    ],
  };
  const writes: any[] = [];
  const filename = fileURLToPath(new URL('../src/pages/home/index.vue', import.meta.url));
  const source = compileScript(parse(readFileSync(filename, 'utf8'), { filename }).descriptor, {
    id: 'dashboard-test',
  }).content;
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies = {
    '@dcloudio/uni-app': { onShow() {}, onPullDownRefresh() {} },
    '../../stores/session': {
      useSession: () => ({ user: { id: 'owner' }, load: async () => true }),
    },
    '../../lib/domain': domain,
    '../../lib/api': {
      request: async (path: string, method?: string, body?: any) => {
        if (method === 'POST') {
          writes.push({ path, body });
          const savedDate = body.date === undefined ? serviceDate : body.date;
          if (savedDate === serviceDate) {
            const mine = dashboard.moods.find((entry: any) => entry.authorId === 'owner');
            if (mine) Object.assign(mine, body, { date: savedDate });
            else dashboard.moods.push({ id: 'mine', authorId: 'owner', ...body, date: savedDate });
          }
          return {};
        }
        return structuredClone(dashboard);
      },
      notify() {},
      navigate() {},
    },
  };
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', 'uni', output)(
    (specifier: string) =>
      dependencies[specifier] || (specifier.endsWith('.vue') ? {} : require(specifier)),
    module,
    module.exports,
    { stopPullDownRefresh() {} },
  );
  const view = module.exports.default.setup({}, { expose() {} });
  return {
    view,
    writes,
    nextServiceDay(date: string) {
      serviceDate = date;
      dashboard.date = date;
      dashboard.moods = [];
    },
  };
}

test('home mood writes let the service choose its date and remain visible after reload', async (t) => {
  const s = setup(t);
  await s.view.load();
  assert.equal(s.view.moodNote.value, '服务日的心情');
  assert.equal(s.view.partnerMoods.value[0].note, '另一半的心情');
  s.view.myMood.value = 'great';
  s.view.moodNote.value = '跨时区更新';
  await s.view.saveMood();
  assert.equal(Object.hasOwn(s.writes[0].body, 'date'), false);
  assert.equal(s.view.moodNote.value, '跨时区更新');
  assert.equal(s.view.myMood.value, 'great');
});

test('home remains compatible with an older dashboard without a calendar date', async (t) => {
  const s = setup(t, false);
  await s.view.load();
  await s.view.saveMood();
  assert.equal(Object.hasOwn(s.writes[0].body, 'date'), false);
  assert.equal(s.view.myMood.value, 'good');
});

test('home saves after service midnight without sending its cached dashboard date', async (t) => {
  const s = setup(t);
  await s.view.load();
  assert.equal(s.view.dashboard.value.date, '2026-10-31');
  s.nextServiceDay('2026-11-01');
  t.mock.timers.setTime(Date.UTC(2026, 10, 1, 8, 30));
  s.view.myMood.value = 'great';
  s.view.moodNote.value = '新的一天';
  await s.view.saveMood();
  assert.equal(Object.hasOwn(s.writes[0].body, 'date'), false);
  assert.equal(s.view.dashboard.value.date, '2026-11-01');
  assert.equal(s.view.moodNote.value, '新的一天');
});

test('home clears yesterday mood when the next service day has no mood record', async (t) => {
  const s = setup(t);
  await s.view.load();
  assert.equal(s.view.myMood.value, 'good');
  assert.equal(s.view.moodNote.value, '服务日的心情');
  s.nextServiceDay('2026-11-01');
  await s.view.load();
  assert.equal(s.view.myMood.value, '');
  assert.equal(s.view.moodNote.value, '');
});
