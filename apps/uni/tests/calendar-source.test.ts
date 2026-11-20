import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { compileScript, compileTemplate, parse } from '@vue/compiler-sfc';
import { proxyRefs } from 'vue';
import ts from 'typescript';
import * as domain from '../src/lib/domain';

const require = createRequire(import.meta.url);
const date = '2026-11-20';
const member = { id: 'owner', nickname: '我们' };
const source = (name: string) => new URL('../src/' + name, import.meta.url);
const all = (node: any): any[] =>
  Array.isArray(node)
    ? node.flatMap(all)
    : node && typeof node === 'object'
      ? [
          node,
          ...all(
            typeof node.children?.default === 'function' ? node.children.default() : node.children,
          ),
        ]
      : [];
const textOf = (node: any): string =>
  Array.isArray(node)
    ? node.map(textOf).join('')
    : node && typeof node === 'object'
      ? textOf(
          typeof node.children?.default === 'function' ? node.children.default() : node.children,
        )
      : typeof node === 'string'
        ? node
        : '';

function setup() {
  let hooks: (() => unknown)[] = [];
  let hideHooks: (() => unknown)[] = [];
  const nav: { method: string; options: UniApp.NavigateToOptions }[] = [];
  const events: unknown[] = [];
  const lists = new Map<string, unknown>();
  const requests: [string, string][] = [];
  const toasts: string[] = [];
  const uni = {
    stopPullDownRefresh() {},
    pageScrollTo() {},
    switchTab(options: UniApp.SwitchTabOptions) {
      nav.push({ method: 'switchTab', options });
    },
    navigateTo(options: UniApp.NavigateToOptions) {
      nav.push({ method: 'navigateTo', options });
    },
  };
  const platform = {
    onShow(callback: () => unknown) {
      hooks.push(callback);
    },
    onHide(callback: () => unknown) {
      hideHooks.push(callback);
    },
    onPullDownRefresh() {},
    onResize() {},
  };
  const api = {
    async request(path: string, method = 'GET') {
      requests.push([path, method]);
      if (path.startsWith('/calendar?')) return { month: date.slice(0, 7), date, events };
      const result = lists.get(path);
      if (result instanceof Error) throw result;
      return result ?? (path === '/baby' ? null : []);
    },
    notify(message: string) {
      toasts.push(message);
    },
  };
  const session = { useSession: () => ({ theme: 'cream', user: member, load: async () => true }) };
  function evaluate(code: string, deps: Record<string, unknown> = {}) {
    const module = { exports: {} as any };
    const output = ts.transpileModule(code, {
      compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
    }).outputText;
    new Function('require', 'module', 'exports', 'uni', output)(
      (name: string) => deps[name] ?? (name.endsWith('.vue') ? {} : require(name)),
      module,
      module.exports,
      uni,
    );
    return module.exports;
  }
  const calendarSource = evaluate(readFileSync(source('lib/calendar-source.ts'), 'utf8'), {
    '@dcloudio/uni-app': platform,
  });
  const resource = evaluate(readFileSync(source('lib/useResource.ts'), 'utf8'), {
    '@dcloudio/uni-app': platform,
    './api': api,
    '../stores/session': session,
  });
  const noticeFilename = fileURLToPath(source('components/CalendarSourceNotice.vue'));
  const noticeDescriptor = parse(readFileSync(noticeFilename, 'utf8'), {
    filename: noticeFilename,
  });
  const notice = evaluate(
    compileScript(noticeDescriptor.descriptor, {
      id: 'calendar-source-notice',
      inlineTemplate: true,
      templateOptions: { compilerOptions: { isCustomElement: () => true } },
    }).content,
  ).default;
  function open(page: string) {
    hooks = [];
    hideHooks = [];
    const filename = fileURLToPath(source('pages/' + page + '/index.vue'));
    const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor;
    const script = compileScript(descriptor, { id: 'calendar-source-' + page });
    const component = evaluate(script.content, {
      '@dcloudio/uni-app': platform,
      '../../lib/api': api,
      '../../lib/calendar-source': calendarSource,
      '../../lib/domain': { ...domain, today: () => date },
      '../../lib/useResource': resource,
      '../../stores/session': session,
      '../../components/CalendarSourceNotice.vue': notice,
    }).default;
    const template = compileTemplate({
      source: descriptor.template!.content,
      filename,
      id: 'calendar-source-' + page,
      compilerOptions: { isCustomElement: () => true, bindingMetadata: script.bindings },
    });
    assert.deepEqual(template.errors, []);
    const { render } = evaluate(template.code, {
      vue: {
        ...require('vue'),
        resolveComponent: (name: string) => name,
        withCtx: (slot: any) => slot,
        withDirectives: (node: any) => node,
      },
    });
    const ctx = proxyRefs(component.setup({}, { expose() {} }));
    const pageHooks = hooks;
    const rendered = () =>
      all(render(ctx, [], {}, ctx)).flatMap((node) =>
        node.type === 'CalendarSourceNotice'
          ? all(notice.setup(node.props, { emit: node.props.onClear })({}, []))
          : [node],
      );
    return {
      ctx,
      show: () => Promise.all(pageHooks.map((hook) => hook())),
      hide: () => hideHooks.forEach((hook) => hook()),
      noticeMissing: () =>
        all(render(ctx, [], {}, ctx)).find((node: any) => node.type === 'CalendarSourceNotice')
          ?.props?.missing,
      has: (text: string) => {
        return rendered().some((node) => textOf(node).includes(text));
      },
      click(text: string) {
        const button = rendered().find(
          (node) => typeof node.props?.onClick === 'function' && textOf(node).trim() === text,
        );
        assert.ok(
          button,
          'Expected action: ' + text + '; rendered=' + rendered().map(textOf).join('|'),
        );
        return button.props.onClick();
      },
    };
  }
  function addEvent(kind: string, sourceId = 'target', locked = false) {
    events.push({ id: sourceId + ':' + date, sourceId, kind, date, title: '日历中的记录', locked });
  }
  return { addEvent, lists, nav, open, requests, toasts };
}

