<template>
  <view class="page" :class="`theme-${session.theme}`">
    <PageHeading
      eyebrow="LETTERS TO THE FUTURE"
      title="时光信箱"
      description="有些话，留到未来的某一天，再一起打开。"
      symbol="✉"
    />
    <CalendarSourceNotice
      v-if="calendarSource"
      :missing="sourceMissing"
      @clear="clearCalendarSource"
    />
    <view v-if="!calendarSource" class="toolbar">
      <view class="muted grow">锁住的信件，到期后才能读</view>
      <wd-button size="small" @click="openNew">＋ 写封信</wd-button>
    </view>
    <view v-if="error" class="error-box">
      <view>{{ error }}</view>
      <wd-button class="retry-button" size="small" plain @click="load">重新加载</wd-button>
    </view>
    <view v-if="loading && !hasLoaded" class="loading">未来的信箱打开中…</view>
    <view v-else-if="loading" class="meta" role="status">正在更新信箱…</view>
    <view v-for="item in visibleRecords" :key="item.id" class="card letter">
      <view class="row">
        <view class="lock-symbol">{{ item.isLocked ? '▣' : '✉' }}</view>
        <view class="grow">
          <view class="card-title">{{ item.title }}</view>
          <view class="meta"
            >{{ item.author?.nickname || '我们' }} 写给{{
              item.recipient === 'both' ? '未来的我们' : '另一半'
            }}</view
          >
        </view>
        <view class="pill gold">{{ item.isLocked ? '等待开启' : '已经打开' }}</view>
      </view>
      <view v-if="item.isLocked" class="note" style="margin-top: 24rpx"
        >这封信在 {{ item.unlockDate }} 开启，{{
          Math.max(0, daysBetween(item.unlockDate))
        }}
        天后，我们再见。</view
      >
      <view v-else class="card-text">{{ item.content }}</view>
      <view class="meta">开启日期 · {{ item.unlockDate }}</view>
      <view v-if="item.authorId === session.user?.id" class="actions">
        <button v-if="item.isLocked" class="text-action ui-reset" @click="edit(item)">
          重写这封信
        </button>
        <button class="text-action delete ui-reset" @click="remove(item)">删除</button>
      </view>
    </view>
    <EmptyState
      v-if="!calendarSource && hasLoaded && !loading && !items.length"
      symbol="✉"
      title="寄一封信给未来吧"
      description="今天的期待、想说的情话，或者下一周年想实现的约定。"
      action="写第一封信"
      @action="openNew"
    />
    <EditorSheet
      v-model="editor"
      :title="editing ? '给未来重新写一封信' : '写给未来的某一天'"
      :saving="saving"
      :error="formError"
      @save="saveForm"
    >
      <view class="note"
        >保存后，正文会一直保密到开启日期。重写会替换原来的正文，无法提前查看旧内容。</view
      >
      <FormField
        v-model="form.title"
        label="信件标题"
        required
        placeholder="例如：写给一年后的我们"
      />
      <FormField
        v-model="form.unlockDate"
        label="哪一天开启"
        required
        kind="date"
        :min="tomorrow()"
      />
      <FormField v-model="form.recipient" label="写给谁" kind="select" :options="recipients" />
      <FormField
        v-model="form.content"
        label="想留到未来的话"
        required
        kind="textarea"
        :maxlength="20000"
        placeholder="亲爱的未来的我们……"
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
import CalendarSourceNotice from '../../components/CalendarSourceNotice.vue';
import { useCalendarSource } from '../../lib/calendar-source';
import { useResource } from '../../lib/useResource';
import { today, daysBetween } from '../../lib/domain';
const { session, items, hasLoaded, loading, error, saving, editor, formError, load, save, remove } =
    useResource('letters', { syncBusinessDate: true }),
  editing = ref(null),
  form = reactive({ title: '', content: '', unlockDate: '', recipient: 'both' });
const recipients = [
  { value: 'both', label: '未来的我们' },
  { value: 'partner', label: '另一半' },
];
function tomorrow() {
  const d = new Date(`${today()}T12:00:00`);
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
const { calendarSource, clearCalendarSource } = useCalendarSource('letter');
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
  return selection && !sourceMissing.value
    ? items.value.filter((item) => item.id === selection.sourceId)
    : items.value;
});
function openNew() {
  editing.value = null;
  Object.assign(form, { title: '', content: '', unlockDate: tomorrow(), recipient: 'both' });
  editor.value = true;
}
function edit(item) {
  editing.value = item;
  Object.assign(form, {
    title: item.title,
    content: '',
    unlockDate: item.unlockDate,
    recipient: item.recipient,
  });
  editor.value = true;
}
async function saveForm() {
  if (!form.title.trim() || !form.content.trim()) {
    formError.value = '标题和正文都写好，信才能寄出去';
    return;
  }
  if (form.unlockDate <= today()) {
    formError.value = '请选择未来的开启日期';
    return;
  }
  await save({ ...form }, editing.value?.id);
}
</script>
