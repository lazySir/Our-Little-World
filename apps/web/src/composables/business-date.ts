import { request } from '../api';

type BusinessDate = { date: string; month: string };

// Route guards share this cache so navigation never repeats a slow date request.
const CACHE_TTL_MS = 5 * 60 * 1000;
let cached: BusinessDate | null = null;
let cachedAt = 0;
let failedAt = 0;
let lastError: unknown;
let pending: Promise<BusinessDate> | null = null;

function refreshBusinessDate() {
  if (pending) return pending;
  pending = request<BusinessDate>('/business-date', { anonymous: true })
    .then((result) => {
      cached = result;
      cachedAt = Date.now();
      failedAt = 0;
      lastError = undefined;
      return result;
    })
    .catch((error) => {
      failedAt = Date.now();
      lastError = error;
      throw error;
    })
    .finally(() => {
      pending = null;
    });
  return pending;
}

export function loadBusinessDate(options: { force?: boolean } = {}) {
  const now = Date.now();
  if (!options.force && cached) {
    if (!pending && now - cachedAt >= CACHE_TTL_MS && now - failedAt >= CACHE_TTL_MS)
      void refreshBusinessDate().catch(() => {});
    return Promise.resolve(cached);
  }
  if (pending) return pending;
  if (!options.force && lastError && now - failedAt < CACHE_TTL_MS)
    return Promise.reject(lastError);
  return refreshBusinessDate();
}
