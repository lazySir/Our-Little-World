<template>
  <view class="form-field" :class="{ 'is-disabled': locked }">
    <view class="form-label">{{ label }}<text v-if="required" class="required">*</text> </view>
    <view v-if="kind === 'date'" class="field-control">
      <picker
        mode="date"
        :value="String(modelValue || '')"
        :start="min"
        :end="max"
        :disabled="locked"
        @change="update($event.detail.value)"
      >
        <view class="date-input">
          <text :class="{ muted: !modelValue }">{{ modelValue || placeholder || '选择日期' }}</text>
          <text class="muted">▾</text>
        </view>
      </picker>
      <button
        v-if="modelValue && !required"
        class="text-action ui-reset"
        aria-label="清除日期"
        style="padding: 0 24rpx 14rpx"
        @click="update('')"
      >
        清除日期
      </button>
    </view>
    <view v-else-if="kind === 'select'" class="chips">
      <button
        v-for="option in options"
        :key="option.value"
        class="chip ui-reset"
        :class="{ active: modelValue === option.value }"
        :aria-label="`${option.label}，${modelValue === option.value ? '已选中' : '未选中'}`"
        :aria-pressed="modelValue === option.value"
        @click="update(option.value)"
        >{{ option.label }}</button
      >
    </view>
    <view v-else-if="kind === 'switch'" class="switch-row">
      <view class="muted">{{ placeholder }}</view>
      <wd-switch
        :model-value="!!modelValue"
        :disabled="locked"
        @update:model-value="update($event)"
      />
    </view>
    <view v-else class="field-control">
      <wd-textarea
        v-if="kind === 'textarea'"
        :model-value="String(modelValue ?? '')"
        :placeholder="placeholder"
        :maxlength="maxlength"
        :show-word-limit="true"
        :disabled="locked"
        auto-height
        @update:model-value="update($event)"
      />
      <wd-input
        v-else
        :model-value="modelValue ?? ''"
        :type="kind === 'number' ? 'digit' : 'text'"
        :show-password="kind === 'password'"
        :placeholder="placeholder"
        :maxlength="maxlength"
        :disabled="locked"
        no-border
        clearable
        @update:model-value="update($event)"
      />
    </view>
    <view v-if="hint" class="form-note">{{ hint }}</view>
  </view>
</template>
<script setup lang="ts">
import { computed, inject } from 'vue';
import { editorSavingKey } from './editor';
const props = withDefaults(
  defineProps<{
    modelValue?: string | number | boolean;
    disabled?: boolean;
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
  { kind: 'text', options: () => [], maxlength: 1000, disabled: false },
);
const emit = defineEmits(['update:modelValue']);
const editorSaving = inject(editorSavingKey, undefined);
const locked = computed(() => props.disabled || editorSaving?.value || false);
function update(value: string | number | boolean) {
  if (!locked.value) emit('update:modelValue', value);
}
</script>
<style scoped>
.is-disabled .chip,
.is-disabled .text-action {
  opacity: 0.55;
}
</style>
