<template>
<wd-popup :model-value="modelValue" position="bottom" closable safe-area-inset-bottom :close-on-click-modal="!saving" :z-index="50" @update:model-value="$emit('update:modelValue',$event)">
<view class="sheet">
<view class="sheet-header">
<view class="section-title">{{ title }}</view>
</view>
<scroll-view scroll-y class="sheet-scroll">
<slot/>
<view v-if="error" class="error-box">{{ error }}</view>
</scroll-view>
<view class="sheet-footer">
<wd-button block plain :disabled="saving" @click="$emit('update:modelValue',false)">先放一放</wd-button>
<wd-button block :loading="saving" @click="$emit('save')">{{ saveText }}</wd-button>
</view>
</view>
</wd-popup>
</template>
<script setup lang="ts">
defineProps({ modelValue: Boolean, title: String, saving: Boolean, error: String, saveText: { type: String, default: '保存这一刻' } });
defineEmits(['update:modelValue', 'save']);
</script>



