import { normalizeBase, resolveAsset, decodeResponse } from './domain';
import type { Asset, ApiError } from '../types';
const BASE_KEY = 'little-world-api';
const TOKEN_KEY = 'little-world-token';
export const defaultBase = import.meta.env.VITE_API_BASE || 'http://127.0.0.1:3000/api';
export function getBase() { return uni.getStorageSync(BASE_KEY) || defaultBase; }
export function setBase(value) { const base = normalizeBase(value); uni.setStorageSync(BASE_KEY, base); return base; }
export function getToken() { return uni.getStorageSync(TOKEN_KEY) || ''; }
export function setToken(value) { value ? uni.setStorageSync(TOKEN_KEY, value) : uni.removeStorageSync(TOKEN_KEY); }
export function assetUrl(asset: Asset | string) { return resolveAsset(typeof asset === 'string' ? asset : asset?.url, getBase()); }
export async function request<T = any>(path: string, method = 'GET', data?: unknown, anonymous = false): Promise<T> {
    return new Promise((resolve, reject) => uni.request({
        url: `${getBase()}${path}`, method: method as UniApp.RequestOptions['method'], data: data as UniApp.RequestOptions['data'], timeout: 20000,
        header: { 'Content-Type': 'application/json', ...(!anonymous && getToken() ? { Authorization: `Bearer ${getToken()}` } : {}) },
        success(response) {
            try {
                resolve(decodeResponse(response.statusCode, response.data));
            }
            catch (error) {
                if (error.status === 401 && !anonymous) {
                    setToken('');
                    uni.$emit('session-expired');
                    uni.reLaunch({ url: '/pages/auth/index' });
                }
                reject(error);
            }
        },
        fail() { reject(new Error('连接不到小世界，请检查服务是否启动和当前接口地址')); },
    }));
}
export async function uploadFile(filePath: string, path = '/assets'): Promise<Asset> {
    return new Promise((resolve, reject) => uni.uploadFile({
        url: `${getBase()}${path}`, filePath, name: 'file', timeout: 120000, header: { Authorization: `Bearer ${getToken()}` },
        success(response) { try {
            resolve(decodeResponse(response.statusCode, response.data));
        }
        catch (error) {
            reject(error);
        } },
        fail() { reject(new Error('上传失败，请检查网络后重试')); },
    }));
}
export function choosePhotos(count = 9): Promise<string[]> {
    return new Promise((resolve, reject) => uni.chooseImage({ count, sizeType: ['compressed'], sourceType: ['album', 'camera'], success: result => resolve(result.tempFilePaths as string[]), fail: error => /cancel/.test(error.errMsg) ? resolve([]) : reject(new Error('无法打开照片，请检查相册权限')) }));
}
export function notify(message) { uni.showToast({ title: String(message), icon: 'none', duration: 2500 }); }
export function confirm(message: string, title = '再确认一下'): Promise<boolean> {
    return new Promise(resolve => uni.showModal({ title, content: message, confirmText: '确定', cancelText: '取消', confirmColor: '#b8776e', success: result => resolve(result.confirm), fail: () => resolve(false) }));
}
export function previewPhotos(assets: Asset[], current = 0) { const urls = assets.map(assetUrl).filter(Boolean); if (urls.length)
    uni.previewImage({ urls, current: urls[current] || urls[0] }); }
export function copy(text) { uni.setClipboardData({ data: String(text), success: () => notify('已复制') }); }
export function navigate(url: string) { if (['/pages/home/index', '/pages/wishes/index', '/pages/memories/index', '/pages/more/index'].includes(url))
    uni.switchTab({ url });
else
    uni.navigateTo({ url }); }
