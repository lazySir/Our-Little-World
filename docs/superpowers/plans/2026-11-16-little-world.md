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
- [x] Implement matching API pages, chooseImage/uploadFile/previewImage, forms and confirmation via Wot; verify TypeScript and client regression tests.
- [x] Compile H5 and mp-weixin separately to `apps/uni/dist/build/{h5,mp-weixin}`.
- [x] Complete uni H5 browser integration: real records, two-photo upload, pending-upload lock, anniversary/baby flows, themes, export and ZIP restore with session continuity and missing-photo recovery.
- [x] Complete repeatable guest-simulator acceptance with actual WeChat requests, native upload/download, all 12 routes and ZIP restore against isolated storage; keep real-device acceptance separate.
- [ ] WeChat image-picker/permission/file-sharing acceptance on a real device; requires the actual AppID, allowed HTTPS domains and WeChat environment.

## Workstream 5 — delivery and independent review

- [x] Root scripts for init/dev/start/demo, Docker multi-stage configuration and Compose volumes, .env.example, Windows local start, runtime health; script regression checks pass. Docker image build, isolated runtime/restart/ZIP recovery and Compose health/volumes were verified on 2026-11-17.
- [x] Chinese README with quick start, local/LAN/HTTPS, ports, credentials created by user, responsive mobile Web, WeChat AppID/domain requirements, and backup restore.
- [x] Independent spec review then quality/security review; fix confirmed findings with regression tests and commits. Subsequent findings are tracked in docs/VERIFICATION.md.
- [x] Run all API/shared tests and Web/uni H5/mp-weixin builds. Browser E2E creates owner, joins partner, creates and reloads records, uploads image, checks mobile width and main flows.
- [x] Inspect git log/status and push each completed module to the supplied remote. Keep final verification results and platform limitations in docs/VERIFICATION.md.

## Recorded verification — 2026-11-17

- Latest complete unit suite: 142 passed (shared 12, API 43, Web 23, uni 55, deployment scripts 9); root TypeScript check passed. Script tests cover environment paths, initialization, Windows process cleanup and configurable Web test ports.
- Shared/API/Web/mp-weixin/H5 production builds passed after the midnight correction. The final editor/order changes were rebuilt for Web and both uni targets; root TypeScript was repeated successfully.
- `node --experimental-strip-types scripts/verify-demo.mts` passed against disposable storage: 1 space, 2 users, 16 records; repeat initialization refused without changing any record.
- Full browser runs passed Web 10/10 and uni H5 3/3, including real photo/ZIP recovery and delayed save requests. Independent cleanup checks passed 2/2 when run after browser tests. Web uses local port 5184 via WEB_E2E_BASE because 5174 belongs to another project.
- Confirmed and repaired WeChat PATCH transport, upload-before-save race, restore login continuity, older order access, omitted order PATCH fields, missing/damaged-photo recovery, the 1000-record history/statistics and 1000-photo truncation, and backup size-limit consistency. Web photo forms now prevent cancellation/ESC/overlay closure and Enter submission while uploading, and lock photo changes while saving; real browser regression covers all five editors.
- Later independent review repaired stale connection/status/session races, service-date inconsistencies, cached midnight mood writes, stale next-day mood inputs, duplicate ledger/order submissions and drafts lost during saves. New regressions were observed failing before each fix; the exact 10MiB photo boundary already worked and received coverage without production changes.
- Local production was updated on port 3003 while retaining its existing space (`initialized: true`). Health, desktop/mobile login rendering, no horizontal overflow and no page errors passed; the host can also reach the LAN address 192.168.1.3:3003. No daily records were created by the validation.
- uni archive branches verify temporary-path sharing, neutral cancellation and readable unsupported-version/transfer errors; real WeChat AppID, allowed HTTPS domains and device acceptance remain outstanding.
- Docker Desktop 29.8.1 real image build and isolated runtime passed: migration, UID 1000, production desktop/mobile Web, real account/record/photo writes, restart persistence, existing session/login, ZIP restore. Actual Compose named volumes and container health also passed. Disposable validation resources were removed; normal Node service/data and other containers were preserved.

## Recorded verification — 2026-11-19

