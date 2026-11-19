import { ref, onMounted } from 'vue';
import { ElMessage, ElMessageBox } from 'element-plus';
import { api } from '../api';
export function useResource<T extends { id: string; title?: string; name?: string } = any>(
  path: string,
) {
  const items = ref<T[]>([]),
    loading = ref(true),
    error = ref(''),
    saving = ref(false);
  let loadSequence = 0;
  async function load() {
    const sequence = ++loadSequence;
    loading.value = true;
    error.value = '';
    try {
      const result = await api.get(path);
      if (sequence === loadSequence) items.value = result;
    } catch (e) {
      if (sequence === loadSequence) error.value = e.message;
    } finally {
      if (sequence === loadSequence) loading.value = false;
    }
  }
  async function save(payload: object, id?: string) {
    saving.value = true;
    try {
      const result = id ? await api.patch(`${path}/${id}`, payload) : await api.post(path, payload);
      await load();
      ElMessage.success(id ? '修改已保存' : '已记进小世界');
      return result;
    } catch (e) {
      ElMessage.error(e.message);
      throw e;
    } finally {
      saving.value = false;
    }
  }
  async function remove(item: T, label = '这条记录') {
    try {
      await ElMessageBox.confirm(
        `删除「${item.title || item.name || label}」后将无法撤销。`,
        '确认删除',
        { confirmButtonText: '删除', cancelButtonText: '再想想', type: 'warning' },
      );
    } catch {
      return false;
    }
    try {
      await api.delete(`${path}/${item.id}`);
      await load();
      ElMessage.success('记录已删除');
      return true;
    } catch (e) {
      ElMessage.error(e.message);
      return false;
    }
  }
  onMounted(load);
  return { items, loading, error, saving, load, save, remove };
}
export async function runTask(task, message = '已保存') {
  try {
    const result = await task();
    if (message) ElMessage.success(message);
    return result;
  } catch (e) {
    ElMessage.error(e.message);
    throw e;
  }
}
