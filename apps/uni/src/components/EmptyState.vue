<template>
<view class="empty text-center">
<view class="empty-symbol">{{ symbol }}</view>
<view class="empty-title font-semibold">{{ title }}</view>
<view class="empty-description leading-relaxed">{{ description }}</view>
<view v-if="action" class="mt-4">
<wd-button size="small" plain @click="$emit('action')">{{ action }}</wd-button>
</view>
</view>
</template>
<script setup lang="ts">
defineProps({ title: { type: String, default: '这一页，等我们一起写' }, description: { type: String, default: '从一件小事开始，把生活慢慢收藏起来。' }, symbol: { type: String, default: '✧' }, action: String });
defineEmits(['action']);
</script>