- Full unit suite: 191 passed (shared 12, API 43, Web 47, uni 67, deployment and acceptance scripts 22); root TypeScript passed. Shared/API/Web/mp-weixin/H5 production builds passed.
- Web browser acceptance passed 12/12, uni H5 passed 4/4, and isolated lifecycle cleanup passed 2/2. New browser flows cover failed profile refresh, offline exit through both Web entry points, pending mood controls, retained failed drafts and real retry persistence.
- Confirmed defects were reproduced before repair: Web authentication recovery and real 401 expiry, stale list results/errors/loading in both clients, mood controls changing during a pending write, uni page/refresh loads overwriting a failed mood draft, and cached future-letter dates after midnight. Real SFC/composable tests cover delayed requests, session checks, native lifecycle event arguments and controlled dates.
- Repeatable WeChat guest-simulator acceptance passed 8 core/media checks, including actual native photo upload/download and ZIP restore, with no runtime or cleanup errors. Actual AppID, allowed HTTPS domains, device permissions, preview and file-sharing acceptance remain unchecked above.
- Local production retained its existing space on port 3003. Read-only health/status and production login rendering at 1440px/375px passed, without horizontal overflow or page script errors. Docker runtime evidence remains the dated November 17 baseline; the engine was not running for this later iteration.

## Completion audit correction — mini program home wishes

The requirement-by-requirement audit found that the mini program home did not render `dashboard.pendingWishes`, although the API and Web already support it. Keep the existing home layout and reuse Wot cells plus the shared empty-state component. Show at most four pending titles with optional target dates between the feature shortcuts and recent memories. Each row, the section link and the empty-state action open the existing wishes tab. Do not add a second completion action or another API request.

- [x] Extend `apps/uni/tests/dashboard.test.ts` to render the real SFC and verify data rows, the four-item limit, optional dates, empty state and navigation. Observe the missing-section failures before implementation.
- [x] Add the section to `apps/uni/src/pages/home/index.vue` without changing mood-save or refresh behavior. Run `npm run test:uni` and `npm run typecheck`.
- [x] Extend `apps/uni/tests/e2e/h5.spec.ts` and `scripts/verify-wechat.mts` to check a real saved wish on the home page and its navigation; verify that completing a wish removes it from the H5 preview.
- [x] Run H5 browser acceptance and H5/mp-weixin builds; inspect the H5 preview. Reproduce and fix Wot's title-width restriction before the final four-test browser run. Update verification records with the actual simulator failure and the old-home comparison. Keep explicit staging and immediate push discipline below.
- [ ] Re-run the 7 core / 9 complete WeChat checks and inspect the actual `home-wishes.png`. Five candidate attempts and a separately built `efe03ea` home baseline all timed out before App readiness; no new business flow was validated. At that home-wishes iteration, the full unit suite was 196 (shared 12, API 43, Web 47, uni 72, scripts 22). Real AppID/domain/device acceptance above is also still outstanding.

## Data-protection correction — baby profile loading

The daily-use audit found a confirmed data-loss path in both clients: an unknown or failed baby-profile GET was treated as a successful empty profile, allowing a PUT with default values to overwrite an existing birthday, gender, notes and avatar. Keep the existing optional profile and growth-record structure. Distinguish unknown/loading/failure from a successful null, offer retry, and allow profile writes only after a successful read.

- [x] Add real SFC regression tests in both clients and observe the missing protection fail before implementation. Cover pending/failed reads, retrying existing/null, field/avatar retention, latest-read-wins, unknown errors and existing upload/save locks.
- [x] Apply the localized loading/success/error guards in the two baby pages. Preserve the growth resource flow; skip uni profile reloads during its editor/save, and use the successful PUT response.
- [x] Add real API-backed browser regressions for both clients, delay/fail the initial GET, retry and edit only the name, then reload and verify the original record ID, birthday, gender, notes and uploaded avatar. Verify each test independently in a fresh isolated database, then the complete suites.
- [x] Verify 215 unit tests, root TypeScript, Web 13/13, H5 5/5, cleanup 2/2, shared/API/Web/mp-weixin/H5 production builds, and inspect 375px/390px error and recovered screenshots. Independent review found no blocking issue. Production 3003 health/status and its served build match without changing daily data.
- [x] Record the separate native-minimal WeChat comparison: the same App-readiness timeout with no business code; no business checks executed, no cleanup errors, and no definitive internal root cause. The unchecked latest-simulator and real-device requirements above remain unchecked.

## Daily-detail acceptance — Web ledger and wishes

- [x] Reproduce desktop-to-phone ledger overflow in a real browser (268px after a 12-second poll); add `min-w-0` only to the two chart grid items, and pass the same regression.
- [x] Extend the existing browser suite with cross-year/month filtering, exact monetary aggregates, live ECharts category/day values, edit/reload/API persistence and wish category/search/completion/reopening checks. Preserve the original 13 cases; full Web suite passes 15/15.
- [x] Inspect 1440px/375px chart screenshots after real animation completion. Confirm 215 unit tests, root TypeScript, production Web build and read-only existing production health/build identity. Independent review finds no blocking issue; commit and immediately push this module separately.

## Commit discipline

Each worker stages only their owned files, never `git add .` in shared repo. Root serializes commits on request to avoid index locks. No video, database, uploads, tokens, node_modules or build output committed. Destructive filesystem operations limited to verified workspace temporary/generated paths.
