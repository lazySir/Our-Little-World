# 设置草稿与会话读取顺序修复

## 已确认的问题

- uni 设置页的旧 `onShow` 读取可在用户编辑或保存失败后返回，覆盖昵称与空间草稿。
- 两端会话读取只区分接口地址与登录令牌，同一会话内旧读取可晚于保存后的新读取返回，令全局昵称、空间及主题回退。

## 修复范围与设计

1. Web：为真实 session store 补充同会话读取乱序测试，再增加独立于登录身份代次的读取序号。旧成功与旧失败均不能覆盖最新读取状态；hydrate 合并、ready、clear、accept 与过期登录行为保持有效。
2. uni：设置页保留脏表单与失败草稿，只同步干净字段；保存期间互斥并锁定输入。会话 store 增加读取序号保护，先以真实 SFC 与 Pinia store 回归复现。
3. 增加 H5 设置页慢读取、保存失败、再次保存与持久化浏览器验证，使用独立临时数据库。
4. 完整单测、类型检查、两端构建、Web/H5 浏览器验收与测试进程收尾；生产 3003 仅做只读检查，不接触 5174 或日常数据。
5. 更新验证记录，明确暂存本模块文件，提交后立即推送 develop 并核对远端 SHA。

## 分工

- 主代理：Web store、Web 回归、H5 浏览器用例、整体验证与提交。
- uni 代理：`apps/uni/src/pages/settings/index.vue`、`apps/uni/src/stores/session.ts` 及独立对应回归。
- 独立审查：读取竞态边界与最终差异，只读。

## 验收命令与边界

- 定向先红后绿：`npx tsx --test apps/web/test/connection.test.ts`、uni 新增设置草稿与会话回归。
- `npm test`、`npm run typecheck`、`npm run build`、`npm run build:uni:h5`。
- `WEB_E2E_BASE=http://127.0.0.1:5184 npm run test:e2e`（PowerShell 使用环境变量赋值）；`npm run test:e2e:uni`，两个服务测试顺序执行。
- `npm run test:e2e:unit` 与 `npm run test:e2e:cleanup`。
- 微信已有 readiness 失败仍是独立未完成验收，不以 H5 或编译成功替代。旧临时目录清理曾被策略拒绝，本模块不重试处理该目录。

## 结果

- [x] Web 六项真实 store 回归先失败后通过；补充真实 API/fetch 与 App 监听的旧 refresh/hydrate 401、最新 401 以及其他资源控制。仅 `/auth/me` 的有效读取可触发该请求的会话过期副作用。
- [x] uni 真实 SFC、Pinia 与 transport 先复现草稿丢失、旧 401 和认证误导航；保存基线、读取代次与认证结果检查完成，未知资料提供同页重试。
- [x] 完整单测 270/270（shared 12、API 43、Web 73、uni 120、scripts 22）及根类型检查通过。API（包含 shared）、Web、mp-weixin、H5 四条独立构建命令均退出 0。
- [x] 新 H5 两项先单独通过，再完整 H5 14/14；完整 Web 17/17，命令均退出 0，未新增残留目录或测试监听。已实际查看设置草稿保留和重试持久化截图。
- [x] 清理逻辑单测 12/12、实际清理 2/2；新 H5 测试严格 TypeScript 通过。独立审查提出的两项阻挡均补回归后修复。
- [x] 本机 3003 只读健康/已有空间/入口 HTML 与四项资源匹配；5174 保留，正式数据没有写入。
- [x] 验证证据和微信未通过边界更新到 `docs/VERIFICATION.md`。微信官方旧失败现场日志只读调查得到环境异常线索，没有确定 readiness 根因或重新宣称运行通过。
      提交规则：仅暂存本模块明确文件，提交后立即推送；实际提交与远端 SHA 以 Git 历史和最终核对结果为准。
