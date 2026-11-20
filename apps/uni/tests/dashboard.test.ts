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
const textOf = (node: any): string =>
  Array.isArray(node)
    ? node.map(textOf).join('')
    : node && typeof node === 'object'
      ? textOf(node.children)
      : typeof node === 'string'
        ? node
        : '';
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
function setup(
  t: any,
  withDate = true,
  pendingWrite?: Promise<void>,
  dashboardRead?: () => Promise<any>,
) {
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
  const notices: string[] = [];
  const navigations: string[] = [];
  const session = { user: { id: 'owner' }, load: async () => true };
  let show!: (event?: unknown) => Promise<void>;
  let refresh!: (event?: unknown) => Promise<void>;
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
        return dashboardRead ? dashboardRead() : structuredClone(dashboard);
      },
      notify(message: string) {
        notices.push(message);
      },
      navigate(url: string) {
        navigations.push(url);
      },
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
    notices,
    navigations,
    api: dependencies['../../lib/api'],
    session,
    show: (event?: unknown) => show(event),
    refresh: (event?: unknown) => refresh(event),
    stopped: () => stopped,
    render: () => templateModule.exports.render(context, [], {}, context),
    nextServiceDay(date: string) {
      serviceDate = date;
      dashboard.date = date;
      dashboard.moods = [];
    },
  };
}

test('home previews up to four pending wishes between its feature grid and recent memories', async (t) => {
  const s = setup(t);
  await s.view.load();
  s.view.dashboard.value.pendingWishes = Array.from({ length: 6 }, (_, index) => ({
    id: `wish-${index}`,
    title: `一起完成第 ${index + 1} 件事`,
  }));
  const rendered = nodes(s.render());
  const preview = rendered.find((node) => node.props?.class?.split(' ').includes('home-wishes'));
  assert.ok(preview, 'The actual home template must render a pending wish preview');
  const rows = nodes(preview).filter((node) => node.type === 'wd-cell');
  assert.deepEqual(
    rows.map((node) => node.props.title),
    ['一起完成第 1 件事', '一起完成第 2 件事', '一起完成第 3 件事', '一起完成第 4 件事'],
  );
  const featureIndex = rendered.findIndex((node) => node.props?.class === 'feature-grid');
  const previewIndex = rendered.indexOf(preview);
  const headingIndex = rendered.findIndex((node) => node.children === '我们的待办愿望');
  const memoryIndex = rendered.findIndex((node) => node.children === '最近的回忆');
  assert.ok(
    featureIndex < headingIndex && headingIndex < previewIndex && previewIndex < memoryIndex,
  );
});

test('home hides default empty content after the first dashboard read fails and offers retry', async (t) => {
  const failure = deferred<any>();
  const s = setup(t, true, undefined, () => failure.promise);
  const pending = s.view.load();
  await drain();
  failure.reject(new Error('首页暂时打不开'));
  await pending;
  const rendered = nodes(s.render());
  assert.equal(
    rendered.some((node) => node.props?.class === 'hero'),
    false,
    'The first dashboard failure must not render zero-value dashboard content',
  );
  assert.equal(
    rendered.some((node) => node.props?.action === '写下第一个愿望'),
    false,
    'The first dashboard failure must not render empty wish guidance',
  );
  assert.ok(
    rendered.some((node) => node.type === 'wd-button' && node.children === '重新加载'),
    'The dashboard failure must expose a retry action',
  );
});

