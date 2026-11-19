import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { compileScript, parse } from '@vue/compiler-sfc';
import * as Vue from 'vue';
import ts from 'typescript';
import { resolveConfig, type Plugin } from 'vite';

const require = createRequire(import.meta.url);
const filename = fileURLToPath(import.meta.resolve('uni-echarts'));
const publishedSource = readFileSync(filename, 'utf8');
const sharedFilename = resolve(dirname(filename), '../../shared-core.js');
const publishedSharedSource = readFileSync(sharedFilename, 'utf8');
// Run these same races against the untouched release to retain RED evidence.
const unpatched = process.env.UNI_ECHARTS_TEST_UNPATCHED === '1';
const plugin = unpatched
  ? null
  : (await import('../scripts/echarts-lifecycle')).uniEchartsLifecycle();
function transform(source = publishedSource, id = filename, lifecyclePlugin = plugin): any {
  const hook = lifecyclePlugin?.transform;
  const handler = typeof hook === 'function' ? hook : hook?.handler;
  assert.equal(typeof handler, 'function');
  return Reflect.apply(handler as Function, {}, [source, id]);
}

function webSource(source: string) {
  const enabled = [true];
  return source
    .split('\n')
    .filter((line) => {
      const directive = line.match(/^\s*\/\/ #(ifdef|ifndef|endif)\b(.*)$/);
      if (!directive) return enabled.at(-1);
      const [, kind, expression] = directive;
      if (kind === 'endif') enabled.pop();
      else {
        const web = expression
          .trim()
          .split(/\s*\|\|\s*/)
          .includes('WEB');
        enabled.push(enabled.at(-1)! && (kind === 'ifdef' ? web : !web));
      }
      return false;
    })
    .join('\n');
}
const descriptor = parse(webSource(unpatched ? publishedSource : transform().code), {
  filename,
}).descriptor;
const compiled = ts.transpileModule(
  compileScript(descriptor, { id: 'echarts-lifecycle' }).content,
  {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  },
).outputText;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((yes, no) => {
    resolve = yes;
    reject = no;
  });
  return { promise, resolve, reject };
}
const rectangle = () => ({
  top: 0,
  left: 0,
  width: 320,
  height: 240,
  node: { getContext: () => ({}) },
});
type HarnessOptions = {
  sleep?: ReturnType<typeof deferred<void>>;
  tick?: ReturnType<typeof deferred<void>>;
  query?: () => Promise<ReturnType<typeof rectangle>>;
  autoresize?: boolean;
  initError?: Error;
};
function setup(options: HarnessOptions = {}) {
  const hooks = { mounted: [] as (() => void)[], beforeUnmount: [] as (() => void)[] };
  const calls = { sleep: 0, query: 0, init: 0, dispose: 0, canvas: 0, setup: 0 };
  const late: string[] = [];
  const resizes: unknown[] = [];
  const commits: unknown[] = [];
  let unmounted = false;
  let disposed = false;
  let onInited: (() => void) | undefined;
  const record = (name: string) => {
    if (unmounted) late.push(name);
  };
  const instance = {
    isDisposed: () => disposed,
    dispose() {
      disposed = true;
      calls.dispose++;
    },
    getZr: () => ({ on() {} }),
    on() {},
    resize(value: unknown) {
      record('resize');
      assert.equal(disposed, false, 'A disposed ECharts instance must not resize');
      resizes.push(value);
    },
    setOption(value: unknown) {
      record('setOption');
      assert.equal(disposed, false, 'A disposed ECharts instance must not receive options');
      commits.push(value);
    },
  };
  const shared = {
    canIUseCanvas2d: () => true,
    defaultTo: (value: any, fallback: any) =>
      value == null || Number.isNaN(value) ? fallback : value,
    getIsPc: () => false,
    getWindowInfo: () => ({ pixelRatio: 1 }),
    isEmpty: (value: any) =>
      value == null ||
      ((typeof value === 'object' || typeof value === 'string') && Object.keys(value).length === 0),
    isMpAlipay: false,
    querySelect: () => {
      calls.query++;
      record('query');
      return options.query?.() ?? Promise.resolve(rectangle());
    },
    setupEchartsCanvas() {
      record('setupEchartsCanvas');
      calls.setup++;
    },
    sleep: () => {
      calls.sleep++;
      record('sleep');
      return options.sleep?.promise ?? Promise.resolve();
    },
    UniCanvas: class {
      constructor() {
        calls.canvas++;
      }
    },
    useAutoresize() {},
    useEcharts: () => ({
      init() {
        record('init');
        calls.init++;
        if (options.initError) throw options.initError;
        return instance;
      },
    }),
    useEchartsOption: (_key: unknown, read: () => unknown) => ({
      innerOption: Vue.computed(read),
      injectOption: Vue.ref(null),
    }),
    useEchartsTheme: (read: () => unknown) => ({ innerTheme: Vue.computed(read) }),
    useEchartsInitOptions: (read: () => unknown) => ({ innerInitOptions: Vue.computed(read) }),
    useEchartsUpdateOptions: (read: () => unknown) => ({ innerUpdateOptions: Vue.computed(read) }),
    useEchartsMouseWheel() {},
    useEchartsTouch: () => ({ cleanup() {} }),
    useLoading() {},
    usePageVisible: () => ({ visible: Vue.ref(true) }),
    usePublicApi: () => ({}),
    useUid: () => 1,
    useVueThis: () => ({}),
  };
  const module = { exports: {} as any };
  new Function('require', 'module', 'exports', compiled)(
    (id: string) => {
      if (id === 'vue')
        return {
          ...Vue,
          onMounted: (fn: () => void) => hooks.mounted.push(fn),
          onBeforeUnmount: (fn: () => void) => hooks.beforeUnmount.push(fn),
          nextTick: () => options.tick?.promise ?? Vue.nextTick(),
        };
      if (id === '../../shared-core') return shared;
      if (id === './events') return { ECHARTS_EVENTS: [], EVENTS: [] };
      return require(id);
    },
    module,
    module.exports,
  );
  const scope = Vue.effectScope();
  const option = { series: [{ type: 'line', data: [60, 64] }] };
  const view = scope.run(() =>
    module.exports.default.setup(
      Vue.reactive({ option, initDelay: 30, autoresize: options.autoresize ?? false }),
      { expose() {}, emit: () => onInited?.() },
    ),
  );
  view.root.value = { $el: { offsetWidth: 320, offsetHeight: 240 } };
  return {
    view,
    calls,
    late,
    instance,
    commits,
    resizes,
    option,
    onInited(fn: () => void) {
      onInited = fn;
    },
    mount(): Promise<void> {
      hooks.mounted.forEach((fn) => fn());
      assert.ok(view.initTask instanceof Promise, 'Observe the real mounted initTask immediately');
      return view.initTask;
    },
    unmount() {
      unmounted = true;
      hooks.beforeUnmount.forEach((fn) => fn());
      scope.stop();
      view.root.value = null;
    },
  };
}
async function flush() {
  for (let i = 0; i < 8; i++) await Promise.resolve();
}

