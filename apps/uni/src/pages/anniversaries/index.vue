<template>
  <view class="page" :class="`theme-${session.theme}`">
    <PageHeading
      eyebrow="DAYS TO REMEMBER"
      title="纪念日"
      description="每一个重要的日子，都值得提前期待。"
      symbol="♡"
    />
    <view class="toolbar">
      <view class="grow muted">收藏那些特别的日期</view>
      <wd-button size="small" @click="openNew">＋ 添加</wd-button>
    </view>
    <view v-if="error" class="error-box">
      <view>{{ error }}</view>
      <wd-button class="retry-button" size="small" plain @click="load">重新加载</wd-button>
    </view>
    <view v-if="loading && !hasLoaded" class="loading">在找下一个值得期待的日子…</view>
    <view v-else-if="loading" class="meta" role="status">正在更新纪念日…</view>
    <view v-for="item in sorted" :key="item.id" class="card">
      <view class="between">
        <view class="grow">
          <view class="card-title">♡ {{ item.title }}</view>
          <view class="meta">{{ item.date }}{{ item.recurring ? ' · 每年都要记得' : '' }}</view>
          <view v-if="item.description" class="card-text">{{ item.description }}</view>
        </view>
        <view class="center">
          <view class="hero-number" style="font-size: 60rpx">{{ Math.abs(item.remaining) }}</view>
          <view class="meta">{{
            item.remaining === 0 ? '就是今天' : item.remaining > 0 ? '天后到来' : '天前的今天'
          }}</view>
        </view>
      </view>
      <view class="actions">
        <button class="text-action ui-reset" @click="edit(item)">编辑</button>
        <button class="text-action delete ui-reset" @click="remove(item)">删除</button>
      </view>
    </view>
    <EmptyState
      v-if="hasLoaded && !loading && !items.length"
      symbol="♡"
      title="把第一个日子放在这里"
      description="在一起的那天、生日、第一次旅行……"
      action="添加一个纪念日"
      @action="openNew"
    />
    <EditorSheet
      v-model="editor"
      :title="editing ? '编辑这个日子' : '记住一个特别的日子'"
      :saving="saving"
      :error="formError"
      @save="saveForm"
    >
      <FormField
        v-model="form.title"
        label="这是什么日子"
        required
        placeholder="例如：我们在一起的日子"
      />
      <FormField v-model="form.date" label="最初的日期" required kind="date" />
      <FormField
        v-model="form.recurring"
        label="每年都纪念"
        kind="switch"
        placeholder="生日、周年纪念等可以开启"
      />
      <FormField
        v-model="form.description"
        label="关于这一天"
        kind="textarea"
        placeholder="那些还记得的小细节"
      />
    </EditorSheet>
  </view>
</template>
<script setup lang="ts">
import { ref, reactive, computed } from 'vue';
import PageHeading from '../../components/PageHeading.vue';
import EmptyState from '../../components/EmptyState.vue';
import EditorSheet from '../../components/EditorSheet.vue';
import FormField from '../../components/FormField.vue';
import { useResource } from '../../lib/useResource';
import { today, nextOccurrence, daysBetween } from '../../lib/domain';
const { session, items, hasLoaded, loading, error, saving, editor, formError, load, save, remove } =
    useResource('anniversaries'),
  editing = ref(null),
  form = reactive({ title: '', date: today(), recurring: true, description: '', icon: 'heart' });
const sorted = computed(() =>
  items.value
    .map((item) => ({ ...item, remaining: daysBetween(nextOccurrence(item.date, item.recurring)) }))
    .sort((a, b) => a.remaining - b.remaining),
);
function openNew() {
  editing.value = null;
  Object.assign(form, {
    title: '',
    date: today(),
    recurring: true,
    description: '',
    icon: 'heart',
  });
  editor.value = true;
}
function edit(item) {
  editing.value = item;
  Object.assign(form, {
    title: item.title,
    date: item.date,
    recurring: item.recurring,
    description: item.description,
    icon: item.icon || 'heart',
  });
  editor.value = true;
}
async function saveForm() {
  if (!form.title.trim()) {
    formError.value = '给这个日子起一个名字吧';
    return;
  }
  await save({ ...form }, editing.value?.id);
}
</script>