test('home keeps its last dashboard visible when a later refresh fails', async (t) => {
  const firstRead = deferred<any>();
  const refreshRead = deferred<any>();
  const reads = [firstRead, refreshRead];
  const s = setup(t, true, undefined, () => reads.shift()!.promise);
  const snapshot = {
    date: '2026-10-31',
    daysTogether: 999,
    moods: [],
    upcomingAnniversaries: [],
    monthly: { incomeCents: 0, expenseCents: 0, balanceCents: 0 },
    pendingWishes: [{ id: 'saved-wish', title: '已经保存的愿望' }],
    recentMemories: [],
  };
  const initial = s.view.load();
  await drain();
  firstRead.resolve(snapshot);
  await initial;
  assert.equal(s.view.hasLoaded.value, true);

  const refresh = s.view.load();
  await drain();
  refreshRead.reject(new Error('暂时无法更新'));
  await refresh;

  const rendered = nodes(s.render());
  assert.deepEqual(s.view.dashboard.value, snapshot);
  assert.ok(rendered.some((node) => node.props?.class === 'hero'));
  assert.ok(rendered.some((node) => node.children === '暂时无法更新'));
  assert.ok(rendered.some((node) => node.type === 'wd-button' && node.children === '重新加载'));
});

test('home mood choices render as named buttons with an exposed pressed state', async (t) => {
  const s = setup(t);
  await s.view.load();
  const choices = nodes(s.render()).filter(
    (node) => node.type === 'button' && node.props?.['aria-pressed'] !== undefined,
  );

  assert.equal(choices.length, 5);
  assert.ok(choices.every((choice) => choice.type === 'button'));
  assert.deepEqual(
    choices.map((choice) => [choice.props['aria-label'], choice.props['aria-pressed']]),
    [
      ['闪闪发光，未选中', false],
      ['还不错，已选中', true],
      ['平平的，未选中', false],
      ['有点低落，未选中', false],
      ['需要休息，未选中', false],
    ],
  );
});

test('home wish preview includes a target date only when the wish has one', async (t) => {
  const s = setup(t);
  await s.view.load();
  s.view.dashboard.value.pendingWishes = [
    { id: 'dated', title: '一起看日落', targetDate: '2026-11-22' },
    { id: 'undated', title: '找一家喜欢的小店' },
    { id: 'null-date', title: '去公园散步', targetDate: null },
  ];
  const rows = nodes(s.render()).filter((node) => node.type === 'wd-cell');
  assert.equal(rows.length, 3, 'The real template must render each pending wish');
  assert.equal(rows[0].props.label, '目标 2026-11-22');
  assert.equal(rows[1].props.label, '');
  assert.equal(rows[2].props.label, '');
});

test('clicking a rendered home wish opens the existing wish list', async (t) => {
  const s = setup(t);
  await s.view.load();
  s.view.dashboard.value.pendingWishes = [{ id: 'wish', title: '一起看日落' }];
  const row = nodes(s.render()).find((node) => node.type === 'wd-cell');
  assert.ok(row, 'The actual home template must render a clickable wish');
  assert.equal(row.props['is-link'], true, 'Wot cells must enable their click event');
  row.props.onClick();
  assert.deepEqual(s.navigations, ['/pages/wishes/index']);
});

