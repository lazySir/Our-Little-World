<script setup lang="ts">
import type { Asset } from '../types';
import { computed, reactive, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { api, assetUrl, refreshAssetOnError } from '../api';
import { today, tomorrow, splitTags, wishCategories, nextAnniversary } from '../domain';
import { useSession } from '../stores/session';
import { useResource } from '../composables/resource';
import { useRecordFocus } from '../composables/record-focus';
import PhotoUpload from '../components/PhotoUpload.vue';
import CalendarSourceStatus from '../components/CalendarSourceStatus.vue';

const props = defineProps<{ kind: string; recordId?: string }>();
const session = useSession();
const configs: Record<string, any> = {
  wishes: {
    path: '/wishes',
    title: '一起做',
    desc: '把想和你一起完成的事，一件件写下来。',
    icon: 'wish',
    action: '写下愿望',
    search: '搜索愿望',
    tabs: [
      { key: 'all', label: '全部' },
      { key: 'todo', label: '待完成' },
      { key: 'done', label: '已完成' },
    ],
    empty: '还没有写下愿望',
    emptyDesc: '旅行、学做一道菜，或是周末赖床。先写下第一件。',
  },
  anniversaries: {
    path: '/anniversaries',
    title: '纪念日',
    desc: '重要的日子值得被好好记住，也值得每年重新庆祝。',
    icon: 'calendar',
    action: '添加纪念日',
    search: '搜索纪念日',
    tabs: [
      { key: 'all', label: '全部' },
      { key: 'upcoming', label: '即将到来' },
    ],
    empty: '还没有纪念日',
    emptyDesc: '在一起的那天、生日、第一次旅行，每个日子都值得记住。',
  },
  memories: {
    path: '/memories',
    title: '回忆相册',
    desc: '把平凡日子里那些让我们嘴角上扬的瞬间，认真收藏。',
    icon: 'photo',
    action: '收藏一个瞬间',
    search: '搜索回忆',
    tabs: [
      { key: 'all', label: '全部' },
      { key: 'couple', label: '我们的故事' },
      { key: 'baby', label: '宝宝成长' },
    ],
    empty: '美好的故事，从第一张回忆开始',
    emptyDesc: '一张照片，一句话，都是以后会想念的今天。',
  },
  work: {
    path: '/work',
    title: '工作手记',
    desc: '忙碌与成长，也想和你分享。',
    icon: 'work',
    action: '写一篇手记',
    search: '搜索手记',
    tabs: [{ key: 'all', label: '全部' }],
    empty: '这里还没有工作手记',
    emptyDesc: '记录今天完成的小事、灵光一闪，或者值得庆祝的进步。',
  },
  letters: {
    path: '/letters',
    title: '时光信箱',
    desc: '写给未来的我们，等一个合适的日子再打开。',
    icon: 'letter',
    action: '写一封信',
    search: '搜索信件',
    tabs: [
      { key: 'all', label: '全部' },
      { key: 'locked', label: '还未到时' },
      { key: 'open', label: '已经打开' },
    ],
    empty: '给未来写一封信吧',
    emptyDesc: '把现在的心情交给时间，未来的我们会收到。',
  },
};
const config = computed(() => configs[props.kind]);
const { items, loading, error, saving, load, save, remove } = useResource(config.value.path);
const sourceReady = computed(() => !!props.recordId && !loading.value && !error.value);
const sourceRecord = computed(() =>
  sourceReady.value ? items.value.find((item) => item.id === props.recordId) : undefined,
);
const focusRecord = useRecordFocus();
const query = ref('');
const tab = ref('all');
const dialog = ref(false);
const editing = ref<any>(null);
const convertingId = ref('');
const assets = ref<Asset[]>([]);
const uploaded = ref(false);
const editorBusy = computed(() => uploaded.value || saving.value);
const form = reactive<any>({
  title: '',
  description: '',
  content: '',
  category: 'life',
  targetDate: null,
  status: 'todo',
  completedAt: null,
  date: today(),
  recurring: true,
  icon: 'heart',
  tagsText: '',
  tags: [],
  kind: 'couple',
  assetIds: [],
  unlockDate: tomorrow(),
  recipient: 'partner',
});
const categoryOptions = [
  { label: '想去的地方', value: 'travel' },
  { label: '想吃的美味', value: 'food' },
  { label: '生活小事', value: 'life' },
  { label: '其他期待', value: 'other' },
];
function resetForm(item: any = null) {
  if (editorBusy.value) return;
  editing.value = item;
  Object.assign(
    form,
    {
      title: '',
      description: '',
      content: '',
      category: 'life',
      targetDate: null,
      status: 'todo',
      completedAt: null,
      date: today(),
      recurring: true,
      icon: 'heart',
      tagsText: '',
      tags: [],
      kind: props.kind === 'memories' ? 'couple' : '',
      assetIds: [],
      unlockDate: tomorrow(),
      recipient: 'partner',
    },
    item
      ? {
          ...item,
          tagsText: item.tags?.join('，') || '',
          assetIds: item.assetIds || item.assets?.map((a) => a.id) || [],
        }
      : {},
  );
  dialog.value = true;
}
async function submit() {
  if (editorBusy.value) return;
  if (!form.title.trim()) {
    ElMessage.warning('先写一个标题吧');
    return;
  }
  let payload;
  const pick = (keys: string[]) => Object.fromEntries(keys.map((k) => [k, form[k]]));
  if (props.kind === 'wishes')
    payload = pick(['title', 'description', 'category', 'status', 'targetDate', 'completedAt']);
  if (props.kind === 'anniversaries')
    payload = pick(['title', 'date', 'recurring', 'description', 'icon']);
  if (props.kind === 'memories' || props.kind === 'work') {
    payload = pick(['title', 'content', 'date', 'assetIds']);
    payload.tags = splitTags(form.tagsText);
    if (props.kind === 'memories') payload.kind = form.kind;
  }
  if (props.kind === 'letters') {
    payload = pick(['title', 'unlockDate', 'recipient']);
    if (!editing.value) payload.content = form.content;
    if (!form.unlockDate || form.unlockDate <= today()) {
      ElMessage.warning('请选择明天或更晚的解锁日期');
      return;
    }
    if (!editing.value && !form.content.trim()) {
      ElMessage.warning('给未来写几句话吧');
      return;
    }
  }
  if (props.kind === 'wishes' && form.status === 'done' && !form.completedAt)
    payload.completedAt = today();
  try {
    await save(payload, editing.value?.id);
    dialog.value = false;
  } catch {}
}
function matchesTab(i, key) {
  if (key === 'todo' || key === 'done') return i.status === key;
  if (key === 'couple' || key === 'baby') return i.kind === key;
  if (key === 'upcoming') return nextAnniversary(i).days >= 0 && nextAnniversary(i).days <= 90;
  if (key === 'locked') return i.isLocked;
  if (key === 'open') return !i.isLocked;
  return true;
}
const filtered = computed(() => {
  if (sourceRecord.value) return [sourceRecord.value];
  let list = items.value || [];
  const q = query.value.trim().toLowerCase();
  if (q)
    list = list.filter((i) =>
      `${i.title || ''} ${i.content || ''} ${i.description || ''} ${(i.tags || []).join(' ')}`
        .toLowerCase()
        .includes(q),
    );
  list = list.filter((i) => matchesTab(i, tab.value));
  if (props.kind === 'anniversaries')
    return [...list].sort((a, b) => nextAnniversary(a).days - nextAnniversary(b).days);
  return [...list].sort((a, b) =>
    (b.date || b.createdAt || '').localeCompare(a.date || a.createdAt || ''),
  );
});
async function toggleWish(item) {
  await save(
    {
      ...item,
      status: item.status === 'done' ? 'todo' : 'done',
      completedAt: item.status === 'done' ? null : today(),
    },
    item.id,
  );
}
async function ensureAssets() {
  if (!assets.value.length) {
    try {
      assets.value = await api.get('/assets');
    } catch {}
  }
}
function openNew() {
  resetForm();
  if (props.kind === 'memories' || props.kind === 'work') ensureAssets();
}
function image(item) {
  return assetUrl(item.assets?.[0]);
}
function canEdit(item) {
  return props.kind !== 'letters' || (item.authorId === session.user.id && item.isLocked);
}
function canDelete(item) {
  return props.kind !== 'letters' || item.authorId === session.user.id;
}
async function convertToMemory(item) {
  if (convertingId.value) return;
  convertingId.value = item.id;
  try {
    await api.post('/memories', {
      title: item.title,
      content: item.description || '',
      date: today(),
      assetIds: [],
      tags: ['愿望实现'],
      kind: 'couple',
    });
    ElMessage.success('已把完成的愿望收藏为回忆');
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    convertingId.value = '';
  }
}
</script>
<template>
  <PageHeader :title="config.title" :description="config.desc"
    ><el-button type="primary" @click="openNew"
      ><AppIcon name="plus" :size="16" />{{ config.action }}</el-button
    ></PageHeader
  >
  <LoadState :loading="loading" :error="error" @retry="load">
    <CalendarSourceStatus v-if="sourceReady" :path="config.path" :missing="!sourceRecord" />
    <div v-if="!sourceRecord && (!recordId || sourceReady)" class="toolbar">
      <div class="filter-tabs">
        <button
          v-for="item in config.tabs"
          :key="item.key"
          class="filter-tab"
          :class="{ active: tab === item.key }"
          @click="tab = item.key"
        >
          {{ item.label
          }}<span class="count">{{ items.filter((i) => matchesTab(i, item.key)).length }}</span>
        </button>
      </div>
      <el-input v-model="query" :placeholder="config.search" clearable
        ><template #prefix><AppIcon name="search" :size="15" /></template
      ></el-input>
    </div>
    <div
      v-if="filtered.length && (!recordId || sourceReady)"
      class="card-grid"
      :class="{ two: !sourceRecord && (kind === 'memories' || kind === 'work') }"
    >
      <article
        v-for="item in filtered"
        :key="item.id"
        :ref="item === sourceRecord ? focusRecord : undefined"
        :data-record-id="item.id"
        :tabindex="item === sourceRecord ? -1 : undefined"
        class="panel record-card"
        :class="{ 'record-source-highlight': item === sourceRecord }"
      >
        <div class="flex items-start justify-between gap-4">
          <div>
            <h3>{{ item.title }}</h3>
            <div class="record-meta">
              <span class="record-date"
                ><AppIcon name="calendar" :size="13" />{{
                  item.date || item.targetDate || item.unlockDate
                }}</span
              ><span
                v-if="kind === 'wishes'"
                class="tag"
                :class="item.status === 'done' ? 'green' : ''"
                >{{ item.status === 'done' ? '已完成' : wishCategories[item.category] }}</span
              ><span
                v-if="kind === 'memories'"
                class="tag"
                :class="item.kind === 'baby' ? 'rose' : ''"
                >{{ item.kind === 'baby' ? '宝宝' : '我们的故事' }}</span
              ><span v-if="kind === 'letters'" class="tag" :class="item.isLocked ? '' : 'green'"
                ><AppIcon :name="item.isLocked ? 'lock' : 'letter'" :size="12" />{{
                  item.isLocked ? '未到解锁日' : '已打开'
                }}</span
              ><span v-if="kind === 'anniversaries'" class="tag">{{
                item.recurring ? '每年一次' : '一次性'
              }}</span>
            </div>
          </div>
          <div class="flex shrink-0 gap-0.5">
            <button
              v-if="canEdit(item)"
              class="icon-button"
              title="编辑"
              @click="
                resetForm(item);
                (kind === 'memories' || kind === 'work') && ensureAssets();
              "
            >
              <AppIcon name="edit" :size="16" /></button
            ><button v-if="canDelete(item)" class="icon-button" title="删除" @click="remove(item)">
              <AppIcon name="trash" :size="16" />
            </button>
          </div>
        </div>
        <div v-if="(kind === 'memories' || kind === 'work') && image(item)" class="photos-grid">
          <el-image
            :src="image(item)"
            @error="refreshAssetOnError(item.assets?.[0])"
            :preview-src-list="item.assets?.map(assetUrl)"
            fit="cover"
            preview-teleported
          />
        </div>
        <div v-if="kind === 'anniversaries'" class="anniversary-count">
          <strong>{{ Math.abs(nextAnniversary(item).days) }}</strong><span>{{
            nextAnniversary(item).days === 0
              ? '就是今天'
              : nextAnniversary(item).days < 0
                ? '天前，值得记住'
                : '天后，再次庆祝'
          }}</span>
        </div>
        <p v-if="kind === 'letters' && item.isLocked" class="locked-letter">
          <AppIcon name="lock" :size="28" /><span
            >这封信还在时间里，<br />等 {{ item.unlockDate }}，一起打开。</span
          >
        </p>
        <p v-if="item.description" class="body-text">{{ item.description }}</p>
        <p v-if="item.content" class="body-text">
          {{ item.isLocked ? '这封信还在时间里，请耐心等待。' : item.content }}
        </p>
        <div v-if="item.tags?.length" class="record-meta">
          <span v-for="tag in item.tags" :key="tag" class="tag"># {{ tag }}</span>
        </div>
        <div v-if="kind === 'wishes'" class="card-footer">
          <el-button
            v-if="item.status === 'done'"
            text
            size="small"
            :loading="convertingId === item.id"
            :disabled="!!convertingId"
            @click="convertToMemory(item)"
            >收藏为回忆</el-button
          ><span v-else class="muted">{{
            item.targetDate ? '目标：' + item.targetDate : '还没有设定日期'
          }}</span
          ><el-button text size="small" @click="toggleWish(item)"
            ><AppIcon :name="item.status === 'done' ? 'close' : 'check'" :size="15" />{{
              item.status === 'done' ? '重新打开' : '标记完成'
            }}</el-button
          >
        </div>
        <div v-if="kind === 'anniversaries'" class="card-footer">
          <span class="muted">{{ item.description || '每年都要记得这一天' }}</span><AppIcon
            name="heart"
            :size="17"
            class="card-heart"
          />
        </div>
        <div v-if="kind === 'letters'" class="card-footer">
          <span class="muted"
            >写给{{ item.recipient === 'both' ? '未来的我们' : '另一半' }} ·
            {{ item.author?.nickname || '我' }}</span
          ><span v-if="item.isLocked" class="muted">{{ item.unlockDate }} 开启</span>
        </div>
      </article>
    </div>
    <div v-else-if="!recordId || sourceReady" class="panel">
      <EmptyState
        :title="query ? '没有找到匹配的记录' : config.empty"
        :description="query ? '换一个关键词试试看' : config.emptyDesc"
        :icon="config.icon"
        :action="query ? '清除搜索' : config.action"
        @action="query ? (query = '') : openNew()"
      />
    </div>
  </LoadState>
  <el-dialog
    v-model="dialog"
    :title="editing ? '编辑记录' : config.action"
    width="min(580px, 94vw)"
    :show-close="!editorBusy"
    :close-on-click-modal="!editorBusy"
    :close-on-press-escape="!editorBusy"
    destroy-on-close
    ><div class="dialog-tip">
      <AppIcon :name="config.icon" :size="16" />
      {{
        editing
          ? '把这份记录改成现在最准确的样子。'
          : '慢慢写，不着急。这里的每一笔都会成为我们的小故事。'
      }}
    </div>
    <el-form
      :model="form"
      :disabled="saving"
      label-position="top"
      size="default"
      @submit.prevent="submit"
      ><el-form-item label="标题" required
        ><el-input
          v-model="form.title"
          maxlength="120"
          show-word-limit
          placeholder="给这件事起个名字" /></el-form-item
      ><template v-if="kind === 'wishes'"
        ><div class="form-grid">
          <el-form-item label="分类"
            ><el-select v-model="form.category"
              ><el-option
                v-for="o in categoryOptions"
                :key="o.value"
                :label="o.label"
                :value="o.value" /></el-select></el-form-item
          ><el-form-item label="目标日期"
            ><el-date-picker
              v-model="form.targetDate"
              type="date"
              value-format="YYYY-MM-DD"
              placeholder="以后再定也可以"
          /></el-form-item>
        </div>
        <el-form-item label="为什么想做"
          ><el-input
            v-model="form.description"
            type="textarea"
            :rows="3"
            maxlength="500" /></el-form-item></template
      ><template v-else-if="kind === 'anniversaries'"
        ><div class="form-grid">
          <el-form-item label="日期" required
            ><el-date-picker
              v-model="form.date"
              type="date"
              value-format="YYYY-MM-DD" /></el-form-item
          ><el-form-item label="图标"
            ><el-select v-model="form.icon"
              ><el-option label="爱心" value="heart" /><el-option
                label="日历"
                value="calendar" /></el-select
          ></el-form-item>
        </div>
        <el-form-item label="每年重复"
          ><el-switch v-model="form.recurring" /><span class="form-hint"
            >开启后每年都会提醒</span
          ></el-form-item
        ><el-form-item label="一句话记录"
          ><el-input
            v-model="form.description"
            type="textarea"
            :rows="3"
            maxlength="500"
            placeholder="为什么这一天特别？" /></el-form-item></template
      ><template v-else-if="kind === 'letters'"
        ><div class="form-grid">
          <el-form-item label="解锁日期" required
            ><el-date-picker
              v-model="form.unlockDate"
              type="date"
              value-format="YYYY-MM-DD" /></el-form-item
          ><el-form-item label="写给谁"
            ><el-select v-model="form.recipient"
              ><el-option label="另一半" value="partner" /><el-option
                label="未来的我们"
                value="both" /></el-select
          ></el-form-item>
        </div>
        <el-form-item v-if="!editing" label="信的内容" required
          ><el-input
            v-model="form.content"
            type="textarea"
            :rows="8"
            maxlength="5000"
            show-word-limit
            placeholder="想对未来的我们说些什么？"
        /></el-form-item>
        <p v-if="editing" class="dialog-tip">
          信的正文已经交给时间保管。你可以调整标题、解锁日期和收件人。
        </p></template
      ><template v-else
        ><div class="form-grid">
          <el-form-item label="日期" required
            ><el-date-picker
              v-model="form.date"
              type="date"
              value-format="YYYY-MM-DD" /></el-form-item
          ><el-form-item v-if="kind === 'memories'" label="归类"
            ><el-select v-model="form.kind"
              ><el-option label="我们的故事" value="couple" /><el-option
                label="宝宝成长"
                value="baby" /></el-select
          ></el-form-item>
        </div>
        <el-form-item label="内容"
          ><el-input
            v-model="form.content"
            type="textarea"
            :rows="5"
            :placeholder="
              kind === 'work'
                ? '今天完成了什么，或者想和另一半分享什么？'
                : '此刻的心情、当时的天气，想写什么都可以。'
            "
            maxlength="5000" /></el-form-item
        ><el-form-item label="标签"
          ><el-input
            v-model="form.tagsText"
            placeholder="用逗号分隔，如：周末，阳光" /></el-form-item
        ><el-form-item v-if="kind === 'memories' || kind === 'work'" label="照片"
          ><PhotoUpload
            v-model="form.assetIds"
            :assets="[...assets, ...(editing?.assets || [])]"
            :limit="12"
            :disabled="saving"
            @busy="uploaded = $event" /></el-form-item
      ></template>
      <div class="flex justify-end gap-2.5 pt-4">
        <el-button :disabled="editorBusy" @click="dialog = false">取消</el-button
        ><el-button type="primary" native-type="submit" :loading="saving" :disabled="uploaded === true"
          >保存到小世界</el-button
        >
      </div></el-form
    ></el-dialog
  >
</template>
