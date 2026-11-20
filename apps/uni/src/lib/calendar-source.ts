import { nextTick, shallowRef } from 'vue';
import { onHide, onShow } from '@dcloudio/uni-app';
import type { CalendarEvent, CalendarEventKind } from '../types';

type Source = Pick<CalendarEvent, 'kind' | 'sourceId'>;

const destinations = {
  anniversary: { url: '/pages/anniversaries/index', tab: false },
  wish: { url: '/pages/wishes/index', tab: true },
  letter: { url: '/pages/letters/index', tab: false },
  memory: { url: '/pages/memories/index', tab: true },
  growth: { url: '/pages/baby/index', tab: false },
  baby: { url: '/pages/baby/index', tab: false },
} satisfies Partial<Record<CalendarEventKind, { url: string; tab: boolean }>>;

let pendingSource: Source | undefined;

export function hasCalendarSource(event: Source) {
  return (
    typeof event.sourceId === 'string' &&
    !!event.sourceId &&
    Object.prototype.hasOwnProperty.call(destinations, event.kind)
  );
}

export function openCalendarSource(event: Source, onFailure: () => void) {
  if (!hasCalendarSource(event)) return;
  const { kind, sourceId } = event;
  const destination = destinations[kind];
  if (!destination) return;
  const { url, tab } = destination;
  const selection = { kind, sourceId };
  // switchTab does not accept query parameters. Both page types consume this selection on show.
  pendingSource = selection;
  const options = {
    url,
    fail() {
      if (pendingSource !== selection) return;
      pendingSource = undefined;
      onFailure();
    },
  };
  if (tab) uni.switchTab(options);
  else uni.navigateTo(options);
}

export function useCalendarSource(...kinds: CalendarEventKind[]) {
  const calendarSource = shallowRef<Source>();
  onShow(async () => {
    const selection = pendingSource;
    if (!selection || !kinds.includes(selection.kind)) return;
    pendingSource = undefined;
    calendarSource.value = selection;
    await nextTick();
    if (calendarSource.value === selection) uni.pageScrollTo({ scrollTop: 0, duration: 0 });
  });
  onHide?.(() => {
    calendarSource.value = undefined;
  });
  function clearCalendarSource() {
    calendarSource.value = undefined;
  }
  return { calendarSource, clearCalendarSource };
}
