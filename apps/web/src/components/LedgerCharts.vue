<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick } from 'vue';
import * as echarts from 'echarts/core';
import { PieChart, BarChart } from 'echarts/charts';
import { TooltipComponent, LegendComponent, GridComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { money } from '../domain';
echarts.use([PieChart, BarChart, TooltipComponent, LegendComponent, GridComponent, CanvasRenderer]);
const props = defineProps<{ stats: any }>();
const categoryEl = ref<HTMLElement>(),
  trendEl = ref<HTMLElement>();
let categoryChart: echarts.ECharts, trendChart: echarts.ECharts, observer: ResizeObserver;
const colors = [
  '#9ead86',
  '#d7b197',
  '#d7c58d',
  '#a4bdb6',
  '#c5bdca',
  '#c3c69e',
  '#d1b1ac',
  '#b0bccb',
];
function draw() {
  if (!categoryChart || !trendChart) return;
  categoryChart.setOption({
    color: colors,
    tooltip: { trigger: 'item', formatter: (p: any) => `${p.name}<br/>¥ ${money(p.value)}` },
    legend: {
      bottom: 0,
      icon: 'circle',
      itemWidth: 7,
      textStyle: { fontSize: 10, color: '#a39a84' },
    },
    series: [
      {
        type: 'pie',
        radius: ['45%', '70%'],
        center: ['50%', '42%'],
        avoidLabelOverlap: true,
        label: { show: false },
        data: props.stats.categories,
      },
    ],
  });
  const days = Object.keys(props.stats.days).sort();
  trendChart.setOption({
    color: ['#9ead86', '#d5b29c'],
    tooltip: { trigger: 'axis', valueFormatter: (v: any) => `¥ ${money(v)}` },
    grid: { top: 23, left: 45, bottom: 33, right: 15 },
    legend: { top: 0, icon: 'circle', itemWidth: 7, textStyle: { fontSize: 10, color: '#a39a84' } },
    xAxis: {
      type: 'category',
      data: days.map((d) => d.slice(5)),
      axisLabel: { color: '#ada48f', fontSize: 9 },
      axisTick: { show: false },
      axisLine: { lineStyle: { color: '#e9e5d9' } },
    },
    yAxis: {
      type: 'value',
      axisLabel: { color: '#ada48f', fontSize: 9, formatter: (v: number) => v / 100 },
      splitLine: { lineStyle: { color: '#f0ede4', type: 'dashed' } },
    },
    series: [
      {
        name: '收入',
        type: 'bar',
        barMaxWidth: 15,
        itemStyle: { borderRadius: [3, 3, 0, 0] },
        data: days.map((d) => props.stats.days[d].income),
      },
      {
        name: '支出',
        type: 'bar',
        barMaxWidth: 15,
        itemStyle: { borderRadius: [3, 3, 0, 0] },
        data: days.map((d) => props.stats.days[d].expense),
      },
    ],
  });
}
onMounted(async () => {
  await nextTick();
  categoryChart = echarts.init(categoryEl.value);
  trendChart = echarts.init(trendEl.value);
  draw();
  observer = new ResizeObserver(() => {
    categoryChart.resize();
    trendChart.resize();
  });
  observer.observe(categoryEl.value);
  observer.observe(trendEl.value);
});
watch(
  () => props.stats,
  () => nextTick(draw),
  { deep: true },
);
onUnmounted(() => {
  observer?.disconnect();
  categoryChart?.dispose();
  trendChart?.dispose();
});
</script>
<template>
  <div class="ledger-charts">
    <section class="panel">
      <div class="section-head">
        <h3>支出都花在哪里</h3>
        <span class="muted">分类统计</span>
      </div>
      <div ref="categoryEl" class="chart-canvas" role="img" aria-label="本月支出分类饼图" />
    </section>
    <section class="panel">
      <div class="section-head">
        <h3>这个月的生活曲线</h3>
        <span class="muted">每日收支 · 元</span>
      </div>
      <div ref="trendEl" class="chart-canvas" role="img" aria-label="本月每日收支柱状图" />
    </section>
  </div>
</template>