test('unmount during the published init delay prevents later canvas queries or chart creation', async () => {
  const sleep = deferred<void>();
  const s = setup({ sleep });
  const task = s.mount();
  s.unmount();
  sleep.resolve(undefined);
  await task;
  assert.equal(s.calls.query, 0);
  assert.equal(s.calls.init, 0);
  assert.equal(s.commits.length, 0);
  assert.deepEqual(s.late, []);
});

test('init and public setOption after unmount never restart delayed initialization', async () => {
  const s = setup();
  s.unmount();
  await s.view.init();
  await s.view._init();
  s.view.setOption(s.option);
  await flush();
  assert.equal(s.calls.sleep, 0);
  assert.equal(s.calls.query, 0);
  assert.equal(s.calls.init, 0);
});

test('a canvas query resolving after unmount cannot create or commit a chart', async () => {
  const query = deferred<ReturnType<typeof rectangle>>();
  const s = setup({ query: () => query.promise });
  const task = s.mount();
  await flush();
  assert.equal(s.calls.query, 1);
  s.unmount();
  query.resolve(rectangle());
  await task;
  assert.equal(s.calls.init, 0);
  assert.equal(s.calls.setup, 0);
  assert.equal(s.commits.length, 0);
});

test('canvas-query rejection after unmount settles the real mounted initTask safely', async () => {
  const query = deferred<ReturnType<typeof rectangle>>();
  const s = setup({ query: () => query.promise });
  const task = s.mount();
  const settled = assert.doesNotReject(task);
  await flush();
  s.unmount();
  query.reject(new Error('canvas no longer exists'));
  await settled;
  assert.equal(s.calls.init, 0);
  assert.deepEqual(s.late, []);
});

