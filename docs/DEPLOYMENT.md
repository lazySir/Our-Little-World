# 本地与双端部署

## 1. 环境与初始化

建议采用仍受支持的 Node.js LTS 版本（至少 22.12），npm 10+。SQLite 无需安装独立数据库服务。首次安装运行：

```sh
npm ci
npm run init
npm run build:api
npm run build:web
npm start
```

`npm run init` 只执行生成客户端与 `prisma migrate deploy`，不执行会交互修改表结构的 `migrate dev`，也不重置生产数据。迁移由仓库中的 `apps/api/prisma/migrations` 管理。

API 使用 Prisma 7 和 `better-sqlite3` 驱动适配器，客户端由 `apps/api/src/db/client.ts` 统一创建，并以毫秒时间戳格式读写 SQLite `DateTime` 字段，兼容现有数据库文件。数据库连接地址从根 `.env` 的 `DATABASE_URL` 读取，Prisma CLI 配置位于 `apps/api/prisma.config.ts`。

服务端以 `TZ` 计算业务日期，默认 `Asia/Shanghai`。若要让本地空间按其他时区换日，可在根 `.env` 或服务环境变量中设置有效的 IANA 时区名并重启；Web 和小程序通过公开的 `/api/business-date` 读取同一业务日期。

根环境样例：

```dotenv
DATABASE_URL=file:./data/world.db
STORAGE_DIR=./storage
WEB_DIST_DIR=./apps/web/dist
HOST=0.0.0.0
PORT=3000
AUTO_BACKUP_HOURS=24
ASSET_SECRET=
SETUP_TOKEN=
CORS_ORIGINS=http://localhost:5173,http://127.0.0.1:5173
AUTH_RATE_LIMIT=20
GENERAL_RATE_LIMIT=600
RATE_LIMIT_WINDOW_MS=60000
```

初始化会为 `ASSET_SECRET` 生成足够长的随机值。不要把 `.env` 放入 Git、聊天或截图；不要在每次启动时替换该值，否则之前的附件签名链接会失效。环境变量比 `.env` 优先，适用于容器或服务管理器。

限流默认按客户端地址在 60 秒窗口内允许 20 次登录、初始化或加入请求，以及 600 次普通请求。上述三个变量可分别调整认证请求上限、普通请求上限和窗口长度；生产部署应根据可信代理配置与实际流量审慎设置。

通过根 `scripts/*` 启动时，数据库、附件和 Web 目录都会转换为绝对路径再传给 API。相对路径以仓库根目录为基准。Windows 带空格或中文的目录可直接使用。

## 2. 开发和正常使用

| 用途         | 命令                | 默认地址                          |
| ------------ | ------------------- | --------------------------------- |
| 初始化       | `npm run init`      | 不启动服务                        |
| 开发两个服务 | `npm run dev`       | Web 5173，API 3000                |
| 构建 Web     | `npm run build:web` | 生成静态资源                      |
| 构建 API     | `npm run build:api` | TypeScript 编译到 `apps/api/dist` |
| 正常使用     | `npm start`         | `http://localhost:3000`           |
| 检查服务     | `npm run health`    | 请求 `/api/health`                |

Windows 启动器 `scripts/start-local.ps1` 默认安装依赖、初始化、构建 API 与 Web 后在当前窗口运行服务；`-SkipInstall` 跳过依赖安装，`-Dev` 启动开发模式。进程不会额外创建可见窗口，按 `Ctrl+C` 停止整个服务树。

根 `.env` 更改 `PORT` 后，开发启动器会将 Web 的 `/api` 代理同步指向该端口，健康检查也读取同一配置。若特意连接另一台开发 API，可用 `API_PROXY_TARGET=http://另一台电脑IP:端口` 覆盖代理目标。

第一次进入页面，自行建立空间与所有者账号。没有默认密码。空间创建前，服务端会在 `storage/.setup-token` 生成权限受限的一次性验证码；PowerShell 可运行 `Get-Content .\storage\.setup-token` 读取并粘贴到首次创建页面。成功后生成的验证码文件会自动删除。也可在 `.env` 的 `SETUP_TOKEN` 自行指定至少 32 字节且不超过 256 个字符的验证码。不要经聊天、截图或公开日志分享验证码。通过空间设置生成 24 小时有效的一次性邀请码，供第二个人加入。程序应只运行一个 API 实例，不要同时用两个终端或容器写同一个 SQLite 文件。

