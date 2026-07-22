# 桌面端在线更新发布指南

## 发布边界

- 首个过渡版本固定为 `0.2.0-beta.1`。现有 `0.1.0` 客户端没有更新器，必须从 Gitee Release 手工下载安装一次。
- `0.2.0-beta.1` 之后只发布版本号更高的更新，不支持自动降级或回退。
- 当前免费内测清单同时发布 macOS arm64、macOS x64、Windows x64，三者必须使用同一版本。任一目标缺失时，禁止提交 `releases/latest.json`。
- Gitee Release 和 `latest.json` 必须允许匿名读取。客户端不携带 Gitee 账号、令牌或 URL 查询参数。
- Tauri 更新签名是强制安全边界；免费内测只是不购买 Apple Developer ID、公证和 Windows 商业代码签名。

## GitHub Actions 日常发布

Gitee `main` 继续是唯一源码主线，公开 GitHub 仓库只作为同步镜像和 CI 控制面。优先配置 Gitee 到 GitHub 的 `main`/标签推送镜像；若账号不支持，在本机一次性增加包含两个推送地址的 `release` 远端：

```bash
git remote add release https://gitee.com/wanglinqiao/trellis-visual-console.git
git remote set-url --add --push release https://gitee.com/wanglinqiao/trellis-visual-console.git
git remote set-url --add --push release https://github.com/lnqdev/trellis-visual-console.git
git remote get-url --all --push release
```

日常发布先推送 `main`，再显式推送轻量版本标签；两条命令都会同时发送到 Gitee 和 GitHub：`git push release main`、`git push release v<版本>`。任一远端失败都按发布失败处理并修复同步状态。GitHub 仓库必须保持公开，并只使用标准 `ubuntu-24.04`、`macos-14`、`windows-2022` Runner，不使用 Larger Runner 或长期自托管机器。构建中转 Artifact 仅保留 1 天，客户端最终只从 Gitee Release 下载。

在 GitHub Repository Secrets 中配置以下名称，值不得写入仓库、日志或 Artifact：

```text
TAURI_SIGNING_PRIVATE_KEY
TAURI_SIGNING_PRIVATE_KEY_PASSWORD
GITEE_RELEASE_TOKEN
```

创建受保护的 `release-production` Environment，并将发布者加入必需审核者。前三个构建和候选上传成功后，工作流暂停等待一次批准；批准前 Gitee Release 可以存在，但公开 `releases/latest.json` 不变。

日常发布只需在 Gitee `main` 提交版本文件、`releases/notes/v<版本>.md` 和同版本标签：

```bash
pnpm release:prepare -- 0.2.0-beta.5 "修复在线更新返回格式"
git add package.json Cargo.toml Cargo.lock src-tauri/tauri.conf.json releases/notes/v0.2.0-beta.5.md
git commit -m "chore(release): 升级到 v0.2.0-beta.5"
git tag v0.2.0-beta.5
git push release main
git push release v0.2.0-beta.5
```

工作流会校验 GitHub 与 Gitee 提交一致、三平台签名和 SHA-256、Gitee 附件匿名下载，再由 `release-production` 门禁提交公开清单。重跑同一标签只允许复用哈希完全一致的附件。

## 密钥与本机环境

当前内测签名材料位于仓库外：

- 私钥：`/Users/wanglinqiao/.config/trellis-visual-console/updater-signing.key`，权限必须保持 `600`。
- 公钥备份：同目录的 `updater-signing.key.pub`；仓库中的 Tauri 配置只包含公钥内容。
- 私钥密码：macOS 登录钥匙串，service 为 `com.wanglinqiao.trellis-visual-console.updater-signing`，account 为 `wanglinqiao`。

构建终端只在当前会话注入环境变量，不把值写入 shell 历史、`.env`、日志或任务文档：

```bash
export TAURI_SIGNING_PRIVATE_KEY="$(< /Users/wanglinqiao/.config/trellis-visual-console/updater-signing.key)"
export TAURI_SIGNING_PRIVATE_KEY_PASSWORD="$(security find-generic-password -a wanglinqiao -s com.wanglinqiao.trellis-visual-console.updater-signing -w)"
```

发布完成后关闭该终端，或执行：

