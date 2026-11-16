<template>
  <view class="form-field">
    <view class="form-label">{{ label }}<text v-if="required" class="required">*</text> </view>
    <view v-if="kind === 'date'" class="field-control">
      <picker
        mode="date"
        :value="String(modelValue || '')"
        :start="min"
        :end="max"
        @change="$emit('update:modelValue', $event.detail.value)"
      >
        <view class="date-input">
          <text :class="{ muted: !modelValue }">{{ modelValue || placeholder || '选择日期' }}</text>
          <text class="muted">▾</text>
        </view>
      </picker>
      <view
        v-if="modelValue && !required"
        class="text-action"
        style="padding: 0 24rpx 14rpx"
        @click="$emit('update:modelValue', '')"
        >清除日期</view
      >
    </view>
    <view v-else-if="kind === 'select'" class="chips">
      <view
        v-for="option in options"
        :key="option.value"
        class="chip"
        :class="{ active: modelValue === option.value }"
        @click="$emit('update:modelValue', option.value)"
        >{{ option.label }}</view
      >
    </view>
    <view v-else-if="kind === 'switch'" class="switch-row">
      <view class="muted">{{ placeholder }}</view>
      <wd-switch
        :model-value="!!modelValue"
        @update:model-value="$emit('update:modelValue', $event)"
      />
    </view>
    <view v-else class="field-control">
      <wd-textarea
        v-if="kind === 'textarea'"
        :model-value="String(modelValue ?? '')"
        :placeholder="placeholder"
        :maxlength="maxlength"
        :show-word-limit="true"
        auto-height
        @update:model-value="$emit('update:modelValue', $event)"
      />
      <wd-input
        v-else
        :model-value="modelValue ?? ''"
        :type="kind === 'number' ? 'digit' : 'text'"
        :show-password="kind === 'password'"
        :placeholder="placeholder"
        :maxlength="maxlength"
        no-border
        clearable
        @update:model-value="$emit('update:modelValue', $event)"
      />
    </view>
    <view v-if="hint" class="form-note">{{ hint }}</view>
  </view>
</template>
<script setup lang="ts">
withDefaults(
  defineProps<{
    modelValue?: string | number | boolean;
    label?: string;
    required?: boolean;
    placeholder?: string;
    hint?: string;
    kind?: string;
    options?: {
      value: string;
      label: string;
    }[];
    maxlength?: number;
    min?: string;
    max?: string;
  }>(),
  { kind: 'text', options: () => [], maxlength: 1000 },
);
defineEmits(['update:modelValue']);
</script>
