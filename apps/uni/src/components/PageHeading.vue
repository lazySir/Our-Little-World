<template>
  <view>
    <view class="between">
      <view>
        <view class="eyebrow">{{ eyebrow }}</view>
        <view class="title" style="margin-top: 9rpx">{{ title }}</view>
      </view>
      <view v-if="symbol" class="heading-symbol">{{ symbol }}</view>
    </view>
    <view v-if="description" class="subtitle">{{ description }}</view>
  </view>
</template>
<script setup lang="ts">
defineProps({
  title: String,
  description: String,
  eyebrow: { type: String, default: 'OUR LITTLE WORLD' },
  symbol: String,
});
</script>
<style scoped>
.heading-symbol {
  font-size: 50rpx;
  color: #c5ab7d;
  transform: rotate(8deg);
  padding: 10rpx;
}
</style>
