<template>
  <view class="page" :class="`theme-${session.theme}`">
    <PageHeading
      eyebrow="PREGNANCY JOURNAL"
      title="孕期手记"
      description="把这段日子里的重要时刻、心情和照片，慢慢记下来。"
      symbol="♡"
    />
    <view class="toolbar">
      <input class="search" v-model="query" placeholder="搜索标题或记录内容" aria-label="搜索标题或记录内容" />
      <wd-button size="small" @click="openNew">＋ 写一条</wd-button>
    </view>
    <view class="chips pregnancy-filters" role="group" aria-label="手记类型筛选">
      <button
        v-for="option in filterOptions"
        :key="option.value"
        class="chip ui-reset"
        :class="{ active: typeFilter === option.value }"
        :aria-pressed="typeFilter === option.value"
        @click="typeFilter = option.value"
      >
        {{ option.label }}
      </button>
    </view>
    <view v-if="error" class="error-box">
      <view>{{ error }}</view>
      <wd-button class="retry-button" size="small" plain @click="load">重新加载</wd-button>
    </view>
    <view v-if="loading && !hasLoaded" class="loading">正在打开孕期手记…</view>
    <view v-else-if="loading" class="meta" role="status">正在更新手记…</view>
    <template v-if="hasLoaded">
      <view v-for="item in filtered" :key="item.id" class="card">
        <view class="between">
          <view class="card-title">{{ item.title }}</view>
          <view class="meta">{{ item.date }}</view>
        </view>
        <view class="meta record-type">{{ typeLabels[item.type] || item.type }}</view>
        <view v-if="item.content" class="card-text">{{ item.content }}</view>
        <view v-if="item.assets?.length" class="photo-grid">
          <button
            v-for="(asset, index) in item.assets"
            :key="asset.id"
            class="photo-preview ui-reset"
            :aria-label="`预览 ${item.title} 的第 ${index + 1} 张照片`"
            @click="previewPhotos(item.assets, index)"
          >
            <image
              class="photo"
              :src="assetUrl(asset)"
              mode="aspectFill"
              @error="refreshAssetOnError(asset)"
            />
          </button>
        </view>
        <view class="actions">
          <button class="text-action ui-reset" @click="edit(item)">编辑</button>
          <button class="text-action delete ui-reset" @click="remove(item)">删除</button>
        </view>
      </view>
      <EmptyState
        v-if="!filtered.length"
        symbol="♡"
        :title="hasFilter ? '没有找到匹配的记录' : '这段日子还没有手记'"
        :description="hasFilter ? '换个关键词或类型再试试' : '记录下今天的心情、产检，或想留住的小小瞬间。'"
        :action="hasFilter ? '清除筛选' : '写下第一条手记'"
        @action="hasFilter ? resetFilters() : openNew()"
      />
    </template>
    <EditorSheet
      v-model="editor"
      :title="editing ? '编辑孕期手记' : '写下一条孕期手记'"
      :saving="saving"
      :uploading="uploading"
      :error="formError"
      @save="saveForm"
    >
      <FormField v-model="form.title" label="标题" required placeholder="给今天留个名字" />
      <FormField v-model="form.date" label="记录日期" required kind="date" />
      <FormField v-model="form.type" label="记录类型" kind="select" :options="typeOptions" />
      <FormField
        v-model="form.content"
        label="写点什么"
        kind="textarea"
        :maxlength="10000"
        placeholder="记下当时的心情、对话或想留住的细节。"
      />
      <PhotoPicker v-model="form.assets" :max="12" :disabled="saving" @busy="uploading = $event" />
    </EditorSheet>
  </view>
</template>
<script setup lang="ts">
import { computed, reactive, ref } from 'vue';
import PageHeading from '../../components/PageHeading.vue';
import EmptyState from '../../components/EmptyState.vue';
import EditorSheet from '../../components/EditorSheet.vue';
import FormField from '../../components/FormField.vue';
import PhotoPicker from '../../components/PhotoPicker.vue';
import { useResource } from '../../lib/useResource';
import { assetUrl, previewPhotos, refreshAssetOnError } from '../../lib/api';
import { today } from '../../lib/domain';
const { session, items, hasLoaded, loading, error, saving, editor, formError, load, save, remove } =
    useResource('pregnancy', { syncBusinessDate: true }),
  query = ref(''),
  typeFilter = ref('all'),
  editing = ref<any>(null),
  uploading = ref(false),
  form = reactive({
    title: '',
    date: today(),
    type: 'note',
    content: '',
    assets: [] as any[],
  });
const typeLabels: Record<string, string> = {
  checkup: '产检',
  milestone: '里程碑',
  mood: '心情',
  note: '备忘',
};
const typeOptions = Object.entries(typeLabels).map(([value, label]) => ({ value, label }));
const filterOptions = [{ value: 'all', label: '全部' }, ...typeOptions];
const hasFilter = computed(() => !!query.value.trim() || typeFilter.value !== 'all');
const filtered = computed(() =>
  [...items.value]
    .filter((item) => typeFilter.value === 'all' || item.type === typeFilter.value)
    .filter((item) => `${item.title} ${item.content || ''}`.toLowerCase().includes(query.value.trim().toLowerCase()))
    .sort((a, b) => b.date.localeCompare(a.date) || (b.createdAt || '').localeCompare(a.createdAt || '')),
);
function resetFilters() {
  query.value = '';
  typeFilter.value = 'all';
}
function openNew() {
  editing.value = null;
  Object.assign(form, { title: '', date: today(), type: 'note', content: '', assets: [] });
  editor.value = true;
}
function edit(item: any) {
  editing.value = item;
  Object.assign(form, { ...item, assets: item.assets || [] });
  editor.value = true;
}
async function saveForm() {
  if (!form.title.trim() || !form.date) {
    formError.value = '标题和日期都写好，手记才能保存哦';
    return;
  }
  await save(
    {
      title: form.title.trim(),
      date: form.date,
      type: form.type,
      content: form.content,
      assetIds: form.assets.map((asset) => asset.id),
    },
    editing.value?.id,
  );
}
</script>
<style scoped>
.record-type {
  margin-top: 8rpx;
}
</style>
