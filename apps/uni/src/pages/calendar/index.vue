<template>
  <view class="page" :class="`theme-${session.theme}`">
    <PageHeading
      eyebrow="OUR SHARED DAYS"
      title="共享日历"
      description="把重要的日子放在同一个月历里，一起看见接下来要发生的事。"
      symbol="⌑"
    />
    <view class="calendar-month-bar">
      <wd-button size="small" plain @click="shiftMonth(-1)">‹</wd-button>
      <view class="calendar-month-title">{{ monthTitle }}</view>
      <wd-button size="small" plain @click="shiftMonth(1)">›</wd-button>
    </view>
    <view class="chips calendar-filters" role="group" aria-label="日历事件筛选">
      <button
        v-for="item in filters"
        :key="item.value"
        class="chip"
        :class="{ active: filter === item.value }"
        :aria-label="`筛选${item.label}`"
        :aria-pressed="filter === item.value"
        @click="filter = item.value"
      >
        {{ item.label }}
      </button>
    </view>
    <view v-if="error" class="error-box">
      <view>{{ error }}</view>
      <wd-button size="small" plain @click="load">重新连接</wd-button>
    </view>
    <view v-if="loading" class="loading">正在整理你们的日子…</view>
    <template v-else>
      <view class="card calendar-card">
        <view class="calendar-weekdays">
          <text v-for="day in weekDays" :key="day">{{ day }}</text>
        </view>
        <view class="calendar-grid">
          <button
            v-for="(date, index) in cells"
            :key="date || `blank-${index}`"
            class="calendar-day"
            :class="{
              blank: !date,
              today: date && isToday(date),
              selected: date === selectedDate,
              'has-events': date && eventCount(date),
            }"
            :disabled="!date"
            :aria-label="date ? `${date}，${eventCount(date)} 件事件` : undefined"
            :aria-pressed="date ? date === selectedDate : undefined"
            :aria-current="date && isToday(date) ? 'date' : undefined"
            @click="selectDate(date)"
          >
            <text v-if="date" class="calendar-day-number">{{ Number(date.slice(-2)) }}</text>
            <view v-if="date && eventCount(date)" class="calendar-day-dots">
              <text
                v-for="event in eventsByDate[date].slice(0, 3)"
                :key="event.id"
                class="calendar-dot"
                :class="`dot-${event.kind}`"
              />
            </view>
          </button>
        </view>
      </view>
      <view class="section-head">
        <view class="section-title">{{ selectedDate || `${month}-01` }}</view>
        <view class="muted">{{ selectedEvents.length }} 件</view>
      </view>
      <view v-if="selectedEvents.length">
        <view v-for="event in selectedEvents" :key="event.id" class="card calendar-event">
          <view class="calendar-event-icon" :class="`event-${event.kind}`">{{
            kindSymbols[event.kind]
          }}</view>
          <view class="grow">
            <view class="meta">{{ kindLabels[event.kind] }}</view>
            <view class="card-title"
              >{{ event.title }}<text v-if="event.locked"> · 已封存</text></view
            >
            <view v-if="event.description" class="card-text">{{ event.description }}</view>
            <view v-if="hasCalendarSource(event)" class="actions">
              <wd-button
                class="calendar-source-action"
                size="small"
                plain
                @click="viewSource(event)"
              >
                查看来源
              </wd-button>
            </view>
          </view>
        </view>
      </view>
      <view v-else class="empty">
        <view class="empty-symbol">⌑</view>
        <view class="empty-title">这一天还没有安排</view>
        <view class="empty-description">选一个有故事的日子，慢慢把它记下来。</view>
      </view>
    </template>
  </view>
</template>

<script setup lang="ts">
import { computed, ref } from 'vue';
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app';
import PageHeading from '../../components/PageHeading.vue';
import { loadBusinessDate, notify, request } from '../../lib/api';
import { hasCalendarSource, openCalendarSource } from '../../lib/calendar-source';
import { today } from '../../lib/domain';
import { useSession } from '../../stores/session';
import type { CalendarData, CalendarEvent, CalendarEventKind } from '../../types';

