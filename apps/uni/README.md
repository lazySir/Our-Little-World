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
```

微信小程序产物位于 `dist/build/mp-weixin`；`dist/build/h5` 用于浏览器联调。面向日常电脑和手机浏览器使用的 Web 位于 `apps/web`。构建前会从 npm 锁定的 Wot 依赖同步组件源码到被忽略的 `src/uni_modules`，避免 monorepo 中提升依赖导致小程序组件文件生成到应用目录之外；无需手动复制或修改第三方代码。

## 第一次连接

默认 API 为 `http://127.0.0.1:3000/api`，可在登录页「连接设置」或设置页改成实际地址。手机访问电脑上的服务时，填写电脑的局域网 IP，例如 `http://192.168.1.10:3000/api`，并确保手机和电脑能互相访问。也可在构建环境设置 `VITE_API_BASE`。

首次创建账号后进入空空间，通过邀请码让另一半加入，最多两个账号。所有模块均使用服务端真实接口，记录、照片和备份存放在 API 的持久化目录。

## 微信小程序

`src/manifest.json` 的 `mp-weixin.appid` 有意留空，未绑定或冒充用户 AppID。导入构建目录前填写自己的 AppID。开发者工具在局域网开发时可以临时关闭合法域名校验；真机正式发布需要在微信后台配置 request、uploadFile、downloadFile 的 HTTPS 合法域名，并确保图片签名地址的域名一致。登录使用本项目自己的双人账号，不依赖微信登录。

## 图片与备份

照片使用 `uni.chooseImage`、`uni.uploadFile` 和 `uni.previewImage`。完整备份在 H5 使用浏览器下载，微信保存后可分享文件。恢复在微信选择聊天文件，在 H5 选择本机文件。微信中的图片选择、权限和文件操作需要通过开发者工具和手机微信验证；命令行编译与 H5 联调不能代替微信环境验收。

## 页面

底部四个入口是今天、一起做、回忆、我们。点菜和点单、共同账本、纪念日、宝宝成长、工作手记、时光信箱与设置均有独立页面。设置包含昵称、空间信息、三种主题、邀请码、接口地址、改密、JSON 导出、ZIP 备份与恢复。未到期的信件正文由服务端隐藏；客户端不会把隐藏内容当成可读取数据。

本地 TypeScript 检查覆盖业务源码，生成的第三方 `uni_modules` 不纳入项目类型检查；组件仍由 uni 编译器实际编译。领域测试覆盖金额输入、闰日纪念日、点单数量、接口地址和错误处理。
