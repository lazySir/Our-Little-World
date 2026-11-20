<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { api } from '../api';
import PageHeader from '../components/PageHeader.vue';
import LoadState from '../components/LoadState.vue';
import AppIcon from '../components/AppIcon.vue';
import type { CalendarData, CalendarEvent, CalendarEventKind } from '../types';
import { monthNow } from '../domain';

const month = ref(monthNow());
const data = ref<CalendarData>({ month: month.value, date: '', events: [] });
const loading = ref(true);
const error = ref('');
const selectedDate = ref('');
let loadSequence = 0;
const filter = ref<'all' | CalendarEventKind>('all');
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
const kindIcons: Record<CalendarEventKind, string> = {
  anniversary: 'heart',
  wish: 'wish',
  letter: 'letter',
  memory: 'photo',
  growth: 'work',
  baby: 'baby',
};
const sourcePaths: Record<CalendarEventKind, string> = {
  anniversary: '/anniversaries',
  wish: '/wishes',
  letter: '/letters',
  memory: '/memories',
  growth: '/baby',
  baby: '/baby',
};
function sourceLink(event: CalendarEvent) {
  const path = sourcePaths[event.kind];
  if (!event.sourceId || !path) return;
  return {
    path,
    query: { record: event.sourceId, ...(event.kind === 'baby' ? { source: 'baby' } : {}) },
  };
}
const weekDays = ['日', '一', '二', '三', '四', '五', '六'];

const monthTitle = computed(() => {
  const [year, value] = month.value.split('-').map(Number);
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: 'long', timeZone: 'UTC' }).format(
    new Date(Date.UTC(year, value - 1, 1)),
  );
});
const events = computed(() =>
  data.value.events.filter((event) => filter.value === 'all' || event.kind === filter.value),
);
const eventsByDate = computed(() => {
  const grouped: Record<string, CalendarEvent[]> = {};
  for (const event of events.value) (grouped[event.date] ||= []).push(event);
  return grouped;
});
const cells = computed(() => {
  const [year, value] = month.value.split('-').map(Number);
  const firstDay = new Date(Date.UTC(year, value - 1, 1)).getUTCDay();
  const days = new Date(Date.UTC(year, value, 0)).getUTCDate();
  return [
    ...Array.from({ length: firstDay }, () => null as string | null),
    ...Array.from({ length: days }, (_, index) => `${month.value}-${String(index + 1).padStart(2, '0')}`),
  ];
});
const selectedEvents = computed(() => eventsByDate.value[selectedDate.value] || []);

async function load() {
  const sequence = ++loadSequence;
  const requestedMonth = month.value;
  loading.value = true;
  error.value = '';
  try {
    const result = await api.get<CalendarData>(`/calendar?month=${requestedMonth}`);
    if (sequence !== loadSequence) return;
    data.value = result;
    month.value = result.month;
    if (!selectedDate.value.startsWith(`${result.month}-`))
      selectedDate.value = result.events[0]?.date || `${result.month}-01`;
  } catch (reason) {
    if (sequence !== loadSequence) return;
    error.value = reason instanceof Error ? reason.message : '日历暂时打不开，请稍后重试';
  } finally {
    if (sequence === loadSequence) loading.value = false;
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
function isToday(date: string) {
  return date === data.value.date;
}
function eventCount(date: string) {
  return eventsByDate.value[date]?.length || 0;
}
onMounted(load);
</script>

<template>
  <PageHeader title="共享日历" description="把重要的日子放在同一个月历里，一起看见接下来要发生的事。">
    <div class="calendar-month-actions">
      <button class="icon-button" title="上个月" aria-label="上个月" @click="shiftMonth(-1)">
        <AppIcon name="arrow" :size="17" class="calendar-arrow prev" />
      </button>
      <strong>{{ monthTitle }}</strong>
      <button class="icon-button" title="下个月" aria-label="下个月" @click="shiftMonth(1)">
        <AppIcon name="arrow" :size="17" />
      </button>
    </div>
  </PageHeader>
  <LoadState :loading="loading" :error="error" @retry="load">
    <div class="calendar-toolbar">
      <el-radio-group v-model="filter" size="small" aria-label="日历事件筛选">
        <el-radio-button v-for="item in filters" :key="item.value" :value="item.value">
          {{ item.label }}
        </el-radio-button>
      </el-radio-group>
      <span class="muted">{{ events.length }} 件值得记住的事</span>
    </div>
    <section class="calendar-layout">
      <div class="panel calendar-panel">
        <div class="calendar-weekdays">
          <span v-for="day in weekDays" :key="day">{{ day }}</span>
        </div>
        <div class="calendar-grid" role="group" :aria-label="`${monthTitle}日期`">
          <button
            v-for="(date, index) in cells"
            :key="date || `blank-${index}`"
            class="calendar-day"
            :class="{ blank: !date, today: date && isToday(date), selected: date === selectedDate, 'has-events': date && eventCount(date) }"
            :disabled="!date"
            :aria-pressed="date ? date === selectedDate : undefined"
            :aria-current="date && isToday(date) ? 'date' : undefined"
            :aria-label="date ? `${date}，${eventCount(date)} 件事件` : undefined"
            @click="selectDate(date)"
          >
            <span v-if="date" class="calendar-day-number">{{ Number(date.slice(-2)) }}</span>
            <span v-if="date && eventCount(date)" class="calendar-day-dots" aria-hidden="true">
              <i v-for="event in eventsByDate[date].slice(0, 3)" :key="event.id" :class="`dot-${event.kind}`" />
            </span>
          </button>
        </div>
      </div>
      <aside class="panel calendar-details" aria-live="polite">
        <div class="section-head">
          <h3><AppIcon name="calendar" :size="18" />{{ selectedDate || `${month}-01` }}</h3>
          <span class="muted">{{ selectedEvents.length }} 件</span>
        </div>
        <div v-if="selectedEvents.length" class="calendar-event-list">
          <article v-for="event in selectedEvents" :key="event.id" class="calendar-event">
            <span class="calendar-event-icon" :class="`event-${event.kind}`">
              <AppIcon :name="kindIcons[event.kind]" :size="18" />
            </span>
            <div>
              <span class="calendar-event-kind">{{ kindLabels[event.kind] }}</span>
              <h4>{{ event.title }} <AppIcon v-if="event.locked" name="lock" :size="13" /></h4>
              <p v-if="event.description">{{ event.description }}</p>
              <router-link
                v-if="sourceLink(event)"
                :to="sourceLink(event)!"
                :aria-label="'查看来源：' + event.title"
                class="text-link mt-2 inline-flex min-h-6"
              >
                查看来源 <AppIcon name="arrow" :size="13" />
              </router-link>
            </div>
          </article>
        </div>
        <EmptyState v-else title="这一天还没有安排" description="选一个有故事的日子，慢慢把它记下来。" icon="calendar" />
      </aside>
    </section>
  </LoadState>
</template>
