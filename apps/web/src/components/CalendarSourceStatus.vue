<script setup lang="ts">
defineProps<{ path: string; missing: boolean }>();
</script>

<template>
  <div class="mb-4 flex flex-wrap items-center justify-between gap-3">
    <el-alert
      v-if="missing"
      title="找不到这条记录，可能已删除。"
      type="warning"
      show-icon
      :closable="false"
    />
    <span v-else class="tag green">来自共享日历</span>
    <router-link :to="path" replace class="text-link">查看全部</router-link>
  </div>
</template>
