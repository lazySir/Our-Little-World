import { shallowRef, watch, type ComponentPublicInstance } from 'vue';

export function useRecordFocus() {
  const target = shallowRef<HTMLElement | null>(null);
  watch(
    target,
    (element, _, onCleanup) => {
      if (!element) return;
      // Wait for the router's top-of-page scroll before bringing the card into view.
      const frame = requestAnimationFrame(() => {
        if (!element.isConnected) return;
        element.focus({ preventScroll: true });
        element.scrollIntoView({ block: 'nearest' });
      });
      onCleanup(() => cancelAnimationFrame(frame));
    },
    { flush: 'post' },
  );
  return (element: Element | ComponentPublicInstance | null) => {
    target.value = element instanceof HTMLElement ? element : null;
  };
}
