<template>
  <view class="page" :class="`theme-${session.theme}`">
    <PageHeading
      eyebrow="LITTLE STEPS, BIG LOVE"
      title="宝宝成长"
      description="可选的小家庭档案，收藏每一个慢慢长大的瞬间。"
      symbol="⌂" />
    <view v-if="babyLoading" class="loading">宝宝档案打开中…</view>
    <view v-else-if="babyError" class="error-box">
      <view>{{ babyError }}</view>
      <wd-button size="small" plain @click="loadBaby">重试宝宝档案</wd-button>
    </view>
    <view v-else-if="babyReady && baby" class="hero" style="min-height: 220rpx">
      <view class="row">
        <image
          v-if="baby.asset || baby.avatar"
          class="avatar-photo"
          :src="assetUrl(baby.asset || baby.avatar)"
          mode="aspectFill"
        />
        <view
          v-else
          class="avatar-photo center"
          style="font-size: 80rpx; line-height: 130rpx; background: #e7eddb"
          >☻</view
        >
        <view class="grow">
          <view class="section-title">{{ baby.name }}</view>
          <view class="meta">{{ baby.birthday ? `${baby.birthday} 出生` : '还没有填写生日' }}</view>
          <view class="pill" style="margin-top: 12rpx">{{
            baby.birthday
              ? `${Math.max(0, -daysBetween(baby.birthday))} 天的成长`
              : '一起等待新生命'
          }}</view>
        </view>
        <button class="text-action ui-reset" aria-label="编辑宝宝档案" @click="editBaby">编辑</button>
      </view>
      <view v-if="baby.notes" class="card-text">{{ baby.notes }}</view>
    </view>
    <EmptyState
      v-else-if="babyReady"
      symbol="☻"
      title="还没有宝宝档案"
      description="现在或未来有需要时，再为宝宝建一个温柔的小档案。"
      action="建立宝宝档案"
      @action="editBaby" />
    <view
      v-if="albumPhotos.length || (babyReady && baby)"
      class="baby-album"
      aria-labelledby="baby-album-title"
    >
      <view class="baby-album-heading">
        <view>
          <view id="baby-album-title" class="section-title">宝宝相册</view>
          <view class="meta">从成长记录中自动整理的照片</view>
        </view>
        <view class="pill sage">{{ albumPhotos.length }} 张</view>
      </view>
      <view v-if="albumPhotos.length" class="baby-album-grid">
        <button
          v-for="(photo, index) in albumPhotos"
          :key="photo.id"
          class="baby-album-photo ui-reset"
          :aria-label="`预览${photo.title}照片，${photo.date}`"
          @click="previewPhotos(albumPhotos.map((entry) => entry.asset), index)"
        >
          <image class="baby-album-image" :src="assetUrl(photo.asset)" mode="aspectFill" />
          <view class="baby-album-caption">
            <view class="baby-album-title">{{ photo.title }}</view>
            <view class="meta">{{ photo.date }}</view>
          </view>
        </button>
      </view>
      <EmptyState
        v-else
        symbol="✿"
        title="相册还在等待第一张照片"
        description="在成长记录中添加照片，它们会自动收进这里。" />
    </view>
    <GrowthChart v-if="!loading && !error" ref="growthChart" :records="items" />
    <view class="toolbar">
      <input class="search" v-model="query" placeholder="搜索成长记录" />
      <wd-button size="small" @click="openNew">＋ 记录</wd-button>
    </view>
    <view class="chips">
      <button
        class="chip ui-reset"
        :class="{ active: filter === 'all' }"
        aria-label="全部记录"
        :aria-pressed="filter === 'all'"
        @click="filter = 'all'"
        >全部</button
      ><button
        v-for="option in types"
        :key="option.value"
        class="chip ui-reset"
        :class="{ active: filter === option.value }"
        :aria-label="`${option.label}记录`"
        :aria-pressed="filter === option.value"
        @click="filter = option.value"
        >{{ option.label }}</button
      >
    </view>
    <view class="note">这里只记录家庭日常；身高、体重、喂养和健康备注都可以按需要选填。</view>
    <view v-if="error" class="error-box">{{ error }}</view>
    <view v-if="loading" class="loading">成长手账打开中…</view>
    <view v-for="item in filtered" :key="item.id" class="timeline-item" style="margin-top: 28rpx">
      <view class="timeline-dot" />
      <view class="meta" style="margin: 0 0 14rpx"
        >{{ item.date }} · {{ typeLabel(item.type) }}</view
      >
      <view class="card">
        <view class="card-title">{{ item.title }}</view>
        <view v-if="item.content" class="card-text">{{ item.content }}</view>
        <view class="chips">
          <view v-if="item.heightCm != null" class="pill sage">身高 {{ item.heightCm }} cm</view>
          <view v-if="item.weightKg != null" class="pill sage">体重 {{ item.weightKg }} kg</view>
          <view v-if="item.amountMl != null" class="pill gold">{{ item.amountMl }} ml</view>
          <view v-if="item.durationMinutes != null" class="pill gold"
            >{{ item.durationMinutes }} 分钟</view
          >
        </view>
        <view v-if="item.assets?.length" class="photo-grid">
          <button
            v-for="(asset, index) in item.assets"
            :key="asset.id"
            class="photo-preview ui-reset"
            :aria-label="`预览${item.title}照片 ${index + 1}`"
            @click="previewPhotos(item.assets, index)"
        >
            <image class="photo" :src="assetUrl(asset)" mode="aspectFill" />
          </button>
        </view>
        <view class="actions">
          <button class="text-action ui-reset" @click="edit(item)">编辑</button>
          <button class="text-action delete ui-reset" @click="remove(item)">删除</button>
        </view>
      </view>
    </view>
    <EmptyState
      v-if="!loading && !filtered.length"
      symbol="✿"
      title="每一次长大，都值得收藏"
      description="记一记身高、第一次翻身，或者今天安睡的小模样。"
      action="写下成长记录"
      @action="openNew" />
    <EditorSheet
      v-model="profileEditor"
      title="宝宝的小档案"
      :saving="profileSaving"
      :uploading="profileUploading"
      :error="profileError"
      @save="saveBaby"
    >
      <FormField v-model="profile.name" label="宝宝的名字" required placeholder="小名也可以" />
      <FormField v-model="profile.birthday" label="生日" kind="date" :max="today()" />
      <FormField v-model="profile.gender" label="性别" kind="select" :options="genders" />
      <FormField
        v-model="profile.notes"
        label="关于宝宝"
        kind="textarea"
        placeholder="想为宝宝记住的事"
      />
      <view class="form-label">宝宝的照片</view>
      <PhotoPicker
        v-model="profilePhotos"
        :max="1"
        :disabled="profileSaving"
        @busy="profileUploading = $event"
      />
    </EditorSheet>
    <EditorSheet
      v-model="editor"
      :title="editing ? '编辑成长记录' : '记下一点点长大'"
      :saving="saving"
      :uploading="uploading"
      :error="formError"
      @save="saveForm"
    >
      <FormField
        v-model="form.title"
        label="这一刻叫什么"
        required
        placeholder="例如：第一次抬头" />
      <FormField v-model="form.date" label="日期" required kind="date" />
      <FormField v-model="form.type" label="记录类型" kind="select" :options="types" />
      <FormField
        v-model="form.content"
        label="记录内容"
        kind="textarea"
        placeholder="写下今天的小细节" />
      <template v-if="form.type === 'growth'">
        <FormField v-model="form.heightCm" label="身高（cm，选填）" kind="number" />
        <FormField v-model="form.weightKg" label="体重（kg，选填）" kind="number" /> </template
      ><FormField
        v-if="form.type === 'feeding'"
        v-model="form.amountMl"
        label="奶量（ml，选填）"
        kind="number" /><FormField
        v-if="form.type === 'sleep'"
        v-model="form.durationMinutes"
        label="时长（分钟，选填）"
        kind="number" /><PhotoPicker
        v-model="form.assets"
        :disabled="saving"
        @busy="uploading = $event" /></EditorSheet
  ></view>
