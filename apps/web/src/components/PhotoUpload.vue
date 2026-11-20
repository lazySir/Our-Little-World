<script setup lang="ts">
import type { Asset } from '../types';
import { computed, ref } from 'vue';
import { ElMessage } from 'element-plus';
import { upload, assetUrl, refreshAssetOnError } from '../api';
const props = withDefaults(
  defineProps<{ modelValue?: string[]; assets?: Asset[]; limit?: number; disabled?: boolean }>(),
  { modelValue: () => [], assets: () => [], limit: 12 },
);
const emit = defineEmits(['update:modelValue', 'uploaded', 'busy']);
const added = ref<Asset[]>([]),
  busy = ref(false);
const photos = computed(() =>
  props.modelValue
    .map((id) => [...props.assets, ...added.value].find((a) => a.id === id))
    .filter(Boolean),
);
async function choose(event: Event) {
  if (busy.value || props.disabled) return;
  const files = Array.from((event.target as HTMLInputElement).files || []);
  if (!files.length) return;
  if (files.length + props.modelValue.length > props.limit) {
    ElMessage.warning(`最多选择 ${props.limit} 张照片`);
    (event.target as HTMLInputElement).value = '';
    return;
  }
  busy.value = true;
  emit('busy', true);
  try {
    for (const file of files) {
      if (
        !['image/jpeg', 'image/png', 'image/webp', 'image/gif'].includes(file.type) ||
        file.size > 10 * 1024 * 1024
      ) {
        ElMessage.error('请选择 10 MB 以内的 JPG、PNG、WebP 或 GIF 图片');
        continue;
      }
      const asset = await upload(file);
      added.value.push(asset);
      emit('update:modelValue', [...props.modelValue, asset.id]);
      emit('uploaded', asset);
    }
  } catch (e) {
    ElMessage.error(e.message);
  } finally {
    busy.value = false;
    emit('busy', false);
    (event.target as HTMLInputElement).value = '';
  }
}
</script>
<template>
  <div class="photo-uploader">
    <div class="upload-photos">
      <div v-for="photo in photos" :key="photo.id" class="upload-photo">
        <el-image
          :src="assetUrl(photo)"
          @error="refreshAssetOnError(photo)"
          fit="cover"
          :preview-src-list="photos.map(assetUrl)"
          preview-teleported
        /><button
          type="button"
          class="photo-remove"
          aria-label="移除照片"
          :disabled="busy || disabled"
          @click="
            emit(
              'update:modelValue',
              modelValue.filter((id) => id !== photo.id),
            )
          "
        >
          <AppIcon name="close" :size="14" />
        </button>
      </div>
      <label v-if="modelValue.length < limit" class="upload-add" :class="{ busy }"
        ><AppIcon name="plus" :size="24" /><span>{{ busy ? '上传中…' : '添加照片' }}</span
        ><input
          type="file"
          accept="image/jpeg,image/png,image/webp,image/gif"
          :multiple="limit > 1"
          :disabled="busy || disabled"
          @change="choose"
      /></label>
    </div>
    <small>每张不超过 10 MB，最多 {{ limit }} 张。上传后保存记录即可归档。</small>
    <small class="photo-original-note">服务端仅保存优化后的照片，重要原片请另行保存。</small>
  </div>
</template>
