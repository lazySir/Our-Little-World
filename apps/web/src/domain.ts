import type { Anniversary, LedgerRecord } from './types';
import { anniversaryInfo } from '@our-little-world/shared/date';
let serverBusinessDate = '';
export function setBusinessDate(value: string | null | undefined) {
  serverBusinessDate = /^\d{4}-\d{2}-\d{2}$/.test(String(value || '')) ? String(value) : '';
}
export const today = () => {
  if (serverBusinessDate) return serverBusinessDate;
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const monthNow = () => today().slice(0, 7);
export const tomorrow = () => {
  const d = new Date(today() + 'T12:00:00');
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};
export const money = (value = 0) =>
  new Intl.NumberFormat('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(
    value / 100,
  );
export function parseMoney(value: string | number) {
  const text = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(text)) throw new Error('金额请填写大于 0 的数字，最多两位小数');
  const [a, b = ''] = text.split('.');
  const cents = Number(a) * 100 + Number(b.padEnd(2, '0'));
  if (!Number.isSafeInteger(cents) || cents <= 0) throw new Error('金额必须大于 0');
  return cents;
}
export function splitTags(value: string) {
  return [
    ...new Set(
      String(value || '')
        .split(/[,，]/)
        .map((s) => s.trim())
        .filter(Boolean),
    ),
  ];
}
export function nextAnniversary(item: Pick<Anniversary, 'date' | 'recurring'>, from = today()) {
  const result = anniversaryInfo(item.date, from, { recurring: item.recurring });
  return { date: result.nextDate, days: result.daysUntil };
}
export function groupLedger<
  T extends Pick<LedgerRecord, 'date' | 'type' | 'amountCents' | 'category'>,
>(items: T[], month: string) {
  const rows = items.filter((i) => i.date.startsWith(month));
  let income = 0,
    expense = 0;
  const groups: Record<string, number> = {};
  const days: Record<string, { income: number; expense: number }> = {};
  for (const i of rows) {
    if (i.type === 'income') income += i.amountCents;
    else {
      expense += i.amountCents;
      groups[i.category] = (groups[i.category] || 0) + i.amountCents;
    }
    days[i.date] ??= { income: 0, expense: 0 };
    days[i.date][i.type] += i.amountCents;
  }
  return {
    rows,
    income,
    expense,
    balance: income - expense,
    categories: Object.entries(groups).map(([name, value]) => ({ name, value })),
    days,
  };
}
export const wishCategories = { travel: '旅行', food: '美食', life: '生活', other: '其他' };
export const menuCategories = { dish: '拿手菜', drink: '想喝的', restaurant: '好店收藏' };
export const growthTypes = {
  growth: '身高体重',
  feeding: '喂养记录',
  sleep: '睡眠记录',
  health: '健康备注',
  milestone: '成长里程碑',
};
export const moodTypes = {
  great: { label: '超开心', symbol: '✦' },
  good: { label: '很不错', symbol: '◡' },
  okay: { label: '平平淡淡', symbol: '—' },
  low: { label: '有点低落', symbol: '⌢' },
  tired: { label: '需要充电', symbol: '☾' },
};