```bash
unset TAURI_SIGNING_PRIVATE_KEY TAURI_SIGNING_PRIVATE_KEY_PASSWORD
```

在第一次发布前，把私钥文件与密码分别制作离线加密备份，并验证能够恢复。不要把两者放在同一个未加密磁盘、网盘目录或 Git 仓库。私钥丢失后，已安装客户端无法在线信任新密钥，只能再次发布手工过渡安装包。

### Gitee 发布令牌

本地发布脚本使用 Gitee Open API 创建 Release 和上传附件。前往 `https://gitee.com/profile/personal_access_tokens` 创建只用于本仓库发布的私人令牌，授予仓库（`projects`）读写权限，然后只存入 macOS 登录钥匙串：

```bash
read -r -s "GITEE_RELEASE_TOKEN?请输入 Gitee 发布令牌："
security add-generic-password -U \
  -a "$USER" \
  -s com.wanglinqiao.trellis-visual-console.gitee-release \
  -w "$GITEE_RELEASE_TOKEN"
unset GITEE_RELEASE_TOKEN
```

令牌不得写入仓库、`.env`、命令参数或发布目录。脚本只在 Gitee API 请求体中使用令牌，不会打印其内容。令牌泄露时应立即在 Gitee 撤销并重新生成，不影响已经安装客户端的 Tauri 更新信任根。

## macOS 本地故障恢复发布

macOS 内测发布分为三个可重试阶段。脚本不会自动创建 Git 提交或推送，公开清单仍是最后的人工确认门禁。

### 1. 准备与构建

先确保当前处于已与 `origin/main` 同步的干净 `main`，然后输入目标版本和一条或多条中文更新说明：

```bash
pnpm release:mac:prepare -- \
  0.2.0-beta.3 \
  "修复在线更新检查返回格式" \
  "修复更新安装完成状态显示"
```

脚本依次同步 `package.json`、工作区 `Cargo.toml` 和 Tauri 配置版本，更新 `Cargo.lock`，执行前端/Rust 门禁，读取仓库外签名密钥与钥匙串密码，清理两个 target 下明确的旧 macOS updater 生成物，再以 `app,dmg` 模式构建 macOS arm64/x64。整理产物前，脚本会从每个 `.app.tar.gz` 内读取 `Info.plist` 和 Mach-O，断言内部版本与架构正确，然后才把唯一命名的 DMG、更新包、签名、`SHA256SUMS.txt`、更新说明和发布元数据整理到：

```text
~/Desktop/Trellis Visual Console Releases/v<版本>/
```

任一步失败都会立即停止且不会创建 Gitee Release。若双架构构建已经完成、仅在产物校验或归档阶段失败，修正脚本后可使用相同版本与相同更新说明恢复，无需重新编译：

```bash
pnpm release:mac:stage -- \
  0.2.0-beta.4 \
  "修复 macOS 更新产物校验"
```

恢复阶段要求三个版本来源一致，仍会重新解包校验两个 updater 的内部版本、架构和签名，再覆盖稳定发布目录中的生成产物，但不会删除目录中的其他文件。禁止仅凭新文件名、修改时间、SHA-256 或签名存在判断版本正确：这些信息无法发现“新版本文件名包含旧版本应用”的情况。

检查版本改动后提交并推送，确保 Gitee Release 标签指向包含该版本的提交：

```bash
git add package.json Cargo.toml Cargo.lock src-tauri/tauri.conf.json
git commit -m "chore(release): 升级到 v0.2.0-beta.3"
git push origin main
```

### 2. 创建 Release 并上传

```bash
pnpm release:mac:upload -- \
  "$HOME/Desktop/Trellis Visual Console Releases/v0.2.0-beta.3"
```

上传阶段要求工作区干净、本地 `main` 与 `origin/main` 一致且代码版本等于发布目录版本。脚本自动创建或复用同版本 Gitee Release，上传七个附件，并逐个匿名下载校验文件大小和 SHA-256。重试时，远端同名附件只有哈希完全一致才会跳过；内容不同会停止，禁止静默覆盖。

全部附件通过后，脚本在发布目录生成并校验 Mac-only 候选 `latest.json`。该文件还没有打开客户端更新发现。

### 3. 发布更新清单

在浏览器确认 Gitee Release 与候选清单后执行：