test('unmount while autoresize awaits nextTick prevents late resize and setOption', async () => {
  const tick = deferred<void>();
  const s = setup({ tick, autoresize: true });
  const task = s.mount();
  await flush();
  assert.equal(s.calls.init, 1);
  s.unmount();
  tick.resolve(undefined);
  await task;
  assert.equal(s.calls.dispose, 1);
  assert.equal(s.resizes.length, 0);
  assert.equal(s.commits.length, 0);
  assert.deepEqual(s.late, []);
});

test('an inited listener that unmounts the component cannot commit to its disposed chart', async () => {
  const s = setup();
  s.onInited(() => s.unmount());
  await s.mount();
  assert.equal(s.calls.dispose, 1);
  assert.equal(s.commits.length, 0);
  assert.deepEqual(s.late, []);
});

test('active published component still initializes, commits and resizes normally', async () => {
  const s = setup({ autoresize: true });
  await s.mount();
  assert.equal(s.calls.init, 1);
  assert.deepEqual(s.commits, [s.option]);
  assert.deepEqual(s.resizes, [{ width: 320, height: 240 }]);
  await s.view.resize();
  await s.view.resize({ width: 400, height: 300, animation: { duration: 0 } });
  assert.deepEqual(s.resizes.slice(1), [
    { width: 320, height: 240 },
    { width: 400, height: 300, animation: { duration: 0 } },
  ]);
  s.unmount();
});

for (const reject of [false, true]) {
  test(
    'resize query ' +
      (reject ? 'rejecting' : 'resolving') +
      ' after unmount never touches a null chart',
    async () => {
      let query = Promise.resolve(rectangle());
      const s = setup({ query: () => query });
      await s.mount();
      const pending = deferred<ReturnType<typeof rectangle>>();
      query = pending.promise;
      const resized = assert.doesNotReject(s.view.resize());
      s.unmount();
      if (reject) pending.reject(new Error('canvas no longer exists'));
      else pending.resolve(rectangle());
      await resized;
      assert.equal(s.resizes.length, 0);
      assert.deepEqual(s.late, []);
    },
  );
}

for (const replacement of ['replaced', 'disposed']) {
  test('resize query ignores its ' + replacement + ' original instance', async () => {
    let query = Promise.resolve(rectangle());
    const s = setup({ query: () => query });
    await s.mount();
    const pending = deferred<ReturnType<typeof rectangle>>();
    query = pending.promise;
    const resized = s.view.resize();
    if (replacement === 'replaced')
      s.view.chart.value = {
        ...s.instance,
        resize: () => assert.fail('Must not resize replacement'),
      };
    else s.instance.dispose();
    pending.resolve(rectangle());
    await resized;
    assert.equal(s.resizes.length, 0);
    s.unmount();
  });
}

test('active canvas-query and ECharts initialization failures still reject', async () => {
  for (const phase of ['query', 'init']) {
    const error = new Error('active ' + phase + ' failed');
    const s = setup(
      phase === 'query' ? { query: () => Promise.reject(error) } : { initError: error },
    );
    await assert.rejects(s.mount(), (actual) => actual === error);
    s.unmount();
  }
});

test('an active resize-query failure still rejects', async () => {
  const error = new Error('active resize query failed');
  let fail = false;
  const s = setup({ query: () => (fail ? Promise.reject(error) : Promise.resolve(rectangle())) });
  await s.mount();
  fail = true;
  await assert.rejects(s.view.resize(), (actual) => actual === error);
  s.unmount();
});

