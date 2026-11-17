import type { ComputedRef, InjectionKey } from 'vue';

export const editorSavingKey: InjectionKey<ComputedRef<boolean>> = Symbol('editorSaving');
