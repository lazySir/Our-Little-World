<script setup lang="ts">
import ResourcePage from './ResourcePage.vue';
defineProps<{ recordId?: string }>();
</script>
<template><ResourcePage kind="memories" :record-id="recordId" /></template>