test(
  'pre-transform patches only the resolved original SFC and retains its source map',
  { skip: unpatched },
  () => {
    assert.equal(plugin!.enforce, 'pre');
    assert.equal(transform(publishedSource, filename + '?vue&type=script'), null);
    assert.equal(transform(publishedSource, filename + '?raw'), null);
    assert.equal(transform(publishedSource, filename + '.copy.vue'), null);
    assert.equal(transform(publishedSource, '/another-package/uni-echarts.vue'), null);
    const result = transform();
    assert.notEqual(result.code, publishedSource);
    const map = JSON.parse(JSON.stringify(result.map));
    assert.deepEqual(map.sources, [filename.replaceAll('\\', '/')]);
    assert.deepEqual(map.sourcesContent, [publishedSource]);
    assert.equal(map.sources.length, 1);
    assert.ok(map.mappings.length > 0);
    assert.equal(transform(publishedSource, filename.replaceAll('\\', '/')).code, result.code);
  },
);

test(
  'pre-transform resolves shared-core and maps published and generated files to their own source',
  { skip: unpatched },
  async () => {
    const result = transform(publishedSharedSource, sharedFilename);
    assert.ok(result, 'The default plugin must recognize src/shared-core.js');
    assert.notEqual(result.code, publishedSharedSource);
    const map = JSON.parse(JSON.stringify(result.map));
    assert.deepEqual(map.sources, [sharedFilename.replaceAll('\\', '/')]);
    assert.deepEqual(map.sourcesContent, [publishedSharedSource]);
    assert.ok(map.mappings.length > 0);

    for (const anchor of [
      'let lastMoveEvent = null;',
      '\tfunction onStart(event) {',
      '\tfunction onEnd(event) {',
      '\tfunction cleanup() {',
    ]) {
      assert.throws(
        () =>
          transform(
            publishedSharedSource.replace(
              anchor,
              anchor === 'let lastMoveEvent = null;'
                ? 'let lastMoveEvent = undefined;'
                : anchor + ' // upstream changed',
            ),
            sharedFilename,
          ),
        /uni-echarts@2\.5\.4 lifecycle patch.*expected exactly one.*revalidate/i,
        anchor,
      );
    }
    assert.throws(
      () => transform(publishedSharedSource + '\n' + publishedSharedSource, sharedFilename),
      /uni-echarts@2\.5\.4 lifecycle patch.*expected exactly one.*revalidate/i,
    );

    const generatedShared = fileURLToPath(
      new URL('../src/uni_modules/uni-echarts/src/shared-core.js', import.meta.url),
    ).replaceAll('\\', '/');
    const generatedSource = readFileSync(generatedShared, 'utf8');
    const configured = (await import('../scripts/prepare-echarts')).uniEchartsPaths;
    const generatedPlugin = (await import('../scripts/echarts-lifecycle')).uniEchartsLifecycle(
      configured.component,
      configured.sharedCore,
    );
    const generated = transform(generatedSource, generatedShared, generatedPlugin);
    assert.ok(generated, 'The configured plugin must recognize the app-local copy');
    assert.notEqual(generated.code, generatedSource);
    const generatedMap = JSON.parse(JSON.stringify(generated.map));
    assert.deepEqual(generatedMap.sources, [generatedShared]);
    assert.deepEqual(generatedMap.sourcesContent, [generatedSource]);
    assert.ok(generatedMap.mappings.length > 0);
    assert.equal(transform(publishedSharedSource, sharedFilename + '?raw'), null);
    assert.equal(
      transform(
        publishedSharedSource,
        fileURLToPath(
          new URL('../src/uni_modules/uni-echarts/src/shared-core.js', import.meta.url),
        ),
      ),
      null,
      'The default plugin must not patch an unrelated copied path',
    );
  },
);