</template>
<script setup lang="ts">
import { ref, reactive, computed, nextTick, shallowRef } from 'vue';
import { onShow, onResize } from '@dcloudio/uni-app';
import PageHeading from '../../components/PageHeading.vue';
import EmptyState from '../../components/EmptyState.vue';
import EditorSheet from '../../components/EditorSheet.vue';
import FormField from '../../components/FormField.vue';
import PhotoPicker from '../../components/PhotoPicker.vue';
import GrowthChart from '../../components/GrowthChart.vue';
import { useResource } from '../../lib/useResource';
import { request, notify, assetUrl, previewPhotos } from '../../lib/api';
import { today, daysBetween } from '../../lib/domain';
import { collectBabyAlbumPhotos } from '@our-little-world/shared/baby-album';
import type { Baby } from '../../types';
const { session, items, loading, error, saving, editor, formError, save, remove } =
    useResource('growth'),
  baby = ref<Baby | null>(null),
  babyLoading = ref(true),
  babyReady = ref(false),
  babyError = ref(''),
  profileEditor = ref(false),
  profileSaving = ref(false),
  profileUploading = ref(false),
  profileError = ref(''),
  profilePhotos = ref([]),
  query = ref(''),
  filter = ref('all'),
  editing = ref(null);
const uploading = ref(false);
const growthChart = shallowRef<{ resize: () => Promise<void> } | null>(null);
const types = [
    { value: 'growth', label: '身高体重' },
    { value: 'feeding', label: '喂养' },
    { value: 'sleep', label: '睡眠' },
    { value: 'health', label: '健康备注' },
    { value: 'milestone', label: '里程碑' },
  ],
  genders = [
    { value: 'unknown', label: '暂不填写' },
    { value: 'girl', label: '女孩' },
    { value: 'boy', label: '男孩' },
  ],
  profile = reactive({ name: '', birthday: null, gender: 'unknown', notes: '', avatarId: null }),
  form = reactive({
    title: '',
    date: today(),
    type: 'milestone',
    content: '',
    heightCm: '',
    weightKg: '',
    amountMl: '',
    durationMinutes: '',
    assets: [],
  });
