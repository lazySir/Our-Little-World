import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import { proxyRefs } from 'vue';
import ts from 'typescript';
import * as domain from '../src/lib/domain';

const require = createRequire(import.meta.url);
const nodes = (node: any): any[] =>
  Array.isArray(node)
    ? node.flatMap(nodes)
    : node && typeof node === 'object'
      ? [node, ...nodes(node.children)]
      : [];
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: Error) => void;
  const promise = new Promise<T>((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}
async function drain() {
  for (let i = 0; i < 10; i++) await Promise.resolve();
}
function setup(t: any, withDate = true, pendingWrite?: Promise<void>) {
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
  const session = { user: { id: 'owner' }, load: async () => true };
  let show!: () => Promise<void>;
  let refresh!: () => Promise<void>;
  let stopped = 0;
  const filename = fileURLToPath(new URL('../src/pages/home/index.vue', import.meta.url));
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor;
  const script = compileScript(descriptor, {
    id: 'dashboard-test',
  });
  const output = ts.transpileModule(script.content, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  const dependencies = {
    '@dcloudio/uni-app': {
      onShow(callback: typeof show) {
        show = callback;
      },
      onPullDownRefresh(callback: typeof refresh) {
        refresh = callback;
      },
    },
    '../../stores/session': { useSession: () => session },
    '../../lib/domain': domain,
    '../../lib/api': {
      request: async (path: string, method?: string, body?: any) => {
        if (method === 'POST') {
          writes.push({ path, body });
          await pendingWrite;
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
    {
      stopPullDownRefresh() {
        stopped++;
      },
    },
  );
  const view = module.exports.default.setup({}, { expose() {} });
  const template = compileTemplate({
    source: descriptor.template!.content,
    filename,
    id: 'dashboard-test',
    compilerOptions: { isCustomElement: () => true, bindingMetadata: script.bindings },
  });
  const templateModule = { exports: {} as any };
  new Function(
    'require',
    'module',
    'exports',
    ts.transpileModule(template.code, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText,
  )(require, templateModule, templateModule.exports);
  const context = proxyRefs(view);
  return {
    view,
    writes,
    api: dependencies['../../lib/api'],
    session,
    show: () => show(),
    refresh: () => refresh(),
    stopped: () => stopped,
    render: () => templateModule.exports.render(context, [], {}, context),
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

test('home locks mood controls while a delayed save is pending and unlocks after success', async (t) => {
  let finishWrite!: () => void;
  const s = setup(
    t,
    true,
    new Promise<void>((resolve) => {
      finishWrite = resolve;
    }),
  );
  await s.view.load();
  const pending = s.view.saveMood();
  try {
    assert.equal(s.view.moodSaving.value, true);
    const controls = nodes(s.render());
    const note = controls.find((node) => node.type === 'wd-textarea');
    assert.ok(note, 'The actual home template must render the mood note');
    assert.equal(note.props.disabled, true, 'The pending save must disable the note field');
    const otherMood = controls.find((node) => node.props?.onClick && node.props.class === 'chip');
    assert.ok(otherMood);
    otherMood.props.onClick();
    note.props['onUpdate:modelValue']('保存期间又写了一句');
    assert.equal(s.view.myMood.value, 'good');
    assert.equal(s.view.moodNote.value, '服务日的心情');
    await s.view.saveMood();
    assert.equal(s.writes.length, 1, 'A repeated save cannot submit another pending request');
  } finally {
    finishWrite();
    await pending;
  }
  const note = nodes(s.render()).find((node) => node.type === 'wd-textarea');
  assert.equal(note.props.disabled, false);
  note.props['onUpdate:modelValue']('现在可以继续写');
  await s.view.chooseMood('great');
  assert.equal(s.view.moodNote.value, '现在可以继续写');
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

test('a pull-down response started during a mood save cannot undo its post-save refresh', async (t) => {
  const write = deferred<void>();
  const s = setup(t, true, write.promise);
  await s.view.load();
  const request = s.api.request;
  const oldDashboard = await request('/dashboard');
  const reads: ReturnType<typeof deferred<any>>[] = [];
  s.api.request = async (path, method, body) => {
    if (method) return request(path, method, body);
    const read = deferred<any>();
    reads.push(read);
    return read.promise;
  };
  s.view.moodNote.value = '刚刚保存的新心情';
  const saving = s.view.saveMood();
  const refreshing = s.refresh();
  await drain();
  assert.equal(reads.length, 1);
  write.resolve();
  await drain();
  assert.equal(reads.length, 2);
  reads[1].resolve(await request('/dashboard'));
  await saving;
  assert.equal(s.view.moodNote.value, '刚刚保存的新心情');
  reads[0].resolve(oldDashboard);
  await refreshing;
  assert.equal(s.view.moodNote.value, '刚刚保存的新心情');
  assert.equal(s.view.dashboard.value.moods[0].note, '刚刚保存的新心情');
  assert.equal(s.stopped(), 2, 'Only the initial load and latest refresh may stop the spinner');
});

test('an older home load failure cannot publish errors or stop a newer refresh', async (t) => {
  const s = setup(t);
  const reads: ReturnType<typeof deferred<any>>[] = [];
  s.api.request = async () => {
    const read = deferred<any>();
    reads.push(read);
    return read.promise;
  };
  const older = s.show();
  await drain();
  const newer = s.refresh();
  await drain();
  assert.equal(reads.length, 2);
  try {
    reads[0].reject(new Error('旧请求失败'));
    await older;
    assert.equal(s.view.error.value, '');
    assert.equal(s.view.loading.value, true);
    assert.equal(s.stopped(), 0);
  } finally {
    reads[1].resolve({
      date: '2026-10-31',
      moods: [{ id: 'mine', authorId: 'owner', mood: 'great', note: '最新加载的心情' }],
    });
    await newer;
  }
  assert.equal(s.view.myMood.value, 'great');
  assert.equal(s.view.moodNote.value, '最新加载的心情');
  assert.equal(s.view.loading.value, false);
  assert.equal(s.view.error.value, '');
  assert.equal(s.stopped(), 1);
});

test('an old session check cannot start another dashboard request after a newer home load', async (t) => {
  const s = setup(t);
  const check = deferred<boolean>();
  let checks = 0;
  s.session.load = async () => (++checks === 1 ? check.promise : true);
  const request = s.api.request;
  let reads = 0;
  s.api.request = async (...args: Parameters<typeof request>) => {
    reads++;
    return request(...args);
  };
  const older = s.show();
  const newer = s.refresh();
  await newer;
  assert.equal(reads, 1);
  check.resolve(true);
  await older;
  assert.equal(reads, 1, 'A superseded session check must not issue a stale dashboard load');
  assert.equal(s.stopped(), 1);
  assert.equal(s.view.loading.value, false);
});
