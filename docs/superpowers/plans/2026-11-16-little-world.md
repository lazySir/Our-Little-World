# Our Little World Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to execute the independent API, Web, and uni-app workstreams. Check evidence before every feature commit.

**Goal:** Deliver a private two-person family product covering Web, WeChat mini program, mobile App, local deployment, and per-module Git commits.

**Architecture:** npm monorepo; NestJS JavaScript API, Prisma SQLite, Vue3/Vite/Element Plus Web, Vue3/Vite/uni-app/Wot mobile clients. Exact data shapes and status rules are in docs/API-CONTRACT.md; authoritative product scope in docs/PRODUCT.md.

**Tech Stack:** NestJS 11, Prisma 6, SQLite, JavaScript, Vue3, Vite, Element Plus, ECharts, Pinia, uni-app, Wot Design Uni, node:test, Playwright.

## Workstream 1 — foundation and shared logic

- [ ] Create root package.json npm workspaces `apps/*`, `packages/*`, scripts for all builds/tests/dev/demo.
- [ ] packages/shared: write node:test expectations for cents parsing and leap-day anniversaries, run red, implement domain helpers, run green.
- [ ] Commit `🔧 chore: 初始化多端工程与统一开发脚本`.

## Workstream 2 — API and persistence (apps/api only)

- [ ] Build Nest bootstrap with JavaScript explicit decorators, Prisma provider, Zod validation and exception mapping.
- [ ] Commit migration/schema: `💾 sql: 建立双人空间与生活模块数据库`.
- [ ] Write real SQLite integration tests before auth routes: setup once, login, join two only, session revocation and unauthenticated denial. Implement and run green. Commit `✨ feat: 添加双人账号与空间配对`.
- [ ] CRUD wishes/menu/orders with ownership and quantity validation; ledger integers and real-date validation. Integration tests cover update/delete and totals. Commit per module.
- [ ] CRUD anniversaries, memories/assets, baby/growth, work and locked letters with server-enforced unlock. Integrate each with tests and independent module commit.
- [ ] Backups/export/restore roundtrip and invalid archive rejection. Add demo seeding behind explicit command. Commit per module.

## Workstream 3 — Web (apps/web only)

- [ ] Vue3/Vite/Element Plus/Pinia/Router foundation, cream/rose/sage tokens, original vector house illustration, responsive shell.
- [ ] Setup/login/join, session store, authenticated navigation, accessible reusable forms/dialogs and API client. Commit verified foundation.
- [ ] Dashboard with real API data and mood entry; independent commit.
- [ ] Full CRUD pages for plans/meals/ledger/memories/anniversaries/baby/work/letters, each connected to documented endpoints, each independently committed after build.
- [ ] Settings for profiles/invite/API URL/theme/password/export/backup/restore; PWA metadata and offline feedback. Commit.

## Workstream 4 — cross-platform client (apps/uni only)

- [ ] Clone official Vue3/Vite preset versions; add Wot Design Uni and Pinia. Default empty AppID with documented configuration.
- [ ] Token/API persistence, setup/login/join, bottom navigation and warm styling. Commit.
- [ ] Pages cover the same actual API workflows as Web, native chooseImage/uploadFile/previewImage, forms and confirmation via Wot. Commit per module.
- [ ] Compile H5, mp-weixin, app-plus separately. Produce miniprogram build folder and App resources; attempt runnable Android packaging when tools can be provisioned.

## Workstream 5 — delivery and independent review

- [ ] Root scripts for install/init/dev/start/demo, Docker multi-stage build and Compose volume, .env.example, Windows local start, runtime health.
- [ ] README in Chinese with quick start, local/LAN/HTTPS, ports, credentials created by user, WeChat AppID/domain requirements, App signing/build steps, backup restore.
- [ ] Independent spec review then quality/security review; fix meaningful findings with regression tests and commits.
- [ ] Run all API/shared tests; Web/uni H5/mp-weixin/app builds. Browser E2E creates owner, joins partner, creates and reloads records, uploads image, checks mobile width and main flows.
- [ ] Inspect git log/status, push to supplied remote if existing auth permits, report delivery and real platform limitations accurately.

## Commit discipline

Each worker stages only their owned files, never `git add .` in shared repo. Root serializes commits on request to avoid index locks. No video, database, uploads, tokens, node_modules or build output committed. Destructive filesystem operations limited to verified workspace temporary/generated paths.