## 3. 局域网

`HOST=0.0.0.0` 允许本机和局域网访问。查询电脑局域网地址后，另一台设备访问 `http://电脑IP:3000`；不要使用手机自己的 `localhost`。仅在必要的私人网络中开放 TCP `3000`。

生产 Web 与 API 同源，不需要配置跨域。若另开了 uni H5 或其他浏览器入口，应将它的完整来源加入 `CORS_ORIGINS`，例如 `http://192.168.1.50:5174`。来源包含协议和端口，不含路径；不要填 API 路径。

主机需要保持开机且不进入睡眠。为路由器配置 DHCP 地址保留，可以减少局域网 IP 变化。日常关闭的笔记本适合开发；长期使用宜用 NAS 或常开小主机。

## 4. 外网与 HTTPS

远程访问需要一个双方都能到达的入口。可使用自己管理的域名、家庭公网网络反向代理，或具备 HTTPS 的受控穿透服务；API 不负责配置这些外部服务。正式开放前配置 TLS、主机更新和访问控制，并保留独立备份。

代理应把站点根路径转发到本地 `127.0.0.1:3000`，保留 `/api`、文件上传、附件下载和前端路由。示意 Caddy 配置：

```caddy
your-domain.example {
    reverse_proxy 127.0.0.1:3000
}
```

只有 API 确实通过可信反向代理访问时，才设置 `TRUSTED_PROXY_CIDRS`。上面的 Caddy 直接连接宿主机服务时，可将它设为 `127.0.0.1`；若 API 在 Docker 中运行，应根据容器实际看到的代理来源地址填写最窄的地址或网段。留空时服务忽略转发地址头，避免客户端伪造访客 IP。

将示例域名换为自己的真实域名并正确解析。使用国内公开服务或微信平台时，域名、主体、备案与准入要求以对应服务后台当前要求为准。微信请求域名应指向实际可访问的 HTTPS 入口，不能依赖仅电脑本机可达的 `localhost`。

## 5. 微信小程序

```sh
npm run build:mp-weixin
```

把 `apps/uni/dist/build/mp-weixin` 导入微信开发者工具，使用自己的 AppID。开发者工具的测试模式或关闭合法域名检查不能代替正式发布配置。

在客户端设置中将 API 改为 `https://你的域名/api`，在微信后台分别配置需要的请求、上传、下载服务器域名。上传原图、预览图片、登录与错误提示都应进行真机测试。正式发布还需自身主体信息与平台审核。

本项目采用自己的用户名密码与邀请码，微信 AppID 不会自动成为第三方微信登录的服务端配置。若后续需要微信一键登录，应作为独立能力配置。

## 6. 小程序页面的 H5 联调

```sh
npm run build:uni:h5
```

产物在 `apps/uni/dist/build/h5`，用于在浏览器中验证小程序页面和 API 流程。日常手机浏览器使用主 Web 站点即可，响应式布局会自动适配屏幕。

H5 联调不能代替微信环境验收。发布前仍需在微信开发者工具和手机微信中检查图片选择、上传、预览、备份文件及网络配置。

## 7. Docker

```sh
node --experimental-strip-types scripts/init.mts --config-only
docker compose up -d --build
docker compose ps
docker compose logs -f world
```

Compose 默认发布到所有网卡的 `3000`。只供本机使用可在根 `.env` 加 `PUBLISH_HOST=127.0.0.1`；自定义外部端口可加 `PUBLISH_PORT=3080`，容器内部仍使用 3000。

容器以普通 `node` 用户运行，启动时执行 `migrate deploy`。命名卷 `world-data` 保存 SQLite，`world-storage` 保存附件与服务备份。默认容器会异常重启，健康检查请求 `/api/health`。

首次创建空间前，用 `docker compose exec world cat /app/storage/.setup-token` 读取容器内的一次性验证码并填入页面；创建成功后生成的验证码文件会自动删除。可选环境变量 `SETUP_TOKEN` 可指定至少 32 字节且不超过 256 个字符的自定义值。

```sh
docker compose down
```

