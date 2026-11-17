# Our Little World Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to execute the independent API, Web, and uni-app workstreams. Check evidence before every feature commit.

**Goal:** Deliver a private two-person family product covering responsive desktop/mobile Web, WeChat mini program, local deployment, and per-module Git commits. Keep the mini program H5 target for browser integration.

**Architecture:** npm monorepo; TypeScript NestJS API, Prisma SQLite, responsive Vue3/Vite/Element Plus/Tailwind Web, and Vue3/Vite/uni-app/Wot/Tailwind WeChat mini program with H5 integration support. Exact data shapes and status rules are in docs/API-CONTRACT.md; authoritative product scope in docs/PRODUCT.md.

**Tech Stack:** TypeScript throughout, NestJS 11, Prisma 6, SQLite, Vue3, Vite, Element Plus, Tailwind, ECharts, Pinia, uni-app, Wot Design Uni, weapp-tailwindcss, node:test, Playwright.

## Workstream 1 — foundation and shared logic

- [x] Create root package.json npm workspaces `apps/*`, `packages/*`, scripts for builds/tests/dev/demo.
- [x] packages/shared: write node:test expectations for cents parsing and leap-day anniversaries, implement TypeScript domain helpers, verify 12 tests.
- [x] Commit foundation and the later TypeScript shared-module migration.

## Workstream 2 — API and persistence (apps/api only)

- [x] Build TypeScript Nest bootstrap, Prisma provider, Zod validation and exception mapping.
- [x] Commit migration/schema: `💾 sql: 建立双人空间与生活模块数据库`.
- [x] Real SQLite integration tests: setup once, login, join two only, session revocation and unauthenticated denial; implement and commit authentication.
- [x] CRUD wishes/menu/orders with ownership and quantity validation; ledger integer cents and real-date validation, with integration coverage.
- [x] CRUD anniversaries, memories/assets, baby/growth, work and locked letters with server-enforced unlock, with integration coverage.
- [x] ZIP backup/export/restore, archive validation, automatic archive retention; explicit demo launcher verified on an isolated database and refuses a second run.

## Workstream 3 — Web (apps/web only)

- [x] TypeScript Vue3/Vite/Element Plus/Tailwind/Pinia/Router foundation, cream/rose/sage tokens, original vector house illustration, responsive shell.
- [x] Setup/login/join, session store, authenticated navigation, reusable forms/dialogs and API client; committed foundation.
- [x] Dashboard with real API data and mood entry; independent commit.
- [x] CRUD pages for plans/meals/ledger/memories/anniversaries/baby/work/letters, connected to documented endpoints and committed by module.
- [x] Settings for profiles/invite/API URL/theme/password/export/backup/restore; PWA metadata and offline feedback.

## Workstream 4 — WeChat mini program and H5 integration (apps/uni only)

- [x] Vue3/Vite/TypeScript preset; Wot Design Uni, Pinia, Tailwind and weapp-tailwindcss. Default empty AppID with documented configuration.
- [x] Token/API persistence, setup/login/join, bottom navigation and warm styling.
- [x] Implement matching API pages, chooseImage/uploadFile/previewImage, forms and confirmation via Wot; verify TypeScript and 16 client regression tests.
- [x] Compile H5 and mp-weixin separately to `apps/uni/dist/build/{h5,mp-weixin}`.
- [x] Complete uni H5 browser integration: real records, two-photo upload, pending-upload lock, anniversary/baby flows, themes, export and ZIP restore with session continuity and missing-photo recovery.
- [ ] WeChat image-picker/permission/file-sharing acceptance on a real device; requires the actual AppID, allowed HTTPS domains and WeChat environment.

## Workstream 5 — delivery and independent review

- [x] Root scripts for init/dev/start/demo, Docker multi-stage configuration and Compose volumes, .env.example, Windows local start, runtime health; script regression checks pass. Docker image build, isolated runtime/restart/ZIP recovery and Compose health/volumes were verified on 2026-11-17.
- [x] Chinese README with quick start, local/LAN/HTTPS, ports, credentials created by user, responsive mobile Web, WeChat AppID/domain requirements, and backup restore.
- [x] Independent spec review then quality/security review; fix confirmed findings with regression tests and commits. Subsequent findings are tracked in docs/VERIFICATION.md.
- [x] Run all API/shared tests and Web/uni H5/mp-weixin builds. Browser E2E creates owner, joins partner, creates and reloads records, uploads image, checks mobile width and main flows.
- [x] Inspect git log/status and push implementation to supplied remote; local and remote develop matched at b147b15 before the final verification-document commit. Platform limitations are explicitly recorded in docs/VERIFICATION.md.

## Recorded verification — 2026-11-17

- Shared domain tests: 12 passed; deployment script tests: 7 passed; scripts TypeScript and PowerShell syntax checks passed.
- Current shared/API TypeScript production build passed. A temporary production instance served Web, `/api/health` and the empty first-run response; managed Windows tree cleanup was denied, then the known test processes were stopped directly. This does not establish Docker or device acceptance.
- `node --experimental-strip-types scripts/verify-demo.mts` passed against disposable storage: 1 space, 2 users, 16 records; repeat initialization refused without changing any record.
- uni client TypeScript check, 16 client tests and H5/WeChat builds passed. H5 browser workflow passed; actual WeChat environment acceptance remains separate.
- Latest full suite: API 38, shared 12, Web 4, uni 16 and scripts 7 tests passed (77 total); root TypeScript check passed. Full browser runs passed Web 4/4 and uni H5 1/1. Independent cleanup checks passed 2/2. Shared/API/Web/mp-weixin/H5 production builds passed; the final Web-only edit was rebuilt and its affected checks repeated.
- Confirmed and repaired WeChat PATCH transport, upload-before-save race, restore login continuity, older order access, omitted order PATCH fields, missing/damaged-photo recovery, the 1000-record history/statistics and 1000-photo truncation, and backup size-limit consistency. Web photo forms now prevent cancellation/ESC/overlay closure and Enter submission while uploading, and lock photo changes while saving; real browser regression covers all five editors.
- Local production uses port 3003 because another application owns 3000. Health, empty first-run API, desktop/mobile production rendering, no horizontal overflow and no page errors were verified without creating a real account.
- Additional uni archive regressions passed 20/20 with typecheck, both platform builds and H5 E2E; temporary-path sharing avoids permanent cache accumulation, cancellation is neutral and failures provide readable guidance.
- Docker Desktop 29.8.1 real image build and isolated runtime passed: migration, UID 1000, production desktop/mobile Web, real account/record/photo writes, restart persistence, existing session/login, ZIP restore. Actual Compose named volumes and container health also passed. Disposable validation resources were removed; normal Node service/data and other containers were preserved.

## Commit discipline

Each worker stages only their owned files, never `git add .` in shared repo. Root serializes commits on request to avoid index locks. No video, database, uploads, tokens, node_modules or build output committed. Destructive filesystem operations limited to verified workspace temporary/generated paths.