export async function downloadArchive(path, filename) {
    const file = await new Promise<UniApp.DownloadSuccessData>((resolve, reject) => uni.downloadFile({ url: `${getBase()}${path}`, header: { Authorization: `Bearer ${getToken()}` }, timeout: 120000, success: res => res.statusCode === 200 ? resolve(res) : reject(new Error('下载失败，请确认权限')), fail: () => reject(new Error('下载失败，请检查网络')) }));
    // #ifdef H5
    const anchor = document.createElement('a');
    anchor.href = file.tempFilePath;
    anchor.download = filename;
    anchor.click();
    // #endif
    // #ifdef MP-WEIXIN
    await new Promise((resolve, reject) => uni.saveFile({ tempFilePath: file.tempFilePath, success: result => { uni.shareFileMessage({ filePath: result.savedFilePath, fileName: filename, success: resolve, fail: reject }); }, fail: reject }));
    // #endif
    // #ifdef APP-PLUS
    await new Promise((resolve, reject) => uni.saveFile({ tempFilePath: file.tempFilePath, success: result => { notify(`已保存：${result.savedFilePath}`); resolve(result); }, fail: reject }));
    // #endif
    return file;
}
export async function chooseArchive(): Promise<string | null> {
    return new Promise((resolve, reject) => {
        // #ifdef H5
        uni.chooseFile({ count: 1, type: 'all', extension: ['.zip'], success: result => resolve(result.tempFilePaths[0]), fail: error => /cancel/.test(error.errMsg) ? resolve(null) : reject(new Error('无法选择备份文件')) });
        // #endif
        // #ifdef MP-WEIXIN
        uni.chooseMessageFile({ count: 1, type: 'file', extension: ['zip'], success: result => resolve(result.tempFiles[0]?.path || null), fail: error => /cancel/.test(error.errMsg) ? resolve(null) : reject(new Error('无法选择备份文件')) });
        // #endif
        // #ifdef APP-PLUS
        const plusApi = (globalThis as any).plus;
        if (plusApi?.os?.name === 'Android') {
            const Intent = plusApi.android.importClass('android.content.Intent'), activity = plusApi.android.runtimeMainActivity(), intent = new Intent('android.intent.action.GET_CONTENT');
            intent.setType('application/zip');
            intent.addCategory('android.intent.category.OPENABLE');
            const previous = activity.onActivityResult;
            activity.onActivityResult = (requestCode, resultCode, data) => { if (requestCode !== 1986) {
                previous?.(requestCode, resultCode, data);
                return;
            } activity.onActivityResult = previous; if (resultCode !== -1) {
                resolve(null);
                return;
            } try {
                const uri = data.getData();
                plusApi.android.importClass(uri);
                const resolver = activity.getContentResolver();
                plusApi.android.importClass(resolver);
                const input = resolver.openInputStream(uri);
                const cache = activity.getCacheDir().getAbsolutePath() + '/little-world-restore.zip';
                const Output = plusApi.android.importClass('java.io.FileOutputStream'), output = new Output(cache), Channels = plusApi.android.importClass('java.nio.channels.Channels'), source = Channels.newChannel(input), destination = output.getChannel();
                plusApi.android.importClass(destination);
                destination.transferFrom(source, 0, 2147483647);
                output.close();
                input.close();
                resolve(cache);
            }
            catch {
                reject(new Error('无法读取备份文件，请换一个 ZIP 文件'));
            } };
            activity.startActivityForResult(intent, 1986);
        }
        else if (plusApi?.os?.name === 'iOS') {
            const controller = plusApi.ios.newObject('UIDocumentPickerViewController');
            plusApi.ios.invoke(controller, 'initWithDocumentTypes:inMode:', ['public.zip-archive'], 0);
            const delegate = plusApi.ios.implements('UIDocumentPickerDelegate', {
                'documentPicker:didPickDocumentsAtURLs:': (_picker, urls) => { try {
                    const url = plusApi.ios.invoke(urls, 'objectAtIndex:', 0);
                    const source = plusApi.ios.invoke(url, 'path');
                    resolve(String(source));
                }
                catch {
                    reject(new Error('无法读取 ZIP，请重新选择备份文件'));
                } },
                'documentPickerWasCancelled:': () => resolve(null),
            });
            plusApi.ios.invoke(controller, 'setDelegate:', delegate);
            const root = plusApi.ios.invoke(plusApi.ios.invoke('UIApplication', 'sharedApplication'), 'keyWindow'), viewController = plusApi.ios.invoke(root, 'rootViewController');
            plusApi.ios.invoke(viewController, 'presentViewController:animated:completion:', controller, true, null);
        }
        else {
            reject(new Error('无法打开系统文件选择器，请检查文件访问权限'));
        }
        // #endif
    });
}
