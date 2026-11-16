<script setup lang="ts">
defineProps({ eyebrow: { default: 'OUR LITTLE WORLD' }, title: String, description: String });
</script>
<template>
  <header class="page-header">
    <div>
      <p class="eyebrow">{{ eyebrow }}</p>
      <h1>{{ title }}</h1>
      <p v-if="description" class="page-description">{{ description }}</p>
    </div>
    <div class="header-actions"><slot /></div>
  </header>
</template>
