# 微信小程序与 H5 联调

Vue 3 + TypeScript + Pinia + uni-app + Wot Design Uni；Tailwind CSS 3 负责通用布局，手账主题使用可复用的 rpx 样式。`weapp-tailwindcss` 在微信构建中把工具类和 rem 转换为小程序可用样式。

## 开发和构建

在仓库根目录安装依赖并启动 API，然后运行：

```powershell
npm run dev:h5 --workspace=@our-little-world/uni
npm run dev:mp-weixin --workspace=@our-little-world/uni
npm run build:h5 --workspace=@our-little-world/uni
npm run build:mp-weixin --workspace=@our-little-world/uni
npm run typecheck --workspace=@our-little-world/uni
npm run test --workspace=@our-little-world/uni
npm run test:e2e:uni
# 可选：配置官方开发者工具和验收 SDK 后运行
npm run test:wechat -- --media
```

`test:e2e:uni` 自动准备组件、建立临时 SQLite 并启动隔离 API 与 H5 页面，验证真实记录、双图上传、主题和数据导出。运行前确保 `3002`、`5175` 未被占用；测试不使用本机日常空间。

微信小程序产物位于 `dist/build/mp-weixin`；`dist/build/h5` 用于浏览器联调。面向日常电脑和手机浏览器使用的 Web 位于 `apps/web`。构建前会从 npm 锁定的 Wot 依赖同步组件源码到被忽略的 `src/uni_modules`，并内嵌组件库随附的图标字体，支持没有字体 CDN 的本地环境；无需手动复制或修改第三方代码。

## 第一次连接

默认 API 为 `http://127.0.0.1:3000/api`，可在登录页「连接设置」或设置页改成实际地址。手机访问电脑上的服务时，填写电脑的局域网 IP，例如 `http://192.168.1.10:3000/api`，并确保手机和电脑能互相访问。也可在构建环境设置 `VITE_API_BASE`。

首次创建账号后进入空空间，通过邀请码让另一半加入，最多两个账号。所有模块均使用服务端真实接口，记录、照片和备份存放在 API 的持久化目录。

## 微信小程序

`src/manifest.json` 的 `mp-weixin.appid` 有意留空，未绑定或冒充用户 AppID。导入构建目录前填写自己的 AppID。开发者工具在局域网开发时可以临时关闭合法域名校验；真机正式发布需要在微信后台配置 request、uploadFile、downloadFile 的 HTTPS 合法域名，并确保图片签名地址的域名一致。登录使用本项目自己的双人账号，不依赖微信登录。

读取失败时可直接在页面内重新加载。首页、各记录列表和点单历史只有成功读到数据才会显示空状态或统计；刷新失败会保留上次读到的内容。

## 图片与备份

照片使用 `uni.chooseImage`、`uni.uploadFile` 和 `uni.previewImage`。完整备份在 H5 使用浏览器下载，微信下载后可分享临时文件。恢复在微信选择聊天文件，在 H5 选择本机文件。

2026-11-19，首页愿望预览补齐前的较早版本已在微信游客模拟器（开发者工具 1.06.2310080、基础库 3.2.3、320px）验证全部 12 个页面、建号、心情、愿望新增/编辑、账本，以及真实原生照片上传/下载、ZIP 下载/恢复和恢复后的会话。验收使用独立数据库与存储，文件选择、分享及恢复确认使用受控替身。最新首页愿望预览、宝宝档案及后续修复尚未完成微信运行复验；当前复验停在工具的应用就绪探测，不能沿用较早结果证明最新版本。真实 AppID、合法域名、相机相册权限、真机预览与文件选择/分享仍需真机验收；模拟器结果不能替代这些检查。详见根目录 [验收记录](../../docs/VERIFICATION.md) 与 [可重复微信验收命令](../../docs/WECHAT-VERIFICATION.md)。

## 页面

底部四个入口是今天、一起做、回忆、我们。点菜和点单、共同账本、纪念日、共享日历、宝宝成长、工作手记、时光信箱与设置均有独立页面。共享日历按月聚合空间事件，可筛选纪念日、愿望、信件、回忆、成长记录和宝宝生日；未到期的信件只显示锁定状态。宝宝成长页会把成长记录中的照片自动整理到宝宝相册，按日期倒序并按附件去重，显示来源标题和日期，支持点击预览；没有照片时提供添加记录的空状态引导。设置包含昵称、空间信息、三种主题、邀请码、接口地址、改密、JSON 导出、ZIP 备份与恢复。未到期的信件正文由服务端隐藏；客户端不会把隐藏内容当成可读取数据。

本地 TypeScript 检查覆盖业务源码，生成的第三方 `uni_modules` 不纳入项目类型检查；组件仍由 uni 编译器实际编译。领域测试覆盖金额输入、闰日纪念日、点单数量、接口地址和错误处理。
