<template>
  <view>
    <view class="photo-grid">
      <view v-for="(photo, index) in modelValue" :key="photo.id" class="photo-wrap">
        <image
          class="photo"
          :src="assetUrl(photo)"
          mode="aspectFill"
          @click="previewPhotos(modelValue, index)"
        />
        <view v-if="!busy && !disabled" class="remove-photo" @click="remove(index)">×</view>
      </view>
      <view v-if="modelValue.length < max && !disabled" class="upload-tile" @click="add">
        <view>{{ busy ? '上传中…' : '＋ 添加照片' }}<view class="small">相册 / 拍摄</view> </view>
      </view>
    </view>
    <view class="form-note">{{ modelValue.length }} / {{ max }} 张 · 每张不超过 10 MB</view>
    <view v-if="error" class="error-box">{{ error }}</view>
  </view>
</template>
<script setup lang="ts">
import { ref } from 'vue';
import { choosePhotos, uploadFile, assetUrl, previewPhotos } from '../lib/api';
import type { Asset } from '../types';
const props = withDefaults(
  defineProps<{
    modelValue?: Asset[];
    max?: number;
    disabled?: boolean;
  }>(),
  { modelValue: () => [], max: 9 },
);
const emit = defineEmits(['update:modelValue', 'busy']);
const busy = ref(false),
  error = ref('');
async function add() {
  if (busy.value || props.disabled) return;
  error.value = '';
  busy.value = true;
  emit('busy', true);
  try {
    const paths = await choosePhotos(props.max - props.modelValue.length);
    const result = [...props.modelValue];
    for (const path of paths) {
      result.push(await uploadFile(path));
      emit('update:modelValue', [...result]);
    }
  } catch (e) {
    error.value = e.message;
  } finally {
    busy.value = false;
    emit('busy', false);
  }
}
function remove(index) {
  if (busy.value || props.disabled) return;
  emit(
    'update:modelValue',
    props.modelValue.filter((_, i) => i !== index),
  );
}
</script>
