<template>
  <view class="calendar-source-heading">
    <view class="toolbar">
      <view class="section-title grow">来自共享日历</view>
      <wd-button class="calendar-source-clear" size="small" plain @click="emit('clear')">
        查看全部
      </wd-button>
    </view>
    <view v-if="missing" class="note" role="status">找不到这条记录，可能已删除。</view>
  </view>
</template>

<script setup lang="ts">
defineProps<{ missing: boolean }>();
const emit = defineEmits<{ clear: [] }>();
</script>
