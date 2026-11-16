import { ref } from 'vue';
import { onShow, onPullDownRefresh } from '@dcloudio/uni-app';
import { request, notify, confirm } from './api';
import { useSession } from '../stores/session';
import type { LivingRecord } from '../types';
export function useResource(path) {
    const session = useSession(), items = ref<LivingRecord[]>([]), loading = ref(false), error = ref(''), saving = ref(false), editor = ref(false), formError = ref('');
    async function load() { loading.value = true; error.value = ''; try {
        if (await session.load())
            items.value = await request(`/${path}`);
    }
    catch (e) {
        error.value = e.message;
    }
    finally {
        loading.value = false;
        uni.stopPullDownRefresh();
    } }
    async function save(data: Record<string, unknown>, id?: string) { saving.value = true; formError.value = ''; try {
        await request(`/${path}${id ? `/${id}` : ''}`, id ? 'PATCH' : 'POST', data);
        editor.value = false;
        await load();
        notify('已经好好记下啦');
        return true;
    }
    catch (e) {
        formError.value = e.message;
        return false;
    }
    finally {
        saving.value = false;
    } }
    async function remove(item: LivingRecord) { if (!await confirm(`确定删除“${item.title || item.name || '这条记录'}”吗？删除后无法撤销。`))
        return; try {
        await request(`/${path}/${item.id}`, 'DELETE');
        editor.value = false;
        await load();
        notify('已删除');
    }
    catch (e) {
        notify(e.message);
    } }
    onShow(load);
    onPullDownRefresh(load);
    return { session, items, loading, error, saving, editor, formError, load, save, remove };
}
