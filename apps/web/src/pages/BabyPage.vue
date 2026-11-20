<script setup lang="ts">
import { ref, reactive, computed, onMounted } from 'vue';
import { ElMessage } from 'element-plus';
import { api, assetUrl, refreshAssetOnError } from '../api';
import { today, growthTypes } from '../domain';
import { useResource } from '../composables/resource';
import { useRecordFocus } from '../composables/record-focus';
import CalendarSourceStatus from '../components/CalendarSourceStatus.vue';
import type { Baby, Growth, Asset } from '../types';
import PhotoUpload from '../components/PhotoUpload.vue';
import GrowthChart from '../components/GrowthChart.vue';
import { projectGrowthMeasurements } from '@our-little-world/shared/growth';
import { collectBabyAlbumPhotos } from '@our-little-world/shared/baby-album';
const props = defineProps<{ recordId?: string; profileSource?: boolean }>();
const baby = ref<Baby | null>(null),
  babyLoading = ref(true),
  babyLoaded = ref(false),
  babyError = ref(''),
  profileOpen = ref(false),
  profileSaving = ref(false),
  profileUploading = ref(false);
const assets = ref<Asset[]>([]);
const profile = reactive<Baby>({
  name: '',
  birthday: null,
  gender: 'unknown',
  notes: '',
  avatarId: null,
});
const { items, loading, error, saving, load, save, remove } = useResource<Growth>('/growth');
const tab = ref('all'),
  dialog = ref(false),
  editing = ref<Growth | null>(null),
  uploading = ref(false);