const session = useSession();
const month = ref(today().slice(0, 7));
const data = ref<CalendarData>({ month: month.value, date: '', events: [] });
const loading = ref(true);
const error = ref('');
const selectedDate = ref('');
let firstShow = true;
let loadSequence = 0;
const filter = ref<'all' | CalendarEventKind>('all');
const weekDays = ['日', '一', '二', '三', '四', '五', '六'];
const filters: { value: 'all' | CalendarEventKind; label: string }[] = [
  { value: 'all', label: '全部' },
  { value: 'anniversary', label: '纪念日' },
  { value: 'wish', label: '愿望' },
  { value: 'letter', label: '信件' },
  { value: 'memory', label: '回忆' },
  { value: 'growth', label: '成长' },
  { value: 'baby', label: '宝宝' },
];
const kindLabels: Record<CalendarEventKind, string> = {
  anniversary: '纪念日',
  wish: '愿望',
  letter: '时光信箱',
  memory: '回忆',
  growth: '成长记录',
  baby: '宝宝生日',
};
const kindSymbols: Record<CalendarEventKind, string> = {
  anniversary: '♡',
  wish: '✦',
  letter: '✉',
  memory: '▧',
  growth: '⌁',
  baby: '⌂',
};
const events = computed(() =>
  data.value.events.filter((event) => filter.value === 'all' || event.kind === filter.value),
);
const eventsByDate = computed(() => {
  const grouped: Record<string, CalendarEvent[]> = {};
  for (const event of events.value) (grouped[event.date] ||= []).push(event);
  return grouped;
});
const monthTitle = computed(() => {
  const [year, value] = month.value.split('-').map(Number);
  return new Intl.DateTimeFormat('zh-CN', {
    year: 'numeric',
    month: 'long',
    timeZone: 'UTC',
  }).format(new Date(Date.UTC(year, value - 1, 1)));
});
const cells = computed(() => {
  const [year, value] = month.value.split('-').map(Number);
  const offset = new Date(Date.UTC(year, value - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, value, 0)).getUTCDate();
  return [
    ...Array.from({ length: offset }, () => null as string | null),
    ...Array.from(
      { length: days },
      (_, index) => `${month.value}-${String(index + 1).padStart(2, '0')}`,
    ),
  ];
});
const selectedEvents = computed(() => eventsByDate.value[selectedDate.value] || []);

async function load() {
  const sequence = ++loadSequence;
  const requestedMonth = month.value;
  loading.value = true;
  error.value = '';
  try {
    const result = await request<CalendarData>(`/calendar?month=${requestedMonth}`);
    if (sequence !== loadSequence) return;
    data.value = result;
    month.value = result.month;
    if (!selectedDate.value.startsWith(`${result.month}-`))
      selectedDate.value = result.events[0]?.date || `${result.month}-01`;
  } catch (reason) {
    if (sequence !== loadSequence) return;
    error.value = reason instanceof Error ? reason.message : '日历暂时打不开，请稍后重试';
  } finally {
    if (sequence === loadSequence) {
      loading.value = false;
      uni.stopPullDownRefresh();
    }
  }
}
function shiftMonth(offset: number) {
  const [year, value] = month.value.split('-').map(Number);
  const next = new Date(Date.UTC(year, value - 1 + offset, 1));
  month.value = `${next.getUTCFullYear()}-${String(next.getUTCMonth() + 1).padStart(2, '0')}`;
  selectedDate.value = '';
  load();
}
function selectDate(date: string | null) {
  if (date) selectedDate.value = date;
}
function eventCount(date: string) {
  return eventsByDate.value[date]?.length || 0;
}
function isToday(date: string) {
  return date === data.value.date;
}
function viewSource(event: CalendarEvent) {
  openCalendarSource(event, () => notify('暂时打不开来源，请重试'));
}
onShow(async () => {
  if (firstShow) {
    firstShow = false;
    try {
      await loadBusinessDate();
      month.value = today().slice(0, 7);
    } catch {}
  }
  load();
});
onPullDownRefresh(load);
</script>
