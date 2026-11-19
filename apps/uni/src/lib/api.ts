import { normalizeBase, resolveAsset, decodeResponse } from './domain';
import { toUniRequest } from './transport';
import type { ApiMethod } from './transport';
import type { Asset, ApiError } from '../types';
const BASE_KEY = 'little-world-api';
const TOKEN_KEY = 'little-world-token';
export const defaultBase = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:3000/api';
export function getBase() {
  return uni.getStorageSync(BASE_KEY) || defaultBase;
}
export function setBase(value) {
  const base = normalizeBase(value);
  uni.setStorageSync(BASE_KEY, base);
  return base;
}
export function getToken() {
  return uni.getStorageSync(TOKEN_KEY) || '';
}
export function setToken(value) {
  value ? uni.setStorageSync(TOKEN_KEY, value) : uni.removeStorageSync(TOKEN_KEY);
}
export function assetUrl(asset: Asset | string) {
  return resolveAsset(typeof asset === 'string' ? asset : asset?.url, getBase());
}
export async function request<T = any>(
  path: string,
  method: ApiMethod = 'GET',
  data?: unknown,
  anonymous = false,
  base = getBase(),
  canExpireSession: () => boolean = () => true,
): Promise<T> {
  const token = getToken();
  return new Promise((resolve, reject) =>
    uni.request(
      toUniRequest({
        url: `${base}${path}`,
        method,
        data: data as UniApp.RequestOptions['data'],
        timeout: 20000,
        header: {
          'Content-Type': 'application/json',
          ...(!anonymous && token ? { Authorization: `Bearer ${token}` } : {}),
        },
        success(response) {
          try {
            resolve(decodeResponse(response.statusCode, response.data));
          } catch (error) {
            if (
              error.status === 401 &&
              !anonymous &&
              base === getBase() &&
              token === getToken() &&
              (path !== '/auth/me' || canExpireSession())
            ) {
              setToken('');
              uni.$emit('session-expired');
              uni.reLaunch({ url: '/pages/auth/index' });
            }
            reject(error);
          }
        },
        fail() {
          reject(new Error('连接不到小世界，请检查服务是否启动和当前接口地址'));
        },
      }),
    ),
  );
}
export function validateStatus(value: unknown): { initialized: boolean } {
  if (typeof (value as { initialized?: unknown } | null)?.initialized !== 'boolean')
    throw new Error('服务地址没有返回小世界数据，请检查接口地址');
  return value as { initialized: boolean };
}
export async function connectBase(value: string) {
  const candidate = normalizeBase(value);
  const status = validateStatus(await request('/auth/status', 'GET', undefined, true, candidate));
  setBase(candidate);
  return status;
}
export async function uploadFile<T = Asset>(filePath: string, path = '/assets'): Promise<T> {
  return new Promise((resolve, reject) =>
    uni.uploadFile({
      url: `${getBase()}${path}`,
      filePath,
      name: 'file',
      timeout: 120000,
      header: { Authorization: `Bearer ${getToken()}` },
      success(response) {
        try {
          resolve(decodeResponse(response.statusCode, response.data));
        } catch (error) {
          reject(error);
        }
      },
      fail() {
        reject(new Error('上传失败，请检查网络后重试'));
      },
    }),
  );
}
export function choosePhotos(count = 9): Promise<string[]> {
  return new Promise((resolve, reject) =>
    uni.chooseImage({
      count,
      sizeType: ['compressed'],
      sourceType: ['album', 'camera'],
      success: (result) => resolve(result.tempFilePaths as string[]),
      fail: (error) =>
        /cancel/.test(error.errMsg)
          ? resolve([])
          : reject(new Error('无法打开照片，请检查相册权限')),
    }),
  );
}
export function notify(message) {
  uni.showToast({ title: String(message), icon: 'none', duration: 2500 });
}
export function confirm(message: string, title = '再确认一下'): Promise<boolean> {
  return new Promise((resolve) =>
    uni.showModal({
      title,
      content: message,
      confirmText: '确定',
      cancelText: '取消',
      confirmColor: '#b8776e',
      success: (result) => resolve(result.confirm),
      fail: () => resolve(false),
    }),
  );
}
export function previewPhotos(assets: Asset[], current = 0) {
  const urls = assets.map(assetUrl).filter(Boolean);
  if (urls.length) uni.previewImage({ urls, current: urls[current] || urls[0] });
}
export function copy(text) {
  uni.setClipboardData({ data: String(text), success: () => notify('已复制') });
}
export function navigate(url: string) {
  if (
    [
      '/pages/home/index',
      '/pages/wishes/index',
      '/pages/memories/index',
      '/pages/more/index',
    ].includes(url)
  )
    uni.switchTab({ url });
  else uni.navigateTo({ url });
}
export async function downloadArchive(
  path: string,
  filename: string,
): Promise<UniApp.DownloadSuccessData | null> {
  // #ifdef MP-WEIXIN
  if (typeof uni.shareFileMessage !== 'function' || !uni.canIUse('shareFileMessage'))
    throw new Error('请更新微信后重试，或使用网页下载备份');
  // #endif
  const file = await new Promise<UniApp.DownloadSuccessData>((resolve, reject) =>
    uni.downloadFile({
      url: `${getBase()}${path}`,
      header: { Authorization: `Bearer ${getToken()}` },
      timeout: 120000,
      success: resolve,
      fail: () => reject(new Error('下载失败，请检查网络')),
    }),
  );
  if (file.statusCode !== 200) {
    let details: unknown;
    try {
      // #ifdef MP-WEIXIN
      details = await new Promise<string | ArrayBuffer>((resolve, reject) =>
        uni.getFileSystemManager().readFile({
          filePath: file.tempFilePath,
          encoding: 'utf8',
          success: (result) => resolve(result.data),
          fail: reject,
        }),
      );
      // #endif
      // #ifdef H5
      details = await (await fetch(file.tempFilePath)).text();
      // #endif
    } catch {}
    decodeResponse(file.statusCode, details);
    throw new Error(`下载失败（${file.statusCode}）`);
  }
  // #ifdef H5
  const anchor = document.createElement('a');
  anchor.href = file.tempFilePath;
  anchor.download = filename;
  anchor.click();
  // #endif
  // #ifdef MP-WEIXIN
  const shared = await new Promise<boolean>((resolve, reject) =>
    uni.shareFileMessage({
      filePath: file.tempFilePath,
      fileName: filename,
      success: () => resolve(true),
      fail: (error) => {
        if (/cancel/i.test(error.errMsg || '')) resolve(false);
        else reject(new Error('文件分享失败，请重试或使用网页下载备份'));
      },
    }),
  );
  if (!shared) return null;
  // #endif
  return file;
}
export async function chooseArchive(): Promise<string | null> {
  return new Promise((resolve, reject) => {
    // #ifdef H5
    uni.chooseFile({
      count: 1,
      type: 'all',
      extension: ['.zip'],
      success: (result) => resolve(result.tempFilePaths[0]),
      fail: (error) =>
        /cancel/.test(error.errMsg) ? resolve(null) : reject(new Error('无法选择备份文件')),
    });
    // #endif
    // #ifdef MP-WEIXIN
    uni.chooseMessageFile({
      count: 1,
      type: 'file',
      extension: ['zip'],
      success: (result) => resolve(result.tempFiles[0]?.path || null),
      fail: (error) =>
        /cancel/.test(error.errMsg) ? resolve(null) : reject(new Error('无法选择备份文件')),
    });
    // #endif
  });
}