test('a wish selected in the calendar focuses its card despite filters on an existing tab', async () => {
  const s = setup();
  s.addEvent('wish');
  s.lists.set('/wishes', [
    { id: 'other', title: '原筛选结果', category: 'life', status: 'todo' },
    { id: 'target', title: '目标愿望', category: 'life', status: 'done' },
  ]);
  const wishes = s.open('wishes');
  await wishes.show();
  wishes.ctx.filter = 'todo';
  wishes.ctx.query = '原筛选';
  const calendar = s.open('calendar');
  await calendar.show();
  calendar.click('查看来源');
  assert.equal(s.nav[0].method, 'switchTab');
  assert.equal(s.nav[0].options.url, '/pages/wishes/index');
  await wishes.show();
  assert.equal(wishes.has('来自共享日历'), true);
  assert.equal(wishes.has('目标愿望'), true);
  assert.equal(wishes.has('原筛选结果'), false);
  assert.equal(wishes.ctx.editor, false);
  wishes.click('查看全部');
  await wishes.show();
  assert.equal(wishes.has('原筛选结果'), true);
  assert.equal(wishes.has('目标愿望'), false);
});

test('a sealed letter stays sealed when opened from the calendar', async () => {
  const s = setup();
  s.addEvent('letter', 'target', true);
  s.lists.set('/letters', [
    {
      id: 'target',
      title: '未来的信',
      isLocked: true,
      content: '封存正文',
      unlockDate: date,
      authorId: 'owner',
    },
  ]);
  const calendar = s.open('calendar');
  await calendar.show();
  calendar.click('查看来源');
  assert.equal(s.nav[0].method, 'navigateTo');
  assert.equal(s.nav[0].options.url, '/pages/letters/index');
  const letters = s.open('letters');
  await letters.show();
  assert.equal(letters.has('未来的信'), true);
  assert.equal(letters.has('等待开启'), true);
  assert.equal(letters.has('封存正文'), false);
  assert.equal(letters.ctx.editor, false);
  assert.ok(s.requests.every(([, method]) => method === 'GET'));
});