test(
  'source drift or duplicate patch anchors fail closed with an upgrade explanation',
  { skip: unpatched },
  () => {
    const anchors = [
      'let deferInit = false;',
      '  const context = await getContext();',
      '  const _commit = () => {',
      '    if (isEmpty(opt)) {',
      '    await nextTick();',
      'function init(option) {',
      'async function resize(options = {}) {',
      'onBeforeUnmount(() => {',
    ];
    for (const anchor of anchors) {
      assert.throws(
        () => transform(publishedSource.replace(anchor, anchor + ' // upstream changed')),
        /uni-echarts@2\.5\.4 lifecycle patch.*expected exactly one.*revalidate/i,
        anchor,
      );
    }
    assert.throws(
      () => transform(publishedSource + '\n' + publishedSource),
      /uni-echarts@2\.5\.4 lifecycle patch.*expected exactly one.*revalidate/i,
    );
  },
);

test(
  'a relocated package SFC is patched exclusively without changing installed-source auditing',
  { skip: unpatched },
  async () => {
    const { uniEchartsLifecycle } = await import('../scripts/echarts-lifecycle');
    const relocatedFilename = fileURLToPath(
      new URL(
        '../src/uni_modules/uni-echarts/src/components/uni-echarts/uni-echarts.vue',
        import.meta.url,
      ),
    );
    const relocated = uniEchartsLifecycle(relocatedFilename);
    const result = transform(publishedSource, relocatedFilename, relocated);
    assert.ok(result, 'The explicit relocated SFC must receive the same strict lifecycle patch');
    assert.equal(result.code, transform().code);
    assert.equal(transform(publishedSource, filename, relocated), null);
    assert.equal(
      transform(publishedSource, relocatedFilename + '?vue&type=script', relocated),
      null,
    );
    assert.equal(transform(publishedSource, relocatedFilename + '.copy.vue', relocated), null);
    const map = JSON.parse(JSON.stringify(result.map));
    assert.deepEqual(map.sourcesContent, [publishedSource]);
    assert.deepEqual(map.sources, [relocatedFilename.replaceAll('\\', '/')]);
    assert.throws(
      () =>
        transform(
          publishedSource.replace('let deferInit = false;', 'let deferInit = true;'),
          relocatedFilename,
          relocated,
        ),
      /uni-echarts@2\.5\.4 lifecycle patch.*expected exactly one.*revalidate/i,
    );
  },
);

for (const platform of ['h5', 'mp-weixin']) {
  test(
    'Vite orders the patch before the real uni ' + platform + ' conditional preprocessor',
    { skip: unpatched },
    async () => {
      const { uniPrePlugin, initPreContext } = require('@dcloudio/uni-cli-shared');
      initPreContext(platform);
      try {
        for (const command of ['serve', 'build'] as const) {
          const config = await resolveConfig(
            {
              configFile: false,
              envFile: false,
              logLevel: 'silent',
              plugins: [
                plugin!,
                {
                  name: 'test-uni-pre-installation',
                  configResolved(resolved) {
                    // The real uni configResolved inserts uni:pre before user pre plugins.
                    (resolved.plugins as Plugin[]).unshift(uniPrePlugin(resolved, {}));
                  },
                },
              ],
            },
            command,
          );
          const candidates = config
            .getSortedPlugins('transform')
            .filter((candidate) => candidate.name === 'uni:pre' || candidate === plugin);
          let source = publishedSource;
          for (const candidate of candidates) {
            const hook = candidate.transform;
            const handler = typeof hook === 'function' ? hook : hook.handler;
            const result = await Reflect.apply(handler, { getCombinedSourcemap: () => null }, [
              source,
              filename,
            ]);
            if (result) source = typeof result === 'string' ? result : result.code;
          }
          assert.equal(candidates[0], plugin, command + ' must patch the original full SFC');
          assert.ok(source.includes('let isUnmounted = false;'));
          assert.ok(source.includes('isUnmounted = true;'));
          assert.ok(source.includes('chart.value !== instance || instance.isDisposed()'));
          assert.equal(source.includes('    await nextTick();'), platform === 'h5');
          assert.deepEqual(parse(source, { filename }).errors, []);
        }
      } finally {
        initPreContext('h5');
      }
    },
  );
}