for (const wishes of [undefined, []]) {
  test(`home offers a first wish action when pending wishes are ${wishes ? 'empty' : 'missing'}`, async (t) => {
    const s = setup(t);
    await s.view.load();
    s.view.dashboard.value.pendingWishes = wishes;
    const rendered = nodes(s.render());
    const empty = rendered.find((node) => node.props?.action === '写下第一个愿望');
    assert.ok(empty, 'The actual home template must render the first wish action');
    assert.equal(
      rendered.some((node) => node.type === 'wd-cell'),
      false,
    );
    empty.props.onAction();
    assert.deepEqual(s.navigations, ['/pages/wishes/index']);
  });
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
    const otherMood = controls.find(
      (node) => node.props?.onClick && node.props.class?.split(' ').includes('chip'),
    );
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

test('a pull-down response started before a mood save cannot undo its post-save refresh', async (t) => {
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
  const refreshing = s.refresh();
  await drain();
  assert.equal(reads.length, 1);
  const saving = s.view.saveMood();
  write.resolve();
  await drain();
  assert.equal(reads.length, 2);
  reads[1].resolve(await request('/dashboard'));
  await saving;
  assert.equal(s.view.moodNote.value, '刚刚保存的新心情');
  const stopsAfterLatest = s.stopped();
  reads[0].resolve(oldDashboard);
  await refreshing;
  assert.equal(s.view.moodNote.value, '刚刚保存的新心情');
  assert.equal(s.view.dashboard.value.moods[0].note, '刚刚保存的新心情');
  assert.equal(s.stopped(), stopsAfterLatest, 'The stale response cannot finish another refresh');
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

for (const hook of ['show', 'refresh'] as const) {
  test(`a ${hook} event during a failed mood save cannot replace its draft`, async (t) => {
    const write = deferred<void>();
    const s = setup(t, true, write.promise);
    await s.view.load();
    s.view.myMood.value = 'low';
    s.view.moodNote.value = '发送失败也请保留这句';
    const saving = s.view.saveMood();
    const stopsBeforeHook = s.stopped();
    await s[hook]({ source: hook });
    assert.equal(s.stopped(), stopsBeforeHook + 1, 'The skipped refresh must stop its spinner');
    write.reject(new Error('心情没有送达'));
    await saving;
    assert.equal(s.view.myMood.value, 'low');
    assert.equal(s.view.moodNote.value, '发送失败也请保留这句');
    assert.equal(s.view.moodSaving.value, false);
    assert.equal(s.view.loading.value, false);
    assert.deepEqual(s.notices, ['心情没有送达']);
    const note = nodes(s.render()).find((node) => node.type === 'wd-textarea');
    assert.ok(note, 'The retained draft must remain visible after failure');
    assert.equal(note.props.disabled, false);
    note.props['onUpdate:modelValue']('可以继续补写');
    assert.equal(s.view.moodNote.value, '可以继续补写');
  });
}

test('a load already in flight cannot overwrite the draft after a mood save fails', async (t) => {
  const write = deferred<void>();
  const s = setup(t, true, write.promise);
  await s.view.load();
  const request = s.api.request;
  const previousDashboard = await request('/dashboard');
  const read = deferred<any>();
  let reads = 0;
  s.api.request = async (path, method, body) => {
    if (method) return request(path, method, body);
    reads++;
    return read.promise;
  };
  s.view.myMood.value = 'great';
  s.view.moodNote.value = '先前刷新也不能抹掉的草稿';
  const refreshing = s.refresh();
  await drain();
  assert.equal(reads, 1);
  const saving = s.view.saveMood();
  write.reject(new Error('心情没有送达'));
  await saving;
  const loadingAfterFailure = s.view.loading.value;
  const stopsAfterFailure = s.stopped();
  read.resolve(previousDashboard);
  await refreshing;
  assert.equal(s.view.myMood.value, 'great');
  assert.equal(s.view.moodNote.value, '先前刷新也不能抹掉的草稿');
  assert.equal(s.view.moodSaving.value, false);
  assert.equal(loadingAfterFailure, false, 'The invalidated refresh cannot hide the failed draft');
  assert.equal(stopsAfterFailure, 2, 'Saving must end the superseded pull-down spinner');
  assert.equal(s.stopped(), stopsAfterFailure, 'A cancelled load cannot stop a later refresh');
  assert.equal(s.view.loading.value, false);
  assert.deepEqual(s.notices, ['心情没有送达']);
});

test('a session check started before a failed mood save cannot reload over its draft', async (t) => {
  const write = deferred<void>();
  const s = setup(t, true, write.promise);
  await s.view.load();
  const check = deferred<boolean>();
  s.session.load = () => check.promise;
  const request = s.api.request;
  let reads = 0;
  s.api.request = async (path, method, body) => {
    if (!method) reads++;
    return request(path, method, body);
  };
  s.view.myMood.value = 'tired';
  s.view.moodNote.value = '等待账号资料时也要保留';
  const refreshing = s.refresh();
  await drain();
  const saving = s.view.saveMood();
  write.reject(new Error('心情没有送达'));
  await saving;
  check.resolve(true);
  await refreshing;
  assert.equal(reads, 0, 'The superseded session check must not start a dashboard request');
  assert.equal(s.view.myMood.value, 'tired');
  assert.equal(s.view.moodNote.value, '等待账号资料时也要保留');
  assert.equal(s.view.loading.value, false);
});