test('a source is shown as missing only after a successful list read', async () => {
  const s = setup();
  s.addEvent('anniversary');
  s.lists.set('/anniversaries', new Error('事情暂时无法读取'));
  const calendar = s.open('calendar');
  await calendar.show();
  calendar.click('查看来源');
  const page = s.open('anniversaries');
  await page.show();
  assert.equal(page.has('事情暂时无法读取'), true);
  assert.equal(page.noticeMissing(), false);
  s.lists.set('/anniversaries', []);
  await page.click('重新加载');
  assert.equal(page.noticeMissing(), true);
  page.click('查看全部');
  assert.equal(page.noticeMissing(), undefined);
});

test('a failed tab navigation cannot leave a selection on a later manual visit', async () => {
  const s = setup();
  s.addEvent('memory');
  s.lists.set('/memories', [{ id: 'target', title: '回忆', kind: 'couple' }]);
  const calendar = s.open('calendar');
  await calendar.show();
  calendar.click('查看来源');
  assert.equal(s.nav[0].options.url, '/pages/memories/index');
  s.nav[0].options.fail?.({ errMsg: 'switchTab:fail' });
  const page = s.open('memories');
  await page.show();
  assert.equal(page.has('来自共享日历'), false);
  assert.equal(page.has('回忆'), true);
  assert.equal(s.toasts.length, 1);
});

test('leaving a source page clears its focus before a manual return', async () => {
  const s = setup();
  s.addEvent('wish');
  s.lists.set('/wishes', [{ id: 'target', title: '愿望' }]);
  const calendar = s.open('calendar');
  await calendar.show();
  calendar.click('查看来源');
  const page = s.open('wishes');
  await page.show();
  assert.equal(page.has('来自共享日历'), true);
  page.hide();
  await page.show();
  assert.equal(page.has('来自共享日历'), false);
  assert.equal(page.has('愿望'), true);
});

test('a growth source focuses one timeline entry and restores all entries when it is gone', async () => {
  const s = setup();
  s.addEvent('growth', 'growth-target');
  s.lists.set('/growth', [
    { id: 'growth-other', title: '其他成长', type: 'milestone', date },
    { id: 'growth-target', title: '目标成长', type: 'milestone', date },
  ]);
  s.lists.set('/baby', { id: 'baby-profile', name: '宝宝', birthday: '2025-01-01' });
  const calendar = s.open('calendar');
  await calendar.show();
  calendar.click('查看来源');
  const page = s.open('baby');
  await page.show();
  assert.equal(page.has('目标成长'), true);
  assert.equal(page.has('其他成长'), false);
  assert.equal(page.noticeMissing(), false);

  s.lists.set('/growth', [{ id: 'growth-other', title: '其他成长', type: 'milestone', date }]);
  await page.ctx.load();
  assert.equal(page.noticeMissing(), true);
  assert.equal(page.has('其他成长'), true);
});

test('a baby birthday source opens the matching profile and reports a deleted profile', async () => {
  const s = setup();
  s.addEvent('baby', 'baby-profile');
  s.lists.set('/baby', { id: 'baby-profile', name: '小星星', birthday: '2025-01-01' });
  const calendar = s.open('calendar');
  await calendar.show();
  calendar.click('查看来源');
  const page = s.open('baby');
  await page.show();
  assert.equal(page.has('小星星'), true);
  assert.equal(page.noticeMissing(), false);

  s.lists.set('/baby', null);
  await page.show();
  assert.equal(page.noticeMissing(), true);
  assert.equal(page.ctx.baby, null);
});
