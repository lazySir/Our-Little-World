import type { ApiOptions, Asset } from './types';
export const TOKEN_KEY = 'little-world-token';
export const BASE_KEY = 'little-world-api';
export const getBase = () =>
  localStorage.getItem(BASE_KEY) || import.meta.env?.VITE_API_BASE || '/api';
export function setBase(value: string) {
  const base = value.trim().replace(/\/$/, '');
  if (base && !/^(https?:\/\/[^\s]+|\/[^\s]*)$/.test(base))
    throw new Error('请输入 /api 或完整的 http / https 接口地址');
  if (base) localStorage.setItem(BASE_KEY, base);
  else localStorage.removeItem(BASE_KEY);
}
export async function request<T = any>(path: string, options: ApiOptions = {}): Promise<T> {
  const headers = new Headers(options.headers);
  const token = localStorage.getItem(TOKEN_KEY);
  if (token) headers.set('Authorization', `Bearer ${token}`);
  let body: BodyInit | null | undefined = options.body as BodyInit;
  if (body && !(body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
    body = JSON.stringify(body);
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 60000);
  try {
    const response = await fetch(`${getBase()}${path}`, {
      ...options,
      body,
      headers,
      signal: options.signal || controller.signal,
    });
    if (!response.ok) {
      let details;
      try {
        details = await response.json();
      } catch {}
      if (response.status === 401 && !path.startsWith('/auth/'))
        window.dispatchEvent(new Event('session-expired'));
      throw new Error(details?.message || `请求失败（${response.status}）`);
    }
    if (options.binary) return response.blob() as Promise<T>;
    return response.status === 204 ? null : response.json();
  } catch (error) {
    if (error.name === 'AbortError') throw new Error('连接超时，请检查网络与接口地址');
    if (error instanceof TypeError) throw new Error('暂时连接不到小世界，请检查网络与服务是否启动');
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
export const api = {
  get: <T = any>(path: string) => request<T>(path),
  post: <T = any>(path: string, body?: object) => request<T>(path, { method: 'POST', body }),
  patch: <T = any>(path: string, body: object) => request<T>(path, { method: 'PATCH', body }),
  put: <T = any>(path: string, body: object) => request<T>(path, { method: 'PUT', body }),
  delete: (path: string) => request<{ ok: boolean }>(path, { method: 'DELETE' }),
};
export async function upload(file: File) {
  const form = new FormData();
  form.append('file', file);
  return request<Asset>('/assets', { method: 'POST', body: form });
}
export async function download(path: string, name: string) {
  const blob = await request<Blob>(path, { binary: true });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export function assetUrl(asset?: Asset) {
  if (!asset?.url) return '';
  if (/^https?:/.test(asset.url)) return asset.url;
  const base = getBase();
  if (/^https?:/.test(base)) return new URL(asset.url, base).href;
  return asset.url;
}