const filtered = computed(() =>
  items.value
    .filter(
      (x) =>
        (filter.value === 'all' || filter.value === x.type) &&
        `${x.title} ${x.content || ''}`.includes(query.value),
    )
    .sort((a, b) => b.date.localeCompare(a.date)),
);
const albumPhotos = computed(() => collectBabyAlbumPhotos(items.value));
const typeLabel = (value) => types.find((x) => x.value === value)?.label || value;
let babyLoadVersion = 0;
async function loadBaby() {
  if (profileEditor.value || profileSaving.value) return;
  const version = ++babyLoadVersion;
  babyLoading.value = true;
  babyReady.value = false;
  babyError.value = '';
  try {
    const result = await request<Baby | null>('/baby');
    if (version !== babyLoadVersion) return;
    baby.value = result;
    babyReady.value = true;
  } catch (e) {
    if (version === babyLoadVersion)
      babyError.value =
        e instanceof Error && e.message.trim() ? e.message : '宝宝档案读取失败，请重试';
  } finally {
    if (version === babyLoadVersion) babyLoading.value = false;
  }
}
function editBaby() {
  if (!babyReady.value || babyLoading.value || profileEditor.value || profileSaving.value) return;
  Object.assign(
    profile,
    baby.value
      ? {
          name: baby.value.name,
          birthday: baby.value.birthday,
          gender: baby.value.gender,
          notes: baby.value.notes,
          avatarId: baby.value.avatarId,
        }
      : { name: '', birthday: null, gender: 'unknown', notes: '', avatarId: null },
  );
  profilePhotos.value = baby.value?.asset ? [baby.value.asset] : [];
  profileError.value = '';
  profileEditor.value = true;
}
async function saveBaby() {
  if (!babyReady.value || babyLoading.value || profileSaving.value || profileUploading.value)
    return;
  profileSaving.value = true;
  profileError.value = '';
  babyLoadVersion++;
  try {
    if (!profile.name.trim()) throw Error('给宝宝填一个名字吧');
    baby.value = await request<Baby>('/baby', 'PUT', {
      ...profile,
      birthday: profile.birthday || null,
      avatarId: profilePhotos.value[0]?.id || null,
    });
    profileEditor.value = false;
    notify('宝宝档案已保存');
  } catch (e) {
    profileError.value = e.message;
  } finally {
    profileSaving.value = false;
  }
}
function openNew() {
  editing.value = null;
  Object.assign(form, {
    title: '',
    date: today(),
    type: filter.value === 'all' ? 'milestone' : filter.value,
    content: '',
    heightCm: '',
    weightKg: '',
    amountMl: '',
    durationMinutes: '',
    assets: [],
  });
  editor.value = true;
}
function edit(item) {
  editing.value = item;
  Object.assign(form, {
    title: item.title,
    date: item.date,
    type: item.type,
    content: item.content,
    heightCm: item.heightCm ?? '',
    weightKg: item.weightKg ?? '',
    amountMl: item.amountMl ?? '',
    durationMinutes: item.durationMinutes ?? '',
    assets: item.assets || [],
  });
  editor.value = true;
}
async function saveForm() {
  if (!form.title.trim()) {
    formError.value = '给这一刻起个名字吧';
    return;
  }
  const numeric = (key) => (form[key] === '' || form[key] == null ? null : Number(form[key]));
  const payload = {
    title: form.title,
    date: form.date,
    type: form.type,
    content: form.content,
    heightCm: form.type === 'growth' ? numeric('heightCm') : null,
    weightKg: form.type === 'growth' ? numeric('weightKg') : null,
    amountMl: form.type === 'feeding' ? numeric('amountMl') : null,
    durationMinutes: form.type === 'sleep' ? numeric('durationMinutes') : null,
    assetIds: form.assets.map((x) => x.id),
  };
  if (Object.values(payload).some((x) => typeof x === 'number' && !Number.isFinite(x))) {
    formError.value = '请检查输入的数字';
    return;
  }
  await save(payload, editing.value?.id);
}
async function resizeGrowthChart() {
  await nextTick();
  await growthChart.value?.resize();
}
onShow(loadBaby);
onShow(resizeGrowthChart);
onResize(resizeGrowthChart);
</script>