const form = reactive<any>({
  title: '',
  date: today(),
  type: 'growth',
  content: '',
  heightCm: null,
  weightKg: null,
  amountMl: null,
  durationMinutes: null,
  assetIds: [],
});
const regularFiltered = computed(() =>
  [...items.value]
    .filter((i) => tab.value === 'all' || i.type === tab.value)
    .sort((a, b) => b.date.localeCompare(a.date)),
);
const filtered = computed(() =>
  sourceIsGrowth.value
    ? sourceGrowth.value
      ? [sourceGrowth.value]
      : sourceReady.value
        ? regularFiltered.value
        : []
    : regularFiltered.value,
);
const editorBusy = computed(() => uploading.value || saving.value);
const profileBusy = computed(() => profileUploading.value || profileSaving.value);
const profileReady = computed(() => babyLoaded.value && !babyLoading.value);
const sourceIsBirthday = computed(() => !!props.recordId && props.profileSource);
const sourceIsGrowth = computed(() => !!props.recordId && !sourceIsBirthday.value);
const sourceReady = computed(() =>
  sourceIsBirthday.value
    ? profileReady.value
    : sourceIsGrowth.value && !loading.value && !error.value,
);
const sourceBaby = computed(() =>
  sourceReady.value && sourceIsBirthday.value && baby.value?.id === props.recordId
    ? baby.value
    : null,
);
const sourceGrowth = computed(() =>
  sourceReady.value && sourceIsGrowth.value
    ? items.value.find((item) => item.id === props.recordId) || null
    : null,
);
const sourceGrowthMissing = computed(
  () => sourceIsGrowth.value && sourceReady.value && !sourceGrowth.value,
);
const showRegularPage = computed(() => !props.recordId || sourceGrowthMissing.value);
const focusRecord = useRecordFocus();
let babyLoadVersion = 0;
const measurements = computed(() => projectGrowthMeasurements(items.value));
const albumPhotos = computed(() => collectBabyAlbumPhotos(items.value));
const latestHeight = computed(() => measurements.value.height.at(-1));
const latestWeight = computed(() => measurements.value.weight.at(-1));
const age = computed(() => {
  if (!baby.value?.birthday) return '记录每一个第一次';
  return `来到我们身边的第 ${Math.max(1, Math.floor((new Date(today()).getTime() - new Date(baby.value.birthday).getTime()) / 86400000) + 1)} 天`;
});
const avatarIds = computed({
  get: () => (profile.avatarId ? [profile.avatarId] : []),
  set: (v) => (profile.avatarId = v[0] || null),
});
async function loadBaby() {
  if (profileBusy.value) return;
  const version = ++babyLoadVersion;
  babyLoading.value = true;
  babyLoaded.value = false;
  babyError.value = '';
  try {
    const result = await api.get('/baby');
    if (version !== babyLoadVersion) return;
    baby.value = result;
    babyLoaded.value = true;
  } catch (e) {
    if (version !== babyLoadVersion) return;
    babyError.value = e instanceof Error && e.message ? e.message : '宝宝档案暂时无法读取，请重试';
  } finally {
    if (version === babyLoadVersion) babyLoading.value = false;
  }
}
async function getAssets() {
  try {
    assets.value = await api.get('/assets');
  } catch {}
}
function editProfile() {
  if (profileBusy.value || !profileReady.value) return;
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
  profileOpen.value = true;
  getAssets();
}
async function saveProfile() {
  if (profileBusy.value || !profileReady.value) return;
  if (!profile.name.trim()) {
    ElMessage.warning('给宝宝填写一个名字吧');
    return;
  }
  profileSaving.value = true;
  try {
    baby.value = await api.put('/baby', { ...profile });
    profileOpen.value = false;
    ElMessage.success('宝宝的小档案已保存');
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    profileSaving.value = false;
  }
}
function edit(item: Growth | null = null) {
  if (editorBusy.value) return;
  editing.value = item;
  Object.assign(
    form,
    item
      ? { ...item, assetIds: item.assetIds || item.assets?.map((a) => a.id) || [] }
      : {
          title: '',
          date: today(),
          type: tab.value === 'all' ? 'growth' : tab.value,
          content: '',
          heightCm: null,
          weightKg: null,
          amountMl: null,
          durationMinutes: null,
          assetIds: [],
        },
  );
  dialog.value = true;
  getAssets();
}
async function submit() {
  if (editorBusy.value) return;
  if (!form.title.trim() || !form.date) {
    ElMessage.warning('请填写标题和日期');
    return;
  }
  const payload = {
    title: form.title,
    date: form.date,
    type: form.type,
    content: form.content,
    heightCm: form.type === 'growth' ? form.heightCm : null,
    weightKg: form.type === 'growth' ? form.weightKg : null,
    amountMl: form.type === 'feeding' ? form.amountMl : null,
    durationMinutes: form.type === 'sleep' ? form.durationMinutes : null,
    assetIds: form.assetIds,
  };
  try {
    await save(payload, editing.value?.id);
    dialog.value = false;
  } catch {}
}
onMounted(loadBaby);
</script>
<template>
  <PageHeader title="宝宝成长" description="小小的你，每一天都在长大；小小的事，我们都想记住。"
    ><el-button
      v-if="showRegularPage"
      type="primary"
      :disabled="!profileReady"
      @click="baby ? edit() : editProfile()"
      ><AppIcon name="plus" :size="16" />{{ baby ? '记下成长' : '创建宝宝档案' }}</el-button
    ></PageHeader
  >
  <LoadState v-if="!sourceIsGrowth" :loading="babyLoading" :error="babyError" @retry="loadBaby" />
  <CalendarSourceStatus v-if="sourceReady" path="/baby" :missing="!sourceBaby && !sourceGrowth" />
  <section
    v-if="baby && profileReady && (showRegularPage || sourceBaby)"
    :ref="sourceBaby ? focusRecord : undefined"
    :data-record-id="baby.id"
    :tabindex="sourceBaby ? -1 : undefined"
    :class="{ 'record-source-highlight': !!sourceBaby }"
    class="baby-profile panel"
  >
    <div class="baby-avatar">
      <el-image v-if="baby.asset" :src="assetUrl(baby.asset)" @error="refreshAssetOnError(baby.asset)" fit="cover" /><AppIcon
        v-else
        name="baby"
        :size="49"
      />
    </div>
    <div class="baby-intro">
      <p class="eyebrow">OUR LITTLE SUNSHINE</p>
      <h2>{{ baby.name }}的小小世界</h2>
      <p>
        {{ age }}<span v-if="baby.birthday"> · {{ baby.birthday }}</span>
      </p>
      <small v-if="baby.notes">{{ baby.notes }}</small>
    </div>
    <div v-if="!sourceBaby" class="baby-measurements">
      <div>
        <small>最近身高</small><strong>{{ latestHeight?.value ?? '—' }}<span>cm</span></strong>
      </div>
      <div>
        <small>最近体重</small><strong>{{ latestWeight?.value ?? '—' }}<span>kg</span></strong>
      </div>
    </div>
    <button v-if="showRegularPage" class="icon-button" title="编辑宝宝档案" @click="editProfile">
      <AppIcon name="edit" :size="18" />
    </button>
  </section>
  <div v-else-if="showRegularPage && profileReady" class="panel baby-onboarding">
    <EmptyState
      title="给小小的家人，留一片温柔的地方"
      description="创建宝宝档案后，就可以记录身高体重、喂养睡眠与每一个第一次。"
      icon="baby"
      action="创建宝宝档案"
      @action="editProfile"
    />
  </div>
  <div v-if="showRegularPage" class="baby-note">
    <AppIcon
      name="heart"
      :size="14"
    />这里是家庭成长记录。每个宝宝都有自己的节奏，让爱和陪伴慢慢发生。
  </div>
  <LoadState v-if="!sourceIsBirthday" :loading="loading" :error="error" @retry="load"
    ><section
      v-if="showRegularPage && (albumPhotos.length || (baby && profileReady))"
      class="baby-album"
      aria-labelledby="baby-album-title"
    >
      <div class="baby-album-heading">
        <div>
          <h2 id="baby-album-title">宝宝相册</h2>
          <p>从成长记录中自动整理的照片</p>
        </div>
        <span class="baby-album-count">{{ albumPhotos.length }} 张</span>
      </div>
      <div v-if="albumPhotos.length" class="baby-album-grid">
        <figure v-for="(photo, index) in albumPhotos" :key="photo.id" class="baby-album-photo">
          <el-image
            :src="assetUrl(photo.asset)"
            @error="refreshAssetOnError(photo.asset)"
            :preview-src-list="albumPhotos.map(({ asset }) => assetUrl(asset))"
            :initial-index="index"
            :alt="`${photo.title}，${photo.date}`"
            fit="cover"
            preview-teleported
          />
          <figcaption>
            <strong>{{ photo.title }}</strong>
            <time :datetime="photo.date">{{ photo.date }}</time>
          </figcaption>
        </figure>
      </div>
      <EmptyState
        v-else
        title="相册还在等待第一张照片"
        description="在成长记录中添加照片，它们会自动收进这里。"
        icon="baby"
      />
    </section>
    <GrowthChart v-if="showRegularPage" :records="items" />
    <div v-if="showRegularPage" class="toolbar">
      <div class="filter-tabs">
        <button class="filter-tab" :class="{ active: tab === 'all' }" @click="tab = 'all'">
          全部记录</button
        ><button
          v-for="(label, key) in growthTypes"
          :key="key"
          class="filter-tab"
          :class="{ active: tab === key }"
          @click="tab = key"
        >
          {{ label }}
        </button>
      </div>
    </div>
    <div v-if="filtered.length" class="growth-timeline">
      <article
        v-for="item in filtered"
        :key="item.id"
        :ref="item === sourceGrowth ? focusRecord : undefined"
        :data-record-id="item.id"
        :tabindex="item === sourceGrowth ? -1 : undefined"
        :class="{ 'record-source-highlight': item === sourceGrowth }"
        class="panel record-card"
      >
        <div class="flex items-start justify-between gap-4">
          <div>
            <span class="tag green">{{ growthTypes[item.type] }}</span>
            <h3 class="mt-3">{{ item.title }}</h3>
            <p class="record-date mt-2">{{ item.date }}</p>
          </div>
          <div class="flex shrink-0 gap-0.5">
            <button class="icon-button" title="编辑成长记录" @click="edit(item)">
              <AppIcon name="edit" :size="16" /></button
            ><button class="icon-button" title="删除成长记录" @click="remove(item)">
              <AppIcon name="trash" :size="16" />
            </button>
          </div>
        </div>
        <div v-if="item.type === 'growth'" class="growth-values">
          <span v-if="item.heightCm">{{ item.heightCm }} <small>cm</small></span
          ><span v-if="item.weightKg">{{ item.weightKg }} <small>kg</small></span>
        </div>
        <div v-if="item.amountMl" class="growth-values">
          <span>{{ item.amountMl }} <small>ml</small></span>
        </div>
        <div v-if="item.durationMinutes" class="growth-values">
          <span>{{ item.durationMinutes }} <small>分钟</small></span>
        </div>
        <p v-if="item.content" class="body-text">{{ item.content }}</p>
        <div v-if="item.assets?.length" class="photos-grid">
          <el-image
            v-for="asset in item.assets"
            :key="asset.id"
            :src="assetUrl(asset)"
            @error="refreshAssetOnError(asset)"
            :preview-src-list="item.assets.map(assetUrl)"
            fit="cover"
            preview-teleported
          />
        </div>
      </article>
    </div>
    <div v-else-if="showRegularPage" class="panel">
      <EmptyState
        title="每一次小进步，都值得被记住"
        description="第一次微笑、第一次翻身，或者今天的身高体重，都是珍贵的成长。"
        icon="baby"
        action="记下第一条成长"
        @action="edit()"
      /></div
  ></LoadState>
  <el-dialog
    v-model="profileOpen"
    :title="baby ? '宝宝的小档案' : '欢迎，小小家人'"
    width="min(520px,94vw)"
    :show-close="!profileBusy"
    :close-on-click-modal="!profileBusy"
    :close-on-press-escape="!profileBusy"
    ><el-form
      label-position="top"
      :model="profile"
      :disabled="profileSaving || !profileReady"
      @submit.prevent="saveProfile"
      ><el-form-item label="宝宝的名字" required
        ><el-input v-model="profile.name" maxlength="40" placeholder="小名、大名，都很好听"
      /></el-form-item>
      <div class="form-grid">
        <el-form-item label="生日"
          ><el-date-picker
            v-model="profile.birthday"
            type="date"
            value-format="YYYY-MM-DD" /></el-form-item
        ><el-form-item label="性别"
          ><el-select v-model="profile.gender"
            ><el-option value="unknown" label="先保密" /><el-option
              value="girl"
              label="女孩" /><el-option value="boy" label="男孩" /></el-select
        ></el-form-item>
      </div>
      <el-form-item label="头像"
        ><PhotoUpload
          v-model="avatarIds"
          :assets="assets"
          :limit="1"
          :disabled="profileSaving || !profileReady"
          @busy="profileUploading = $event" /></el-form-item
      ><el-form-item label="想说的话"
        ><el-input v-model="profile.notes" type="textarea" :rows="3" maxlength="500"
      /></el-form-item>
      <div class="flex justify-end gap-2.5 pt-4">
        <el-button :disabled="profileBusy" @click="profileOpen = false">取消</el-button
        ><el-button
          type="primary"
          native-type="submit"
          :loading="profileSaving"
          :disabled="profileUploading || !profileReady"
          >保存小档案</el-button
        >
      </div></el-form
    ></el-dialog
  ><el-dialog
    v-model="dialog"
    :title="editing ? '修改成长记录' : '记录成长的这一刻'"
    width="min(580px,94vw)"
    :show-close="!editorBusy"
    :close-on-click-modal="!editorBusy"
    :close-on-press-escape="!editorBusy"
    ><el-form label-position="top" :model="form" :disabled="saving" @submit.prevent="submit"
      ><el-form-item label="记录类型"
        ><el-select v-model="form.type"
          ><el-option
            v-for="(label, key) in growthTypes"
            :key="key"
            :label="label"
            :value="key" /></el-select></el-form-item
      ><el-form-item label="标题" required
        ><el-input
          v-model="form.title"
          maxlength="120"
          placeholder="例如：第一次自己翻身啦" /></el-form-item
      ><el-form-item label="日期" required
        ><el-date-picker v-model="form.date" type="date" value-format="YYYY-MM-DD"
      /></el-form-item>
      <div v-if="form.type === 'growth'" class="form-grid">
        <el-form-item label="身高（cm）"
          ><el-input-number
            v-model="form.heightCm"
            :min="1"
            :max="250"
            :precision="1"
            controls-position="right" /></el-form-item
        ><el-form-item label="体重（kg）"
          ><el-input-number
            v-model="form.weightKg"
            :min="0.1"
            :max="200"
            :precision="2"
            controls-position="right"
        /></el-form-item>
      </div>
      <el-form-item v-if="form.type === 'feeding'" label="奶量（ml）"
        ><el-input-number
          v-model="form.amountMl"
          :min="1"
          :max="3000"
          controls-position="right" /></el-form-item
      ><el-form-item v-if="form.type === 'sleep'" label="睡眠时长（分钟）"
        ><el-input-number
          v-model="form.durationMinutes"
          :min="1"
          :max="1440"
          controls-position="right" /></el-form-item
      ><el-form-item label="小记录"
        ><el-input
          v-model="form.content"
          type="textarea"
          :rows="4"
          maxlength="5000"
          placeholder="今天发生了什么？" /></el-form-item
      ><el-form-item label="成长照片"
        ><PhotoUpload
          v-model="form.assetIds"
          :assets="[...assets, ...(editing?.assets || [])]"
          :disabled="saving"
          @busy="uploading = $event"
      /></el-form-item>
      <div class="flex justify-end gap-2.5 pt-4">
        <el-button :disabled="editorBusy" @click="dialog = false">取消</el-button
        ><el-button type="primary" native-type="submit" :loading="saving" :disabled="uploading"
          >收藏这份成长</el-button
        >
      </div></el-form
    ></el-dialog
  >
</template>