上述停机保留数据卷。不要使用 `docker compose down -v` 进行日常停机。镜像内不包含宿主 `.env`、用户图片和数据库。

2026-11-17 已在 Docker Desktop 的 Linux 引擎上实际构建并运行。隔离验收覆盖 Compose 命名卷与健康检查、首次建号、图片上传、重启后的记录/会话/照片持久化，以及 ZIP 下载恢复；测试容器和测试卷已清理。日常服务仍由本机 Node 运行，未切换或迁移真实数据。

## 8. 备份、恢复和迁移

优先使用设置中的完整 ZIP 备份，以同一时间点保存记录和附件。ZIP 的 `data.json` 与 `database.sqlite` 均从同一个 SQLite 快照生成，下载期间的写请求会串行处理，避免并发写入让应用内导入数据和离线数据库内容发生分歧。JSON 导出用于查阅和迁移开发，不含登录凭据、会话与图片文件，不能作为照片备份。ZIP 包含数据库及密码哈希，应私密保管。上传图片经过尺寸限制和 WebP 转换；相机原片需另外保留。

自动备份默认 `AUTO_BACKUP_HOURS=24`，服务每连续运行 24 小时生成一次 `storage/backups/auto-时间戳.zip`，保留最新 7 份自动备份。恢复前生成的保护副本独立保留最新 7 份，超过部分会自动删除，并使用唯一文件名避免覆盖。修改根 `.env` 后重启生效；`0` 关闭自动备份，允许的正数范围为 1–596 小时。首次备份在一个完整间隔后执行，服务重启会重新计时；自动备份仍在原磁盘，应另行复制到其他磁盘。

恢复前：下载当前完整 ZIP，确认操作账号是空间所有者，使用另一份已知可恢复的 ZIP。程序会校验格式并保存恢复前的保护副本；恢复成功后刷新，无需重启。恢复成功后，上传目录中不再被恢复数据引用的 WebP 附件会清理；如果数据库事务失败，原附件会保留或恢复。当前账号、密码和会话保留，空间资料、记录与图片元数据按备份替换；邀请码失效。只接受同一空间且记录作者仍属于当前账号的备份。当前安全恢复流程不用于把陌生空间导入已有空间，不要手工把不明 ZIP 解压到数据目录。

当前照片文件已经丢失时，可直接选择以前的完整 ZIP 恢复。恢复前保护副本仍保留当前数据库、记录和可读取的照片，并在 `manifest.json` 中写入 `complete: false` 与 `missingAssets` 清单，界面会告知缺失数量。这种不完整保护副本用于人工追溯，应用会拒绝将它作为完整 ZIP 恢复；普通下载和自动备份遇到缺失文件仍报错。不要将不完整保护副本替换掉以前保存的完整备份。

文件大小与元数据不符时，普通备份拒绝生成；恢复前保护副本保留异常文件的当前字节，并用 `damagedAssets` 标出预期/实际大小，再从选中的完整 ZIP 修复。两端均会提示缺失和大小异常的总数。

网页 ZIP 上限在生成与恢复时一致：10000 条生活记录、10000 个 ZIP 成员（含3个固定文件）、每图10MiB、展开总量250MiB、ZIP100MiB。超限返回明确错误，自动备份也不会删除已有副本。当前数据超限时，应用内恢复会在变更前拒绝，以保证覆盖前仍能保全现状；请使用下面的停机离线备份和迁移方式。

额外离线备份：停止服务，再完整复制 `data`、`storage` 和私下保存的 `.env` 到另一个磁盘。运行中的 SQLite 可能还有 WAL 文件，只复制主数据库文件会缺记录。Docker 使用命名卷，应停机后通过卷备份流程保全两个卷，或使用应用生成的 ZIP。

迁移到新机器时，先安装同一版本并停止服务，再复制原来的 `data`、`storage` 和 `.env`，保留原账号身份。若只保留 ZIP，可在停机状态将其中 `database.sqlite` 作为目标数据库，将 `uploads` 内容放入 `storage/uploads`，再运行初始化应用迁移后启动；配置中的数据库路径要与实际文件一致。网页恢复面向原空间内的回滚，不能把旧作者 ID 直接导入重新注册的账号。

### Windows 用 ZIP 迁移

