<template>
  <view class="page" :class="`theme-${session.theme}`">
    <PageHeading
      eyebrow="WORK JOURNAL"
      title="工作手记"
      description="把工作里的小进展和小想法，也认真收好。"
      symbol="▤"
    />
    <view class="toolbar">
      <input class="search" v-model="query" placeholder="搜索标题、内容或标签" />
      <wd-button size="small" @click="openNew">＋ 写一篇</wd-button>
    </view>
    <view v-if="error" class="error-box">{{ error }}</view>
    <view v-if="loading" class="loading">工作手记打开中…</view>
    <view v-for="item in filtered" :key="item.id" class="card">
      <view class="between">
        <view class="card-title">{{ item.title }}</view>
        <view class="meta">{{ item.date }}</view>
      </view>
      <view class="work-content card-text">{{ item.content }}</view>
      <view class="chips">
        <view v-for="tag in item.tags || []" :key="tag" class="pill sage"># {{ tag }}</view>
      </view>
      <view v-if="item.assets?.length" class="photo-grid">
        <image
          v-for="(asset, index) in item.assets"
          :key="asset.id"
          class="photo"
          :src="assetUrl(asset)"
          mode="aspectFill"
          @click="previewPhotos(item.assets, index)"
        />
      </view>
      <view class="actions">
        <view class="text-action" @click="edit(item)">编辑</view>
        <view class="text-action delete" @click="remove(item)">删除</view>
      </view>
    </view>
    <EmptyState
      v-if="!loading && !filtered.length"
      symbol="▤"
      title="今天，有什么小进展？"
      description="写下完成的事、遇到的问题，或者一个还在发芽的想法。"
      action="写下第一篇手记"
      @action="openNew"
    />
    <EditorSheet
      v-model="editor"
      :title="editing ? '编辑工作手记' : '写一篇工作手记'"
      :saving="saving"
      :uploading="uploading"
      :error="formError"
      @save="saveForm"
    >
      <FormField v-model="form.title" label="标题" required placeholder="今天值得记住的工作小事" />
      <FormField v-model="form.date" label="日期" required kind="date" />
      <FormField
        v-model="form.content"
        label="手记内容"
        kind="textarea"
        :maxlength="20000"
        placeholder="进展、想法、问题和明天的计划……"
      />
      <FormField
        v-model="tagsText"
        label="标签"
        placeholder="项目，灵感，复盘"
        hint="多个标签用逗号分开"
      />
      <PhotoPicker v-model="form.assets" :disabled="saving" @busy="uploading = $event" />
    </EditorSheet>
  </view>
</template>
<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import PageHeading from '../../components/PageHeading.vue';
import EmptyState from '../../components/EmptyState.vue';
import EditorSheet from '../../components/EditorSheet.vue';
import FormField from '../../components/FormField.vue';
import PhotoPicker from '../../components/PhotoPicker.vue';
import { useResource } from '../../lib/useResource';
import { assetUrl, previewPhotos } from '../../lib/api';
import { today, splitTags } from '../../lib/domain';
const { session, items, loading, error, saving, editor, formError, save, remove } =
    useResource('work'),
  query = ref(''),
  tagsText = ref(''),
  editing = ref(null),
  uploading = ref(false),
  form = reactive({ title: '', date: today(), content: '', assets: [] });
const filtered = computed(() =>
  items.value
    .filter((x) =>
      `${x.title} ${x.content || ''} ${(x.tags || []).join(' ')}`
        .toLowerCase()
        .includes(query.value.toLowerCase()),
    )
    .sort((a, b) => b.date.localeCompare(a.date)),
);
function openNew() {
  editing.value = null;
  tagsText.value = '';
  Object.assign(form, { title: '', date: today(), content: '', assets: [] });
  editor.value = true;
}
function edit(item) {
  editing.value = item;
  tagsText.value = (item.tags || []).join('，');
  Object.assign(form, {
    title: item.title,
    date: item.date,
    content: item.content,
    assets: item.assets || [],
  });
  editor.value = true;
}
async function saveForm() {
  if (!form.title.trim()) {
    formError.value = '先给这篇手记起一个标题吧';
    return;
  }
  await save(
    {
      title: form.title,
      date: form.date,
      content: form.content,
      tags: splitTags(tagsText.value),
      assetIds: form.assets.map((x) => x.id),
    },
    editing.value?.id,
  );
}
</script>
