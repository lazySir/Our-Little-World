import { defineConfig, type PluginOption } from 'vite';
import uniModule from '@dcloudio/vite-plugin-uni';
import { UnifiedViteWeappTailwindcssPlugin } from 'weapp-tailwindcss/vite';
import tailwindcss from 'tailwindcss';
import autoprefixer from 'autoprefixer';
import { fileURLToPath } from 'node:url';

const uni = (uniModule as unknown as { default?: () => PluginOption }).default || uniModule;
export default defineConfig({
  plugins: [
    uni(),
    UnifiedViteWeappTailwindcssPlugin({
      appType: 'uni-app-vite',
      rem2rpx: true,
      disabled: process.env.UNI_PLATFORM === 'h5',
    }) as unknown as PluginOption,
  ],
  css: {
    postcss: {
      plugins: [
        tailwindcss(fileURLToPath(new URL('./tailwind.config.ts', import.meta.url))),
        autoprefixer(),
      ],
    },
    preprocessorOptions: {
      scss: { silenceDeprecations: ['legacy-js-api', 'import', 'global-builtin'] },
    },
  },
  server: { host: '0.0.0.0', port: 5174 },
});
