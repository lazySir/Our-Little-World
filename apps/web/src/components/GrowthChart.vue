<script setup lang="ts">
import { computed, ref } from 'vue';
import VChart from 'vue-echarts';
import { use } from 'echarts/core';
import { LineChart } from 'echarts/charts';
import { GridComponent, TooltipComponent } from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import { projectGrowthMeasurements, type GrowthMeasurement } from '@our-little-world/shared/growth';

use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);
const props = defineProps<{ records: GrowthMeasurement[] }>();
const metric = ref<'height' | 'weight'>('height');
const metrics = [
  { label: '身高（cm）', value: 'height' },
  { label: '体重（kg）', value: 'weight' },
];
const measurements = computed(() => projectGrowthMeasurements(props.records));
const points = computed(() => measurements.value[metric.value]);
const label = computed(() => (metric.value === 'height' ? '身高' : '体重'));
const unit = computed(() => (metric.value === 'height' ? 'cm' : 'kg'));
const latest = computed(() => points.value.at(-1));
const option = computed(() => ({
  animation: false,
  color: ['#8f9f76'],
  textStyle: { fontFamily: 'sans-serif' },
  grid: { top: 30, left: 48, right: 18, bottom: 32 },
  tooltip: {
    trigger: 'axis',
    renderMode: 'richText',
    confine: true,
    valueFormatter: (value: number) => `${value} ${unit.value}`,
  },
  xAxis: {
    type: 'category',
    data: points.value.map((point) => point.date),
    axisTick: { show: false },
    axisLine: { lineStyle: { color: '#e9e5d9' } },
    axisLabel: { color: '#827b6c', fontSize: 11, hideOverlap: true },
  },
  yAxis: {
    type: 'value',
    name: unit.value,
    scale: true,
    nameTextStyle: { color: '#827b6c', fontSize: 12 },
    axisLabel: { color: '#827b6c', fontSize: 11 },
    splitLine: { lineStyle: { color: '#eee9dd', type: 'dashed' } },
  },
  series: [
    {
      name: label.value,
      type: 'line',
      data: points.value.map((point) => point.value),
      smooth: false,
      showSymbol: true,
      symbolSize: 7,
      lineStyle: { width: 2 },
      itemStyle: { borderWidth: 2, borderColor: '#fffdf8' },
    },
  ],
}));
</script>

<template>
  <section class="growth-chart panel mb-6 min-w-0 p-5 sm:p-6" aria-label="宝宝成长曲线">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <h3>成长曲线</h3>
      <el-segmented v-model="metric" :options="metrics" aria-label="选择测量指标" />
    </div>
    <template v-if="points.length">
      <div
        class="growth-summary mt-5 flex flex-wrap items-baseline gap-x-3 gap-y-1"
        aria-live="polite"
      >
        <span class="muted">最近{{ label }}</span>
        <strong class="text-xl"
          >{{ latest?.value }} <span class="text-sm font-normal">{{ unit }}</span></strong
        >
        <span class="muted text-sm">{{ latest?.date }} · 共 {{ points.length }} 次记录</span>
      </div>
      <div class="h-[260px] min-w-0">
        <VChart
          class="growth-canvas w-full"
          :option="option"
          :update-options="{ notMerge: true }"
          autoresize
          role="img"
          :aria-label="`${label}成长曲线，共${points.length}次记录，最近${latest?.date}：${latest?.value}${unit}`"
        />
      </div>
      <p v-if="points.length === 1" class="muted text-sm">
        已记下第一个点，再添一条{{ label }}记录就能连成曲线。
      </p>
    </template>
    <div v-else class="py-8 text-center" aria-live="polite">
      <p class="font-medium">还没有{{ label }}记录</p>
      <p class="muted mt-2 text-sm">记录时填写{{ label }}，就能看到成长曲线。</p>
    </div>
    <p class="muted mt-3 text-xs leading-5">
      按测量日期排列，同日多次均保留；横轴按记录等距展示。曲线包含全部测量，不随下方列表筛选变化。
    </p>
  </section>
</template>
