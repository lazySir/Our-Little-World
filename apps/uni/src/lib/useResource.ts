import { ref } from 'vue';
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app';
import { request, notify, confirm, loadBusinessDate } from './api';
import { useSession } from '../stores/session';
import type { LivingRecord } from '../types';
type ResourceOptions = { syncBusinessDate?: boolean };
export function useResource(path: string, options: ResourceOptions = {}) {
  const session = useSession(),
    items = ref<LivingRecord[]>([]),
    hasLoaded = ref(false),
    loading = ref(false),
    error = ref(''),
    saving = ref(false),
    editor = ref(false),
    formError = ref('');
  let loadVersion = 0;
  async function load() {
    const version = ++loadVersion;
    loading.value = true;
    error.value = '';
    try {
      if (!(await session.load()) || version !== loadVersion) return;
      if (options.syncBusinessDate !== false) {
        try {
          await loadBusinessDate();
        } catch {}
      }
      const result = await request(`/${path}`);
      if (version === loadVersion) {
        items.value = result;
        hasLoaded.value = true;
      }
    } catch (e) {
      if (version === loadVersion) error.value = e.message;
    } finally {
      if (version === loadVersion) {
        loading.value = false;
        uni.stopPullDownRefresh();
      }
    }
  }
  async function save(data: Record<string, unknown>, id?: string) {
    saving.value = true;
    formError.value = '';
    try {
      await request(`/${path}${id ? `/${id}` : ''}`, id ? 'PATCH' : 'POST', data);
      editor.value = false;
      await load();
      notify('已经好好记下啦', 'success');
      return true;
    } catch (e) {
      formError.value = e.message;
      return false;
    } finally {
      saving.value = false;
    }
  }
  async function remove(item: LivingRecord) {
    if (!(await confirm(`确定删除“${item.title || item.name || '这条记录'}”吗？删除后无法撤销。`)))
      return;
    try {
      await request(`/${path}/${item.id}`, 'DELETE');
      editor.value = false;
      await load();
      notify('已删除', 'success');
    } catch (e) {
      notify(e.message);
    }
  }
  onShow(load);
  onPullDownRefresh(load);
  return {
    session,
    items,
    hasLoaded,
    loading,
    error,
    saving,
    editor,
    formError,
    load,
    save,
    remove,
  };
}
