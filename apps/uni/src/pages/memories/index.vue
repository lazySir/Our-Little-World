<template>
  <view class="page" :class="`theme-${session.theme}`">
    <PageHeading
      eyebrow="MEMORY BOOK"
      title="回忆相册"
      description="照片、文字和日期，慢慢装满你们的时间线。"
      symbol="♡" />
    <CalendarSourceNotice
      v-if="calendarSource"
      :missing="sourceMissing"
      @clear="clearCalendarSource" />
    <view v-if="!calendarSource" class="toolbar">
      <input class="search" v-model="query" placeholder="搜索标题或标签" />
      <wd-button size="small" @click="openNew">＋ 写一篇</wd-button>
    </view>
    <view v-if="!calendarSource" class="chips">
      <button
        v-for="tab in tabs"
        :key="tab.value"
        class="chip ui-reset"
        :class="{ active: kind === tab.value }"
        :aria-label="`${tab.label}，${kind === tab.value ? '已选中' : '切换分类'}`"
        :aria-pressed="kind === tab.value"
        @click="kind = tab.value"
      >
        {{ tab.label }}
      </button>
    </view>
    <view v-if="error" class="error-box">
      <view>{{ error }}</view>
      <wd-button class="retry-button" size="small" plain @click="load">重新加载</wd-button>
    </view>
    <view v-if="loading && !hasLoaded" class="loading">正在翻开相册…</view>
    <view v-else-if="loading" class="meta" role="status">正在更新相册…</view>
    <template v-if="hasLoaded">
      <view v-for="item in visibleRecords" :key="item.id" class="card">
        <view class="between">
          <view class="card-title">{{ item.title }}</view>
          <view class="meta">{{ item.date }}</view>
        </view>
        <view v-if="item.content" class="card-text">{{ item.content }}</view>
        <view v-if="item.tags?.length" class="chips" style="margin: 16rpx 0 0">
          <view v-for="tag in item.tags" :key="tag" class="pill"># {{ tag }}</view>
        </view>
        <view v-if="item.assets?.length" class="photo-grid">
          <button
            v-for="(asset, index) in item.assets.slice(0, 6)"
            :key="asset.id"
            class="photo-preview ui-reset"
            :aria-label="`预览 ${item.title} 的第 ${index + 1} 张照片`"
            @click="previewPhotos(item.assets, index)"
          >
            <image class="photo" :src="assetUrl(asset)" mode="aspectFill" @error="refreshAssetOnError(asset)" />
          </button>
        </view>
        <view class="actions">
          <button class="text-action ui-reset" @click="edit(item)">编辑</button>
          <button class="text-action delete ui-reset" @click="remove(item)">删除</button>
        </view>
      </view>
      <EmptyState
        v-if="!calendarSource && !filtered.length"
        symbol="♡"
        :title="hasFilter ? '没有匹配的回忆' : '还没有被收藏的日子'"
        :description="hasFilter ? '试试其他关键词或分类。' : '一张照片、一句话，就可以开始你们的回忆时间线。'"
        :action="hasFilter ? '清除筛选' : '写下第一篇回忆'"
        @action="hasFilter ? resetFilters() : openNew()"
      /> </template
    ><EditorSheet
      v-model="editor"
      :title="editing ? '编辑这段回忆' : '收藏一个今天'"
      :saving="saving"
      :uploading="uploading"
      :error="formError"
      @save="saveForm"
      ><FormField
        v-model="form.title"
        label="给这段回忆起个名字"
        required
        placeholder="例如：第一次一起看海" /><FormField
        v-model="form.date"
        label="发生在什么时候"
        required
        kind="date" /><FormField
        v-model="form.content"
        label="写点什么"
        kind="textarea"
        placeholder="今天发生了什么？想对未来的我们说什么？" /><FormField
        v-model="tagsText"
        label="贴几个标签"
        placeholder="旅行，夏天，第一次"
        hint="用逗号分开多个标签" /><PhotoPicker
        v-model="form.assets"
        :disabled="saving"
        @busy="uploading = $event" /></EditorSheet
  ></view>
</template>
<script setup lang="ts">
import { ref, computed, reactive } from 'vue';
import PageHeading from '../../components/PageHeading.vue';
import EmptyState from '../../components/EmptyState.vue';
import EditorSheet from '../../components/EditorSheet.vue';
import FormField from '../../components/FormField.vue';
import CalendarSourceNotice from '../../components/CalendarSourceNotice.vue';
import { useCalendarSource } from '../../lib/calendar-source';
import PhotoPicker from '../../components/PhotoPicker.vue';
import { useResource } from '../../lib/useResource';
import { assetUrl, previewPhotos, refreshAssetOnError } from '../../lib/api';
import { today, splitTags } from '../../lib/domain';
const { session, items, hasLoaded, loading, error, saving, editor, formError, load, save, remove } =
  useResource('memories', { syncBusinessDate: true });
const query = ref(''),
  kind = ref('all'),
  editing = ref(null),
  tagsText = ref('');
const uploading = ref(false);
const tabs = [
  { value: 'all', label: '全部回忆' },
  { value: 'couple', label: '我们的日子' },
  { value: 'baby', label: '宝宝成长' },
];
const form = reactive({
  title: '',
  content: '',
  date: today(),
  assetIds: [],
  assets: [],
  tags: [],
  kind: 'couple',
});
const normalizedQuery = computed(() => query.value.trim().toLowerCase());
const filtered = computed(() =>
  items.value.filter(
    (item) =>
      (kind.value === 'all' || item.kind === kind.value) &&
      `${item.title} ${item.content || ''} ${(item.tags || []).join(' ')}`
        .toLowerCase()
        .includes(normalizedQuery.value),
  ),
);
const hasFilter = computed(() => !!normalizedQuery.value || kind.value !== 'all');
const { calendarSource, clearCalendarSource } = useCalendarSource('memory');
const sourceMissing = computed(() => {
  const source = calendarSource.value;
  return Boolean(
    source &&
    hasLoaded.value &&
    !loading.value &&
    !error.value &&
    !items.value.some((item) => item.id === source.sourceId),
  );
});
const visibleRecords = computed(() => {
  const selection = calendarSource.value;
  if (selection && !sourceMissing.value)
    return items.value.filter((item) => item.id === selection.sourceId);
  return sourceMissing.value ? items.value : filtered.value;
});
function resetFilters() {
  query.value = '';
  kind.value = 'all';
}
function openNew() {
  editing.value = null;
  tagsText.value = '';
  Object.assign(form, {
    title: '',
    content: '',
    date: today(),
    assetIds: [],
    assets: [],
    tags: [],
    kind: kind.value === 'baby' ? 'baby' : 'couple',
  });
  editor.value = true;
}
function edit(item) {
  editing.value = item;
  tagsText.value = (item.tags || []).join('，');
  Object.assign(form, { ...item, assets: item.assets || [] });
  editor.value = true;
}
async function saveForm() {
  if (!form.title.trim() || !form.date) {
    formError.value = '标题和日期都写好，回忆才能收藏哦';
    return;
  }
  await save(
    {
      ...form,
      title: form.title.trim(),
      tags: splitTags(tagsText.value),
      assetIds: (form.assets || []).map((asset) => asset.id),
    },
    editing.value?.id,
  );
}
</script>
