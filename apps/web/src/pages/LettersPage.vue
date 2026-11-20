<script setup lang="ts">
import ResourcePage from './ResourcePage.vue';
defineProps<{ recordId?: string }>();
</script>
<template><ResourcePage kind="letters" :record-id="recordId" /></template>
