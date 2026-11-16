import type { ApiError, LivingRecord, OrderItem } from '../types';
import { anniversaryInfo, daysBetween as calendarDaysBetween } from '@our-little-world/shared/date';
export function normalizeBase(value: string) {
  const base = String(value || '')
    .trim()
    .replace(/\/+$/, '');
  if (!/^https?:\/\/[^/\s]+(?:\/[^\s?#]*)?$/i.test(base))
    throw new Error('请输入完整的 http:// 或 https:// 服务地址');
  return base.endsWith('/api') ? base : `${base}/api`;
}
export function resolveAsset(value: string, base: string) {
  if (!value) return '';
  if (/^https?:\/\//i.test(value)) return value;
  return `${base.replace(/\/api\/?$/, '')}${value.startsWith('/') ? '' : '/'}${value}`;
}
export function centsFromInput(value: string | number) {
  const input = String(value).trim();
  if (!/^\d+(\.\d{1,2})?$/.test(input)) throw new Error('金额须为非负数，最多两位小数');
  const [whole, fraction = ''] = input.split('.');
  const result = Number(whole) * 100 + Number(fraction.padEnd(2, '0'));
  if (!Number.isSafeInteger(result)) throw new Error('金额过大');
  return result;
}
export function today() {
  const date = new Date();
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}
export function nextOccurrence(value: string, recurring: boolean, from = today()) {
  return anniversaryInfo(value, from, { recurring }).nextDate;
}
export function daysBetween(value: string, from = today()) {
  return calendarDaysBetween(from, value);
}
export function buildOrderItems(
  menu: Pick<LivingRecord, 'id' | 'name'>[],
  cart: Record<string, number>,
): OrderItem[] {
  return menu
    .filter((item) => Number(cart[item.id]) > 0)
    .map((item) => {
      const quantity = Number(cart[item.id]);
      if (!Number.isInteger(quantity) || quantity < 1 || quantity > 99)
        throw new Error('每项数量应为 1 至 99');
      return { menuItemId: item.id, name: item.name, quantity };
    });
}
export function decodeResponse(status: number, data: any) {
  if (status < 200 || status >= 300) {
    const error: ApiError = new Error(data?.message || `请求失败（${status}）`);
    error.status = status;
    throw error;
  }
  if (typeof data === 'string') {
    try {
      return JSON.parse(data);
    } catch {
      throw new Error('服务地址没有返回数据，请检查接口地址是否以 /api 结尾');
    }
  }
  return data;
}
export const money = (cents) =>
  `¥${(Number(cents || 0) / 100).toLocaleString('zh-CN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
export const splitTags = (text) =>
  String(text || '')
    .split(/[,，、]/)
    .map((x) => x.trim())
    .filter(Boolean);
