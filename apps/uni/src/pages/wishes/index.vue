<template>
  <view class="page" :class="`theme-${session.theme}`">
    <PageHeading
      eyebrow="TOGETHER"
      title="一起做"
      description="把想去的地方、想吃的东西和想完成的小事，放在同一个小清单里。"
      symbol="✦"
    />
    <view class="toolbar">
      <input class="search" v-model="query" placeholder="搜索你们想做的事" />
      <wd-button size="small" @click="openNew">＋ 添加</wd-button>
    </view>
    <view class="chips">
      <view
        v-for="tab in tabs"
        :key="tab.value"
        class="chip"
        :class="{ active: filter === tab.value }"
        @click="filter = tab.value"
        >{{ tab.label }} {{ tab.value === 'all' ? '' : `· ${count(tab.value)}` }}</view
      >
    </view>
    <view v-if="error" class="error-box">{{ error }}</view>
    <view v-if="loading" class="loading">正在打开你们的清单…</view>
    <template v-else>
      <view
        v-for="item in filtered"
        :key="item.id"
        class="card"
        :class="{ done: item.status === 'done' }"
      >
        <view class="between">
          <view class="row grow">
            <view
              class="check"
              :class="{ checked: item.status === 'done' }"
              @click="toggle(item)"
              >{{ item.status === 'done' ? '✓' : '' }}</view
            >
            <view class="grow">
              <view class="card-title">{{ item.title }}</view>
              <view v-if="item.description" class="card-text">{{ item.description }}</view>
              <view class="meta">
                <text class="pill">{{ categories[item.category] || item.category }}</text>
                <text v-if="item.targetDate"> · 目标 {{ item.targetDate }}</text>
              </view>
            </view>
          </view>
          <view class="text-action" @click="edit(item)">编辑</view>
        </view>
        <view v-if="item.completedAt" class="between" style="margin-top: 12rpx">
          <view class="meta">完成于 {{ item.completedAt.slice(0, 10) }}</view>
          <wd-button
            size="small"
            plain
            :loading="convertingId === item.id"
            :disabled="!!convertingId"
            @click="toMemory(item)"
            >写成一段回忆 →</wd-button
          >
        </view>
      </view>
      <EmptyState
        v-if="!filtered.length"
        symbol="✦"
        title="清单还空着"
        description="先写下一件你们都想做的小事，完成时再把它变成一段回忆。"
        action="写下第一件事"
        @action="openNew"
      /> </template
    ><EditorSheet
      v-model="editor"
      :title="editing ? '改一改这件事' : '写下一件一起做的事'"
      :saving="saving"
      :error="formError"
      @save="saveForm"
      ><FormField
        v-model="form.title"
        label="想做什么"
        required
        placeholder="例如：去看一场海边日落"
      /><FormField
        v-model="form.description"
        label="说得更具体一点"
        kind="textarea"
        placeholder="想去哪里、和谁、有什么特别的期待？"
      /><FormField
        v-model="form.category"
        label="放在哪一类"
        kind="select"
        :options="categoryOptions"
      /><FormField v-model="form.targetDate" label="希望哪天完成" kind="date" /><view
        v-if="editing"
        class="actions"
        ><view class="text-action delete" @click="remove(editing)">删除这件事</view></view
      ></EditorSheet
    ></view
  >
</template>
<script setup lang="ts">
import { ref, computed, reactive } from 'vue';
import PageHeading from '../../components/PageHeading.vue';
import EmptyState from '../../components/EmptyState.vue';
import EditorSheet from '../../components/EditorSheet.vue';
import FormField from '../../components/FormField.vue';
import { useResource } from '../../lib/useResource';
import { request, notify, navigate } from '../../lib/api';
import { today } from '../../lib/domain';
const { session, items, loading, error, saving, editor, formError, load, save, remove } =
  useResource('wishes');
const query = ref(''),
  filter = ref('all'),
  editing = ref(null),
  convertingId = ref('');
const tabs = [
  { value: 'all', label: '全部' },
  { value: 'todo', label: '还没完成' },
  { value: 'done', label: '已经完成' },
];
const categories = { travel: '想去', food: '想吃', life: '一起生活', other: '其他' },
  categoryOptions = Object.entries(categories).map(([value, label]) => ({ value, label }));
const form = reactive({
  title: '',
  description: '',
  category: 'life',
  status: 'todo',
  targetDate: null,
  completedAt: null,
});
const filtered = computed(() =>
  items.value.filter(
    (item) =>
      (filter.value === 'all' || item.status === filter.value) &&
      `${item.title} ${item.description || ''}`.toLowerCase().includes(query.value.toLowerCase()),
  ),
);
const count = (value) => items.value.filter((item) => item.status === value).length;
function openNew() {
  editing.value = null;
  Object.assign(form, {
    title: '',
    description: '',
    category: 'life',
    status: 'todo',
    targetDate: null,
    completedAt: null,
  });
  editor.value = true;
}
function edit(item) {
  editing.value = item;
  Object.assign(form, { ...item });
  editor.value = true;
}
async function saveForm() {
  if (!form.title.trim()) {
    formError.value = '先写下想做的事吧';
    return;
  }
  await save(
    { ...form, targetDate: form.targetDate || null, title: form.title.trim() },
    editing.value?.id,
  );
}
async function toggle(item) {
  try {
    await request(`/wishes/${item.id}`, 'PATCH', {
      ...item,
      status: item.status === 'done' ? 'todo' : 'done',
      completedAt: item.status === 'done' ? null : new Date().toISOString(),
    });
    await load();
    notify(item.status === 'done' ? '又打开啦' : '完成得漂亮');
  } catch (e) {
    notify(e.message);
  }
}
async function toMemory(item) {
  if (convertingId.value) return;
  convertingId.value = item.id;
  try {
    await request('/memories', 'POST', {
      title: item.title,
      content: item.description || '',
      date: today(),
      tags: ['愿望完成'],
      assetIds: [],
      kind: 'couple',
    });
    notify('已经放入回忆相册');
    navigate('/pages/memories/index');
  } catch (e) {
    notify(e.message);
  } finally {
    convertingId.value = '';
  }
}
</script>
<style scoped>
.done {
  opacity: 0.7;
}
.done .card-title {
  text-decoration: line-through;
  color: #a99a88;
}
.check {
  width: 44rpx;
  height: 44rpx;
  border: 3rpx solid #cfbda1;
  border-radius: 50%;
  display: flex;
  align-items: center;
  justify-content: center;
  color: #fff;
  background: #fffdf8;
  font-size: 28rpx;
  flex: none;
}
.check.checked {
  border-color: #7e9679;
  background: #7e9679;
}
</style>