下面的 PowerShell 步骤适用于全新目标目录。先安装与原机相同或更新的项目版本，并确认服务已停止。先把原机 `.env` 安全复制到目标项目根目录，它包含保持账号会话与附件签名有效所需的 `ASSET_SECRET`；确认 `DATABASE_URL` 指向 `file:./data/world.db`。不要把 ZIP 解压到现有数据库或附件目录；若目标已有数据，先复制到其他位置并完成独立备份。假设 ZIP 保存在 `D:\\Backup\\little-world-backup.zip`，项目目录是 `D:\\Apps\\Our-Little-World`：

```powershell
$Root = 'D:\\Apps\\Our-Little-World'
$Zip = 'D:\\Backup\\little-world-backup.zip'
$EnvFile = Join-Path $Root '.env'
$Stage = Join-Path $env:TEMP ('little-world-migration-' + [guid]::NewGuid().ToString('N'))
$Database = Join-Path $Root 'data\\world.db'
$Uploads = Join-Path $Root 'storage\\uploads'

if (Test-Path -LiteralPath $Database) { throw "目标数据库已存在：$Database" }
if (!(Test-Path -LiteralPath $EnvFile)) { throw '请先将原机 .env 复制到目标项目根目录' }
if (Test-Path -LiteralPath $Uploads -PathType Container) {
  $ExistingUploads = @(Get-ChildItem -LiteralPath $Uploads -Force)
  if ($ExistingUploads.Count -gt 0) { throw "目标附件目录非空：$Uploads" }
}
New-Item -ItemType Directory -Force -Path $Stage | Out-Null
Expand-Archive -LiteralPath $Zip -DestinationPath $Stage

$ManifestPath = Join-Path $Stage 'manifest.json'
$DatabaseBackup = Join-Path $Stage 'database.sqlite'
if (!(Test-Path -LiteralPath $ManifestPath) -or !(Test-Path -LiteralPath $DatabaseBackup)) {
  throw 'ZIP 缺少 manifest.json 或 database.sqlite'
}
$Manifest = Get-Content -LiteralPath $ManifestPath -Raw | ConvertFrom-Json
if ($Manifest.product -ne 'our-little-world' -or $Manifest.version -ne 1 -or $Manifest.complete -ne $true) {
  throw 'ZIP 不是本项目支持的完整备份'
}

New-Item -ItemType Directory -Force -Path (Join-Path $Root 'data') | Out-Null
New-Item -ItemType Directory -Force -Path $Uploads | Out-Null
Copy-Item -LiteralPath $DatabaseBackup -Destination $Database
$BackupUploads = Join-Path $Stage 'uploads'
if (Test-Path -LiteralPath $BackupUploads -PathType Container) {
  Get-ChildItem -LiteralPath $BackupUploads -File | Copy-Item -Destination $Uploads
}

Set-Location $Root
npm ci
npm run init
npm run build
npm start
```

`npm run init` 会生成 Prisma Client 并应用已提交迁移，不会重置数据库。首次启动后用原账号登录，抽查记录、账本、时光信解锁规则和照片；确认无误后再删除 `$Stage`。ZIP 内的 `data.json` 只用于核对，不要另外导入数据库。

### Docker 卷的离线副本

Docker 部署优先使用应用内 ZIP。若需要保留原始命名卷，先停服务，再用 Docker 的临时 Alpine 容器把两个卷分别打包到宿主机；`docker volume ls` 可查看 Compose 实际生成的完整卷名：

```powershell
docker compose stop world
$BackupDir = Join-Path (Get-Location) 'offline-backup'
New-Item -ItemType Directory -Force -Path $BackupDir | Out-Null
$DataArchive = Join-Path $BackupDir 'world-data.tgz'
$StorageArchive = Join-Path $BackupDir 'world-storage.tgz'
if ((Test-Path -LiteralPath $DataArchive) -or (Test-Path -LiteralPath $StorageArchive)) { throw '备份文件已存在，请改用新的输出目录' }
docker volume ls
$DataVolume = '实际卷名_world-data'
$StorageVolume = '实际卷名_world-storage'
if (-not (docker volume inspect $DataVolume 2>$null)) { throw '请将 DataVolume 替换为 docker volume ls 中存在的完整卷名' }
if (-not (docker volume inspect $StorageVolume 2>$null)) { throw '请将 StorageVolume 替换为 docker volume ls 中存在的完整卷名' }
docker run --rm --mount "type=volume,source=$DataVolume,target=/from,readonly" --mount "type=bind,source=$BackupDir,target=/to" alpine sh -c 'tar czf /to/world-data.tgz -C /from .'
if ($LASTEXITCODE -ne 0) { throw '数据库卷备份失败' }
docker run --rm --mount "type=volume,source=$StorageVolume,target=/from,readonly" --mount "type=bind,source=$BackupDir,target=/to" alpine sh -c 'tar czf /to/world-storage.tgz -C /from .'
if ($LASTEXITCODE -ne 0) { throw '附件卷备份失败' }
```

