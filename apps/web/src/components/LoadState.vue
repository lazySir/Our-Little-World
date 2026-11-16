<script setup lang="ts">
defineProps({ loading: Boolean, error: String });
defineEmits(['retry']);
</script>
<template>
  <el-alert
    v-if="error"
    :title="error"
    type="error"
    show-icon
    :closable="false"
    class="error-banner"
    ><template #default
      ><el-button text @click="$emit('retry')">重新连接</el-button></template
    ></el-alert
  ><el-skeleton v-if="loading" :rows="5" animated class="panel skeleton" /><slot v-else />
</template>
