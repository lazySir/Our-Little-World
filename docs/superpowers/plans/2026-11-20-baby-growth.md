# 宝宝成长曲线 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development or superpowers:executing-plans to implement this plan task-by-task.

**Goal:** 在响应式 Web 与微信小程序页面补齐基于真实记录的身高、体重曲线。

**Architecture:** shared 负责不变异、独立指标、稳定排序的数据投影。Web Vue-ECharts 与 uni-echarts 组件只负责单位、切换和图形展示，宝宝页传入未筛选的 items；沿用资源加载和编辑逻辑。

**Tech Stack:** Vue 3、TypeScript、ECharts、Vue-ECharts、uni-echarts、Element Plus、Wot、现有 Tailwind。

## Task 1: 共享测量合同

Files: `packages/shared/src/growth.ts`、`packages/shared/test/growth.test.ts`、`packages/shared/package.json`。

- [x] 先写 `projectGrowthMeasurements` 测试：空、单点、身高体重独立、非法值及严格日期、同日全保留、createdAt/id 顺序、旧日期补录、所有资源类型、不变异。运行 `npx tsx --test packages/shared/test/growth.test.ts`，确认缺失投影导致失败。
- [x] 实现 `GrowthMeasurement`、`GrowthPoint` 与 `projectGrowthMeasurements`；导出 `./growth`。使用 `./date.js` 导入 `isValidDate`，不依赖客户端或图表库。运行该测试及 `npm run build:shared`。

## Task 2: Web 组件与页面

Files: `apps/web/src/components/GrowthChart.vue`、`apps/web/src/pages/BabyPage.vue`、`apps/web/src/style.css`、`apps/web/test/growth-chart.test.ts`、`apps/web/package.json`、`package-lock.json`。

- [x] 先测试独立指标切换、空态、单点、真实 ECharts option 数组、页面最新指标不被缺失值覆盖与图表接收未筛选记录。确认缺少曲线或旧摘要失败。
- [x] 安装 Vue-ECharts 8.3.2；使用 ECharts core 按需 LineChart、Grid、Tooltip 和 CanvasRenderer。图表自动调整，默认 tooltip 不插入用户标题。组件库切换值为 `height`／`weight`，模板展示中文单位。
- [x] 宝宝页通过共享投影分别取最近身高与体重，在资源 LoadState 内传入原始 items。保持既有档案加载及上传保存保护。定向单测、Web 类型检查；宝宝档案保持可选，无档案时已有测量仍显示曲线。

## Task 3: uni 组件与页面

Files: `apps/uni/src/components/GrowthChart.vue`、`apps/uni/src/pages/baby/index.vue`、`apps/uni/scripts/echarts-lifecycle.ts`、`apps/uni/tests/echarts-lifecycle.test.ts`、`apps/uni/tests/growth-chart.test.ts`、`apps/uni/tests/baby-profile.test.ts`、`apps/uni/tests/photos.test.ts`、`apps/uni/vite.config.ts`、`apps/uni/package.json`、`package-lock.json`。

- [x] 先写真实 SFC 状态／option 测试；根代理统一安装 uni-echarts 2.5.4 及 ECharts、维护插件和锁文件。
- [x] 依官方组件手动 `provideEcharts` 接入，并保留 Vite 的 `optimizeDeps.exclude`；同样仅注册折线所需模块，Wot segmented 切换单位。图表从原始 items 获取数据、loading/error 时不显示虚假空态。布局用现有卡片及 Tailwind，保持档案和编辑器行为。
- [x] 对 uni-echarts 2.5.4 的真实 SFC 先复现延迟初始化与 resize 查询期间的卸载竞态；用精确路径、源码片段计数和 MagicString sourcemap 的 pre-transform 补齐各异步边界，非目标不改、源码漂移明确失败。另为 `shared-core.js` 的延迟触摸查询加代次失效，覆盖页面清理、触摸结束、重叠操作、实例替换/销毁及旧查询拒绝；保留当前请求错误传播，并修正副本路径与 source map 指向。
- [x] 复现 mp 条件处理器抢先删去 WEB 锚点的构建失败；使用真实 Vite `getSortedPlugins` 与官方 `uniPrePlugin` 检查 H5/mp 的 serve/build 配置。仅改为对象 transform 的 `order: pre`，保留八组严格锚点，新增两项回归先失败后通过。
- [x] 修复实际 mp 提升依赖组件的 `../../node-modules` 非法输出路径：同步锁定 uni-echarts 源码到既有忽略目录 `src/uni_modules`，为组件与 shared 入口设置精确别名，共享注入来源。测试同步源码／许可、重复执行、精确入口和官方路径归一；补丁覆盖生成组件且保留全部源码检查。重建验证原生组件引用闭合与 H5 实际图表。
- [x] 运行定向测试、uni 类型检查与 H5/mp-weixin 构建；检查微信生成页面、图表及 shared-core 的路径闭合与竞态保护。构建目录原始 161 个文件、931,987 字节；不视为微信上传包测量，也不声明微信运行验收通过。

## Task 4: 浏览器与交付

Files: `e2e/growth.spec.ts`、`apps/uni/tests/e2e/growth.spec.ts`、`docs/VERIFICATION.md`、原产品计划及本计划。

- [x] 隔离库真实请求种入身高、体重、同日及历史补录；读取真实图实例 option 检查顺序和非零补值。通过页面新增、编辑、删除并刷新，检查图和摘要同步。验证切换、筛选独立、单点／空指标、无宝宝档案、窄屏无溢出、离开重进与真实触摸 tooltip；截图并实际查看。Web 18/18，uni H5 15/15。
- [x] 依次执行 `npm test`（328/328）、`npm run typecheck`、`npm run build`、`npm run build:uni:h5`、完整 Web（5184）和 H5（5175）浏览器套件、两种 cleanup（2/2）。浏览器服务测试严格顺序执行。
- [x] 独立审查规格后审查质量，修复所有本模块问题；格式、diffcheck、生产 3003 只读检查，确保没有测试服务或新目录残留。
- [x] 更新真实结果与微信限制，明确暂存本模块文件；`git commit -m "✨ feat: 添加宝宝身高体重成长曲线"` 后立即代理推送 develop，再核对本地、origin 与远端 SHA 及干净工作区。
