import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import { createRenderer, h, proxyRefs, reactive, ref } from 'vue';
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
const renderer = createRenderer<any, any>({
  createElement: () => ({}),
  createText: () => ({}),
  createComment: () => ({}),
  setText() {},
  setElementText() {},
  patchProp() {},
  insert() {},
  remove() {},
  parentNode: () => null,
  nextSibling: () => null,
});
function evaluate(source: string, dependencies: Record<string, unknown> = {}) {
  const module = { exports: {} as any };
  const output = ts.transpileModule(source, {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  new Function('require', 'module', 'exports', output)(
    (specifier: string) =>
      dependencies[specifier] || (specifier.endsWith('.vue') ? {} : require(specifier)),
    module,
    module.exports,
  );
  return module.exports;
}
function setupSfc(relative: string, props: Record<string, unknown>, dependencies = {}) {
  const filename = fileURLToPath(new URL(relative, import.meta.url));
  assert.ok(existsSync(filename), 'The real growth chart component must exist');
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor;
  const script = compileScript(descriptor, { id: 'growth-chart-test' });
  const component = evaluate(script.content, dependencies).default;
  let exposed: any;
  const view = component.setup(props, { expose: (value: any) => (exposed = value) });
  const template = compileTemplate({
    source: descriptor.template!.content,
    filename,
    id: 'growth-chart-test',
    compilerOptions: {
      isCustomElement: (tag) => tag !== 'wd-segmented',
      bindingMetadata: script.bindings,
    },
  });
  assert.deepEqual(template.errors, []);
  const render = evaluate(template.code).render;
  const context = proxyRefs(view);
  return {
    view,
    exposed,
    render() {
      let rendered: any;
      const root = {};
      renderer.render(
        h({
          components: { 'wd-segmented': { name: 'wd-segmented', render: () => null } },
          render() {
            rendered = render(context, [], props, context);
            return null;
          },
        }),
        root,
      );
      renderer.render(null, root);
      return rendered;
    },
  };
}
function setupChart(records: any[] = []) {
  const props = reactive({ records });
  const provided: unknown[] = [];
  const chart = setupSfc('../src/components/GrowthChart.vue', props, {
    'uni-echarts': {},
    'uni-echarts/shared': {
      provideEcharts(core: unknown) {
        provided.push(core);
      },
    },
  });
  return { ...chart, props, provided };
}
function renderedChart(s: ReturnType<typeof setupChart>) {
  return nodes(s.render()).find((node) => node.props?.option);
}
function selectMetric(s: ReturnType<typeof setupChart>, value: string) {
  const segmented = nodes(s.render()).find((node) => node.type?.name === 'wd-segmented');
  assert.ok(segmented, 'The real template must use the Wot segmented control');
  assert.deepEqual(segmented.props.options, ['身高（cm）', '体重（kg）']);
  segmented.props['onUpdate:value'](value);
}
const measurements = [
  { id: 'latest-weight', date: '2026-11-19', weightKg: 7.2 },
  { id: 'same-later', date: '2026-11-10', createdAt: '2026-11-10T11:00:00Z', heightCm: 65 },
  { id: 'older', date: '2026-10-01', heightCm: 61, weightKg: 6 },
  { id: 'same-earlier', date: '2026-11-10', createdAt: '2026-11-10T10:00:00Z', heightCm: 64.5 },
  { id: 'health', date: '2026-11-12', type: 'health', heightCm: 66 },
  { id: 'invalid', date: '2026-11-20', heightCm: 0, weightKg: null },
];

test('growth chart provides the same actual on-demand ECharts core to its child', () => {
  const s = setupChart();
  assert.equal(s.provided.length, 1, 'The chart must provide ECharts without a compiler plugin');
  assert.equal(s.provided[0], require('echarts/core'));
});

test('measurement scope and ordering stay visible for empty and populated metrics', () => {
  for (const records of [[], measurements]) {
    const s = setupChart(records);
    for (const metric of ['身高（cm）', '体重（kg）']) {
      selectMetric(s, metric);
      const text = textOf(s.render());
      assert.ok(text.includes('包含全部有效测量，不随列表筛选变化'));
      assert.ok(text.includes('同日多次测量均保留'));
      assert.ok(text.includes('按测量记录顺序'));
    }
  }
});

test('growth chart guides each missing metric without creating a zero measurement', () => {
  const s = setupChart();
  assert.ok(textOf(s.render()).includes('成长曲线'));
  assert.ok(textOf(s.render()).includes('还没有身高测量'));
  assert.ok(textOf(s.render()).includes('填写身高'));
  assert.equal(renderedChart(s), undefined);
  selectMetric(s, '体重（kg）');
  assert.ok(textOf(s.render()).includes('还没有体重测量'));
  assert.ok(textOf(s.render()).includes('填写体重'));
  assert.equal(renderedChart(s), undefined);
});

test('real chart option retains all sorted height points and reports the latest height', () => {
  const s = setupChart(measurements);
  const chart = renderedChart(s);
  assert.ok(chart, 'Measurements must render the real uni-echarts option');
  assert.deepEqual(chart.props.option.xAxis.data, [
    '2026-10-01',
    '2026-11-10',
    '2026-11-10',
    '2026-11-12',
  ]);
  assert.deepEqual(chart.props.option.series[0].data, [61, 64.5, 65, 66]);
  assert.equal(chart.props.option.yAxis.name, 'cm');
  assert.equal(chart.props.option.yAxis.scale, true);
  assert.equal(chart.props.option.series[0].smooth, false);
  assert.equal(chart.props.option.series[0].showSymbol, true);
  assert.equal(chart.props.option.series[0].symbolSize, 7);
  assert.equal(chart.props.option.xAxis.type, 'category');
  assert.equal(chart.props.option.tooltip.trigger, 'axis');
  assert.equal(chart.props.option.tooltip.renderMode, 'richText');
  assert.equal(chart.props.option.tooltip.confine, true);
  assert.deepEqual(chart.props['custom-style'], { width: '100%', height: '240px' });
  assert.notEqual(chart.props.autoresize, false);
  const text = textOf(s.render());
  assert.ok(text.includes('最近身高'));
  assert.ok(text.includes('66 cm'));
  assert.ok(text.includes('2026-11-12'));
  assert.ok(text.includes('共 4 次记录'));
  assert.ok(text.includes('同日多次测量均保留'));
  assert.ok(text.includes('按测量记录顺序'));
});

test('Wot metric updates change actual option and latest summary independently', () => {
  const s = setupChart(measurements);
  selectMetric(s, '体重（kg）');
  const chart = renderedChart(s);
  assert.deepEqual(chart.props.option.xAxis.data, ['2026-10-01', '2026-11-19']);
  assert.deepEqual(chart.props.option.series[0].data, [6, 7.2]);
  assert.equal(chart.props.option.yAxis.name, 'kg');
  const text = textOf(s.render());
  assert.ok(text.includes('最近体重'));
  assert.ok(text.includes('7.2 kg'));
  assert.ok(text.includes('2026-11-19'));
  assert.ok(text.includes('共 2 次记录'));
});

test('a single point is plotted and explains how to obtain a line', () => {
  const s = setupChart([{ id: 'one', date: '2026-11-01', heightCm: 62.5 }]);
  assert.deepEqual(renderedChart(s).props.option.series[0].data, [62.5]);
  assert.ok(textOf(s.render()).includes('再添一条身高测量，就能连成曲线'));
  selectMetric(s, '体重（kg）');
  assert.equal(renderedChart(s), undefined);
  assert.ok(textOf(s.render()).includes('还没有体重测量'));
});

test('reactive record edits, additions and removals update the computed option', () => {
  const s = setupChart([{ id: 'one', date: '2026-11-01', heightCm: 62.5 }]);
  s.props.records[0].heightCm = 63;
  s.props.records.push({ id: 'two', date: '2026-11-03', heightCm: 64 });
  assert.deepEqual(renderedChart(s).props.option.series[0].data, [63, 64]);
  s.props.records = [{ id: 'historical', date: '2026-10-01', weightKg: 5.5 }];
  assert.equal(renderedChart(s), undefined);
  selectMetric(s, '体重（kg）');
  assert.deepEqual(renderedChart(s).props.option.series[0].data, [5.5]);
  s.props.records = [];
  assert.equal(renderedChart(s), undefined);
});

test('chart exposes the library resize method without assuming a canvas size', async () => {
  const s = setupChart(measurements);
  let resized = 0;
  s.view.chart.value = { resize: async () => resized++ };
  await s.exposed.resize();
  assert.equal(resized, 1);
});

function setupPage(previewPhotos = () => {}) {
  const shows: (() => unknown)[] = [];
  const resizes: (() => unknown)[] = [];
  const resource = {
    session: { theme: 'cream' },
    items: ref(
      measurements.map((record) => ({ ...record, type: record.type || 'growth', title: '测量' })),
    ),
    hasLoaded: ref(true),
    loading: ref(false),
    error: ref(''),
    saving: ref(false),
    editor: ref(false),
    formError: ref(''),
    save: async () => true,
    remove: async () => {},
  };
  const page = setupSfc(
    '../src/pages/baby/index.vue',
    {},
    {
      '@dcloudio/uni-app': {
        onShow: (callback: () => unknown) => shows.push(callback),
        onResize: (callback: () => unknown) => resizes.push(callback),
      },
      '../../lib/useResource': { useResource: () => resource },
      '../../lib/api': {
        request: async () => null,
        notify() {},
        assetUrl: () => '',
        previewPhotos,
      },
      '../../lib/domain': domain,
    },
  );
  return { ...page, resource, shows, resizes };
}
function pageChart(s: ReturnType<typeof setupPage>) {
  return nodes(s.render()).find((node) => node.props?.records);
}

test('baby page always supplies unfiltered records to the chart', () => {
  const s = setupPage();
  s.view.filter.value = 'milestone';
  s.view.query.value = '无匹配内容';
  assert.equal(s.view.filtered.value.length, 0);
  const chart = pageChart(s);
  assert.ok(chart, 'The baby page must render its growth chart');
  assert.equal(chart.props.records, s.resource.items.value);
  assert.equal(chart.props.records.length, measurements.length);
});

test('baby page waits for a successful first read and keeps the chart on refresh failure', () => {
  const s = setupPage();
  s.resource.hasLoaded.value = false;
  s.resource.loading.value = true;
  assert.equal(pageChart(s), undefined);
  s.resource.loading.value = false;
  s.resource.error.value = '成长记录读取失败';
  assert.equal(pageChart(s), undefined);
  s.resource.error.value = '';
  s.resource.hasLoaded.value = true;
  assert.ok(pageChart(s));
  s.resource.error.value = '成长记录刷新失败';
  assert.equal(pageChart(s)?.props.records, s.resource.items.value);
});

test('baby page forwards size changes and returning to the page after its next render', async () => {
  const s = setupPage();
  let resized = 0;
  assert.ok(s.view.growthChart, 'The page must keep the real chart component reference');
  s.view.growthChart.value = { resize: async () => resized++ };
  assert.equal(s.resizes.length, 1);
  await s.resizes[0]();
  assert.equal(resized, 1);
  await Promise.all(s.shows.map((show) => show()));
  assert.equal(resized, 2);
});

test('baby page album groups photos from growth records and opens the selected photo', () => {
  const selected: unknown[][] = [];
  const s = setupPage((assets: unknown[], index: number) => selected.push([assets, index]));
  s.resource.items.value = [
    {
      id: 'older',
      date: '2026-11-01',
      title: '第一次抬头',
      type: 'milestone',
      assets: [{ id: 'older-photo', url: '/older' }],
    },
    {
      id: 'newer',
      date: '2026-11-03',
      title: '今天会笑了',
      type: 'milestone',
      assets: [{ id: 'new-photo', url: '/new' }],
    },
  ];
  const albumPhotos = s.view.albumPhotos.value;
  assert.deepEqual(
    albumPhotos.map((photo: any) => [photo.id, photo.title, photo.date]),
    [
      ['new-photo', '今天会笑了', '2026-11-03'],
      ['older-photo', '第一次抬头', '2026-11-01'],
    ],
  );
  const gallery = nodes(s.render()).filter(
    (node) => node.props?.class === 'baby-album-photo ui-reset',
  );
  assert.equal(gallery.length, 2);
  gallery[1].props.onClick();
  assert.deepEqual(selected, [[albumPhotos.map((photo: any) => photo.asset), 1]]);
});
