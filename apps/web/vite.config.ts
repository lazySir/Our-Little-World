import { defineConfig } from 'vite';
import vue from '@vitejs/plugin-vue';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
export default defineConfig({
  plugins: [vue(), tailwindcss(), VitePWA({
    registerType: 'autoUpdate',
    manifest: {
      name: '我们的小世界',
      short_name: '小世界',
      description: '两个人的私人生活手账',
      lang: 'zh-CN',
      theme_color: '#f8f5eb',
      background_color: '#f8f5eb',
      display: 'standalone',
      start_url: '/',
      scope: '/',
      icons: [
        { src: '/icon-192.png', sizes: '192x192', type: 'image/png', purpose: 'any' },
        { src: '/icon-512.png', sizes: '512x512', type: 'image/png', purpose: 'any maskable' },
        { src: '/icon.svg', sizes: 'any', type: 'image/svg+xml', purpose: 'any' },
      ],
    },
    workbox: { navigateFallbackDenylist: [/^\/api/], globPatterns: ['**/*.{js,css,html,svg,woff2}'], maximumFileSizeToCacheInBytes: 4000000 }
  })],
  server: { port: 5173, proxy: { '/api': { target: process.env.API_PROXY_TARGET || 'http://127.0.0.1:3000', changeOrigin: true } } },
  build: { chunkSizeWarningLimit: 1200, rollupOptions: { output: { manualChunks: { vue: ['vue', 'vue-router', 'pinia'], element: ['element-plus'], charts: ['echarts'] } } } }
});