```bash
pnpm release:mac:publish -- \
  "$HOME/Desktop/Trellis Visual Console Releases/v0.2.0-beta.3"
```

该命令要求候选版本高于当前公开版本，重新校验后写入仓库 `releases/latest.json`，但不会提交或推送。检查 diff 后再打开更新：

```bash
git add releases/latest.json
git commit -m "chore(release): 发布 v0.2.0-beta.3 Mac 更新清单"
git push origin main
```

最后匿名访问 `https://gitee.com/wanglinqiao/trellis-visual-console/raw/main/releases/latest.json`，确认内容与桌面发布目录中的候选文件一致。

## 三平台手工故障恢复补充

先把 `package.json`、工作区 `Cargo.toml` 和 `src-tauri/tauri.conf.json` 更新为同一 SemVer，然后执行：

```bash
pnpm check:version
pnpm install --frozen-lockfile

# macOS 原生构建机
CI=true pnpm build:mac:arm64
CI=true pnpm build:mac:x64

# Windows x64 原生构建机
pnpm build:windows:x64
```

`bundle.createUpdaterArtifacts=true` 会在安装包旁生成更新产物和 `.sig`。macOS 应同时保留 DMG、`.app.tar.gz` 和签名；Windows 应保留当前用户 NSIS 安装器和签名。Windows 目标必须在 Windows x64 原生环境构建与验收。

对每个上传文件计算并记录 SHA-256：

```bash
shasum -a 256 <产物路径>
```

Windows 使用：

```powershell
Get-FileHash -Algorithm SHA256 <产物路径>
```

### 手工发布 Gitee Release

1. 创建标签 `v<版本>` 和同名 Gitee Release，发布说明必须是非空中文，并包含 Gatekeeper、SmartScreen 与一次性迁移说明。
2. 上传三个目标的手工安装包、更新包、`.sig` 和 SHA-256 记录。
3. 在未登录浏览器中逐个打开 Release 附件 URL，确认无需令牌即可下载，且最终文件大小和 SHA-256 与构建记录一致。
4. 从 `releases/latest.example.json` 复制候选清单到仓库外临时路径，填写同一版本、中文说明、UTC 发布时间、三个 HTTPS URL 和对应 `.sig` 的完整内容。
5. 执行 `pnpm check:update-manifest -- <候选清单路径>`。校验通过后，再将候选文件作为 `releases/latest.json` 提交到 `main`。
6. 匿名访问 `https://gitee.com/wanglinqiao/trellis-visual-console/raw/main/releases/latest.json`，确认内容与候选文件一致。此步骤才会打开客户端更新发现。

禁止把 `latest.example.json` 直接改名发布；其中的地址和签名仅用于结构示例，不对应真实产物。

## 过渡与真实升级验收

`0.1.0 -> 0.2.0-beta.1`：三个平台用户各手工安装一次。macOS 必须声明唯一目标安装目录，退出测试进程、卸载 DMG，并清理本轮产生的额外副本；既有用户副本未经授权不得删除。Windows 使用当前用户 NSIS 覆盖安装，默认保留应用数据。

从 `0.2.0-beta.1` 向更高测试版本验收时至少覆盖：

- 启动自动检查、24 小时限频和不受限的手动检查。
- 相同或较低版本不更新，错误架构不更新，缺少中文说明或签名错误时拒绝安装。
- macOS 立即重启与稍后重启。稍后重启时安装已经完成，下次启动直接进入新版本，不会重新下载安装包。
- Windows 确认安装后退出，由 NSIS 完成替换；升级后保留应用数据和已登记项目。
- 三个平台均验证主业务在检查和下载前可继续只读浏览。

## 冻结与向前修复

发现严重问题后，立即从 `main` 撤下 `releases/latest.json`，或恢复为客户端不会视为更高版本的最后安全清单，阻止尚未升级的客户端继续发现问题版本。已经升级的客户端不做静默降级；修复后发布版本号更高、当前目标齐全的新版本，再按完整流程重新打开清单。

Gitee 不可用时保持清单冻结，不切换到未验证镜像。未来迁移对象存储或 CDN 时，必须同时更新 Tauri 端点、Rust 侧批准的下载域名/路径和清单校验器，并重新完成匿名下载、重定向与签名验证；平台键、签名信任根和发布顺序保持不变。
