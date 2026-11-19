<template>
  <view class="card growth-chart">
    <view class="card-title">成长曲线</view>
    <view class="growth-chart-control">
      <wd-segmented v-model:value="selectedMetric" :options="metricOptions" />
    </view>
    <template v-if="latest">
      <view class="growth-chart-summary">
        <view class="strong">最近{{ metricLabel }} {{ latest.value }} {{ unit }}</view>
        <view class="meta">{{ latest.date }} · 共 {{ points.length }} 次记录</view>
      </view>
      <UniEcharts
        ref="chart"
        :option="option"
        :custom-style="{ width: '100%', height: '240px' }"
        autoresize
      />
      <view v-if="points.length === 1" class="meta">
        再添一条{{ metricLabel }}测量，就能连成曲线。
      </view>
    </template>
    <view v-else class="growth-chart-empty">
      <view class="strong">还没有{{ metricLabel }}测量</view>
      <view class="meta">写下成长记录时填写{{ metricLabel }}，就能在这里看到变化。</view>
    </view>
    <view class="meta growth-chart-note">
      包含全部有效测量，不随列表筛选变化。同日多次测量均保留，按测量记录顺序等距展示。
    </view>
  </view>
</template>

<script setup lang="ts">
import { computed, ref, shallowRef } from 'vue';
import * as echarts from 'echarts/core';
import type { ComposeOption } from 'echarts/core';
import { LineChart, type LineSeriesOption } from 'echarts/charts';
import {
  GridComponent,
  TooltipComponent,
  type GridComponentOption,
  type TooltipComponentOption,
} from 'echarts/components';
import { CanvasRenderer } from 'echarts/renderers';
import UniEcharts from 'uni-echarts';
import { provideEcharts, type UniEchartsInst } from 'uni-echarts/shared';
import { projectGrowthMeasurements, type GrowthMeasurement } from '@our-little-world/shared/growth';

echarts.use([LineChart, GridComponent, TooltipComponent, CanvasRenderer]);
provideEcharts(echarts);

type GrowthChartOption = ComposeOption<
  LineSeriesOption | GridComponentOption | TooltipComponentOption
>;
const props = defineProps<{ records: GrowthMeasurement[] }>();
const chart = shallowRef<Pick<UniEchartsInst, 'resize'> | null>(null);
const metricOptions = ['身高（cm）', '体重（kg）'];
const selectedMetric = ref(metricOptions[0]);
const metric = computed(() => (selectedMetric.value === metricOptions[1] ? 'weight' : 'height'));
const metricLabel = computed(() => (metric.value === 'height' ? '身高' : '体重'));
const unit = computed(() => (metric.value === 'height' ? 'cm' : 'kg'));
const measurements = computed(() => projectGrowthMeasurements(props.records));
const points = computed(() => measurements.value[metric.value]);
const latest = computed(() => points.value[points.value.length - 1]);
const option = computed<GrowthChartOption>(() => ({
  animation: false,
  color: ['#7d927c'],
  grid: { left: 12, right: 16, top: 38, bottom: 12, containLabel: true },
  tooltip: { trigger: 'axis', renderMode: 'richText', confine: true },
  xAxis: {
    type: 'category',
    data: points.value.map((point) => point.date),
    axisLabel: { color: '#83776a', fontSize: 11, hideOverlap: true },
    axisLine: { lineStyle: { color: '#e8ddcd' } },
    axisTick: { alignWithLabel: true },
  },
  yAxis: {
    type: 'value',
    name: unit.value,
    scale: true,
    axisLabel: { color: '#83776a', fontSize: 11 },
    nameTextStyle: { color: '#83776a', fontSize: 11 },
    splitLine: { lineStyle: { color: '#eee7dc' } },
  },
  series: [
    {
      name: `${metricLabel.value}（${unit.value}）`,
      type: 'line',
      data: points.value.map((point) => point.value),
      showSymbol: true,
      symbol: 'circle',
      symbolSize: 7,
      smooth: false,
      lineStyle: { width: 2 },
    },
  ],
}));

async function resize() {
  await chart.value?.resize();
}
defineExpose({ resize });
</script>

<style scoped>
.growth-chart {
  min-width: 0;
}
.growth-chart-control {
  margin: 20rpx 0;
}
.growth-chart-empty {
  padding: 26rpx 0;
}
</style>
