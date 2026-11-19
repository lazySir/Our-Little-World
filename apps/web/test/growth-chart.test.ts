import test from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { parse, compileScript, compileTemplate } from '@vue/compiler-sfc';
import { reactive, proxyRefs, ref } from 'vue';
import ts from 'typescript';
import * as domain from '../src/domain.ts';

const require = createRequire(import.meta.url);
const chartComponent = { name: 'GrowthChart' };
const nodes = (node: any): any[] =>
  Array.isArray(node)
    ? node.flatMap(nodes)
    : node && typeof node === 'object'
      ? [
          node,
          ...nodes(
            typeof node.children?.default === 'function' ? node.children.default() : node.children,
          ),
        ]
      : [];
function component(file: string, props: any = {}, dependencies: Record<string, any> = {}) {
  const filename = fileURLToPath(new URL(file, import.meta.url));
  assert.ok(existsSync(filename), 'A reusable growth chart component must exist');
  const descriptor = parse(readFileSync(filename, 'utf8'), { filename }).descriptor;
  const script = compileScript(descriptor, { id: 'growth-chart-test' });
  const deps = {
    'vue-echarts': {},
    'echarts/core': { use() {} },
    'echarts/charts': { LineChart: {} },
    'echarts/components': { GridComponent: {}, TooltipComponent: {} },
    'echarts/renderers': { CanvasRenderer: {} },
    ...dependencies,
  };
  function execute(source: string, overrides = {}) {
    const module = { exports: {} as any };
    new Function(
      'require',
      'module',
      'exports',
      ts.transpileModule(source, {
        compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
      }).outputText,
    )(
      (name: string) =>
        ({ ...deps, ...overrides })[name] || (name.endsWith('.vue') ? {} : require(name)),
      module,
      module.exports,
    );
    return module.exports;
  }
  const view = execute(script.content).default.setup(props, { expose() {} });
  const template = compileTemplate({
    source: descriptor.template!.content,
    filename,
    id: 'growth-chart-test',
    compilerOptions: { isCustomElement: () => true, bindingMetadata: script.bindings },
  });
  assert.deepEqual(template.errors, []);
  const context = proxyRefs({ ...view });
  const render = execute(template.code, {
    vue: {
      ...require('vue'),
      resolveComponent: (name: string) => name,
      withCtx: (slot: any) => slot,
      withDirectives: (vnode: any) => vnode,
    },
  }).render;
  return { view, nodes: () => nodes(render(context, [], props, context)) };
}
const records = () => [
  { id: 'weight', date: '2026-11-03', heightCm: null, weightKg: 6.2 },
  {
    id: 'second',
    date: '2026-11-02',
    heightCm: 60.5,
    weightKg: 6,
    createdAt: '2026-11-02T09:00:00Z',
  },
  {
    id: 'first',
    date: '2026-11-02',
    heightCm: 60,
    weightKg: null,
    createdAt: '2026-11-02T08:00:00Z',
  },
  { id: 'historic', date: '2026-10-01', heightCm: 55.2, weightKg: null },
];

test('Web chart keeps same-day measurements and independent metric series in calendar order', () => {
  const s = component('../src/components/GrowthChart.vue', { records: records() });
  assert.deepEqual(s.view.option.value.xAxis.data, ['2026-10-01', '2026-11-02', '2026-11-02']);
  assert.deepEqual(s.view.option.value.series[0].data, [55.2, 60, 60.5]);
  assert.equal(s.view.option.value.yAxis.name, 'cm');
  s.view.metric.value = 'weight';
  assert.deepEqual(s.view.option.value.xAxis.data, ['2026-11-02', '2026-11-03']);
  assert.deepEqual(s.view.option.value.series[0].data, [6, 6.2]);
  assert.equal(s.view.option.value.yAxis.name, 'kg');
});

test('Web chart shows separate empty and single-point states without inventing zeros', () => {
  const props = reactive({ records: [] as any[] });
  const s = component('../src/components/GrowthChart.vue', props);
  assert.ok(s.nodes().some((node) => node.children === '还没有身高记录'));
  assert.equal(
    s.nodes().filter((node) => node.props?.class?.includes?.('growth-canvas')).length,
    0,
  );
  props.records = [{ id: 'single', date: '2026-11-01', heightCm: 58.1 }];
  assert.deepEqual(s.view.option.value.series[0].data, [58.1]);
  assert.equal(s.view.option.value.series[0].showSymbol, true);
  assert.ok(
    s
      .nodes()
      .some((node) => typeof node.children === 'string' && node.children.includes('再添一条')),
  );
  s.view.metric.value = 'weight';
  assert.ok(s.nodes().some((node) => node.children === '还没有体重记录'));
  assert.deepEqual(s.view.option.value.series[0].data, []);
});

test('Web chart responds to edit and deletion and keeps tooltips in controlled plain text', () => {
  const props = reactive({ records: records() });
  const s = component('../src/components/GrowthChart.vue', props);
  props.records[1].heightCm = 61;
  assert.deepEqual(s.view.option.value.series[0].data, [55.2, 60, 61]);
  props.records = props.records.filter((row) => row.id !== 'second');
  assert.deepEqual(s.view.option.value.series[0].data, [55.2, 60]);
  assert.equal(s.view.option.value.tooltip.renderMode, 'richText');
  assert.equal(s.view.option.value.tooltip.confine, true);
  assert.equal(s.view.option.value.tooltip.valueFormatter(60), '60 cm');
  assert.equal(s.view.option.value.series[0].smooth, false);
});

test('Web baby summary retains each latest metric and passes original records despite list filtering', () => {
  const all = ref(
    records().map((row) => ({ ...row, type: row.id === 'second' ? 'health' : 'growth' })),
  );
  const s = component(
    '../src/pages/BabyPage.vue',
    {},
    {
      vue: { ...require('vue'), onMounted() {} },
      '../components/GrowthChart.vue': chartComponent,
      '../api': { api: { get: async () => null }, assetUrl: () => '' },
      '../domain': domain,
      '../composables/resource': {
        useResource: () => ({
          items: all,
          loading: ref(false),
          error: ref(''),
          saving: ref(false),
          load() {},
          save() {},
          remove() {},
        }),
      },
    },
  );
  assert.equal(s.view.latestHeight?.value?.value, 60.5);
  assert.equal(s.view.latestWeight?.value?.value, 6.2);
  const chartWithoutBabyProfile = s
    .nodes()
    .find((node) => node.type === chartComponent || node.type === 'GrowthChart');
  assert.ok(chartWithoutBabyProfile, 'Optional baby profile must not hide recorded measurements');
  assert.equal(chartWithoutBabyProfile.props.records, all.value);
  s.view.baby.value = { name: '小团子' };
  s.view.tab.value = 'health';
  assert.equal(s.view.filtered.value.length, 1);
  const chart = s
    .nodes()
    .find((node) => node.type === chartComponent || node.type === 'GrowthChart');
  assert.ok(chart, 'The original resource data must reach the chart component');
  assert.equal(chart.props.records, all.value);
});