恢复到另一台机器时，先使用独立的 Compose 项目名创建全新的空卷，并保持服务未启动。将以下两个变量填为目标机 `docker volume ls` 显示的完整卷名；不要将数据解进非空卷。把压缩包放入当前目录的 `offline-backup`：

```powershell
$ComposeProject = '新项目名'
$DataVolume = "${ComposeProject}_world-data"
$StorageVolume = "${ComposeProject}_world-storage"
$BackupDir = (Resolve-Path .\\offline-backup).Path
docker run --rm --mount "type=volume,source=$DataVolume,target=/to" --mount "type=bind,source=$BackupDir,target=/from,readonly" alpine sh -c 'tar xzf /from/world-data.tgz -C /to'
if ($LASTEXITCODE -ne 0) { throw '数据库卷恢复失败' }
docker run --rm --mount "type=volume,source=$StorageVolume,target=/to" --mount "type=bind,source=$BackupDir,target=/from,readonly" alpine sh -c 'tar xzf /from/world-storage.tgz -C /to'
if ($LASTEXITCODE -ne 0) { throw '附件卷恢复失败' }
docker compose -p $ComposeProject up -d --build
docker compose logs --tail=100 world
```

不要在服务运行时复制 SQLite 卷，也不要用 `docker compose down -v` 做日常停机；后者会删除卷和其中的数据。

至少演练一次恢复：检查登录、数量、账本金额、时光信解锁规则和随机几张图片。备份放在不同磁盘比和原数据放在同一个磁盘可靠。

## 9. 升级

先保存完整备份和原版本号，停止服务，更新源码，执行 `npm ci`、`npm run init`、`npm run build:api`、`npm run build:web`、`npm start`。初始化只应用已提交迁移。若升级失败，保留现场，恢复上一个版本及与其匹配的备份；不要在有真实数据的库上尝试 `prisma migrate reset`。

Docker 更新前先备份，执行 `docker compose up -d --build`，随后查看日志与健康状态。依赖锁文件应随源码一起保留。

## 10. 常见问题

| 现象                           | 检查方法                                                                  |
| ------------------------------ | ------------------------------------------------------------------------- |
| 页面能开但 API 报错            | 运行 `npm run health`，查看服务日志，确认 Web API 地址为 `/api`           |
| 手机打不开                     | 主机开机、同一网络、防火墙私人网络、正确电脑 IP 与端口                    |
| 启动提示缺少签名密钥           | 在仓库根运行 `npm run init`，保留生成的 `.env`                            |
| 端口占用                       | 停止已有服务，或更改根 `.env` 的 `PORT` 后重启                            |
| Web 构建缺失                   | 执行 `npm run build:web` 后再 `npm start`                                 |
| API 构建缺失                   | 执行 `npm run build:api` 后再 `npm start`                                 |
| SQLite 打不开                  | 检查目录写权限、磁盘空间、根配置路径和是否同时启动多个 API                |
| 小程序能编译但真机请求失败     | API HTTPS 地址、微信后台域名、证书链、真机网络可达性                      |
| 图片显示失败                   | 检查 storage 文件和签名密钥；Web/小程序会尝试续签 30 分钟图片链接，续签失败时检查登录和空间归属 |
| Windows 安装 sharp/Prisma 失败 | 使用推荐 Node LTS，检查网络代理/安全软件，重新 `npm ci`；保留完整错误信息 |

构建、浏览器联调和微信环境验收是不同验证步骤。交付时应记录实际验证结果；微信正式发布还需完成对应平台流程。
