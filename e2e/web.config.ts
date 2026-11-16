import { defineConfig } from '@playwright/test';
export default defineConfig({ testDir: '.', testMatch: 'web.spec.ts', workers: 1, timeout: 180000, expect: { timeout: 12000 }, use: { baseURL: process.env.WEB_E2E_BASE || 'http://127.0.0.1:5174', headless: true, viewport: { width: 1440, height: 1050 }, screenshot: 'only-on-failure', trace: 'retain-on-failure' }, webServer: { command: 'node --import tsx e2e/web-server.mts', cwd: '..', url: 'http://127.0.0.1:5174', reuseExistingServer: !process.env.CI, timeout: 90000 }, outputDir: '../test-results/web', reporter: [['list']] });

