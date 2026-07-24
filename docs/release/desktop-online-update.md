# 桌面端在线更新发布指南

## 发布边界

- 首个过渡版本固定为 `0.2.0-beta.1`。现有 `0.1.0` 客户端没有更新器，必须从 Gitee Release 手工下载安装一次。
- `0.2.0-beta.1` 之后只发布版本号更高的更新，不支持自动降级或回退。
- 当前免费内测清单同时发布 macOS arm64、macOS x64、Windows x64，三者必须使用同一版本。任一目标缺失时，禁止提交 `releases/latest.json`。
- Gitee Release 和 `latest.json` 必须允许匿名读取。客户端不携带 Gitee 账号、令牌或 URL 查询参数。
- Tauri 更新签名是强制安全边界；免费内测只是不购买 Apple Developer ID、公证和 Windows 商业代码签名。

## 两种发包方式总览

| 方式 | 用途 | 生成平台 | 是否更新公开 `latest.json` |
| --- | --- | --- | --- |
| 方式一：GitHub Actions 三平台正式发布 | 日常版本发布和应用内在线更新 | macOS arm64、macOS x64、Windows x64 | 是，CI 上传到 GitHub Releases 后，由开发者本地执行同步命令提交 |
| 方式二：macOS 本地双架构打包 | CI 故障排查、安装包预验收、手工提供 DMG | macOS arm64、macOS x64 | 否，不得用 Mac-only 候选覆盖三平台公开清单 |

必须区分三个动作：

1. **打包**：生成安装包、updater、签名和 SHA-256，客户端看不到该版本。
2. **上传候选 Release**：附件已经在 Gitee，但只要 `latest.json` 没变，客户端仍看不到该版本。
3. **公开在线更新**：三平台候选通过校验并写入 `releases/latest.json`，客户端才会发现新版本。

日常正式发包固定使用方式一。方式二只证明 macOS 产物可构建、可安装，不是三平台正式发布的替代方案。

## 方式一：GitHub Actions 三平台正式发布（推荐）

### 1. 一次性配置

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
```

`GITEE_RELEASE_TOKEN` 不再需要配置为 GitHub Secret；令牌只在本地同步步骤中使用，从本机环境变量读取（见第 4 步）。

### 2. 准备版本提交

先确认本地 `main` 干净并与 Gitee 同步，再生成版本文件和仓库内唯一更新说明：

```bash
git status --short
git pull --ff-only origin main
pnpm release:prepare -- 0.2.0-beta.7 "本次发布的中文更新说明"
pnpm check:version
git status --short
git diff -- package.json Cargo.toml Cargo.lock src-tauri/tauri.conf.json
sed -n '1,120p' releases/notes/v0.2.0-beta.7.md
```

确认差异只包含目标版本和对应说明后提交：

```bash
git add package.json Cargo.toml Cargo.lock src-tauri/tauri.conf.json releases/notes/v0.2.0-beta.7.md
git commit -m "chore(release): 升级到 v0.2.0-beta.7"
git tag v0.2.0-beta.7
```

标签创建错误时，在尚未推送前删除本地标签并重新创建；标签一旦推送，不得移动或覆盖。

### 3. 同步两个远端并触发构建

先推送提交，再推送同一版本标签：

```bash
git push release main
git push release v0.2.0-beta.7
```

任一远端推送失败都先修复同步状态，不创建新标签、不移动已推送标签。GitHub 的”跨平台发布”工作流随后依次执行：

```text
标签预检
-> macOS arm64 / macOS x64 / Windows x64 并行签名构建
-> 汇总三平台产物
-> 上传 GitHub Release（含安装包、更新包、签名、校验文件、元数据）
```

工作流完成后，GitHub Release 即可见，但 `releases/latest.json` 尚未更新，客户端还看不到新版本。继续执行第 4 步完成 Gitee 同步。

### 4. 本地同步到 Gitee 并发布

CI 完成后，在本地执行一条命令将 GitHub Release 产物同步到 Gitee，并发布 `latest.json`。此步骤由开发者本人决定时机，相当于原来的人工批准门禁。

先确认 Gitee 令牌已注入当前终端环境：

```bash
export GITEE_RELEASE_TOKEN="$(security find-generic-password \
  -a "$USER" \
  -s com.wanglinqiao.trellis-visual-console.gitee-release \
  -w)"
```

然后执行同步命令（`--proxy` 加速国内下载 GitHub 产物）：

```bash
pnpm release:local -- upload-to-gitee \
  --tag v0.2.0-beta.7 \
  --proxy https://gh.lnqdev.top
```

脚本自动执行：

```text
从 GitHub Release 下载全部产物（走代理）
-> SHA-256 完整性校验
-> 创建或复用 Gitee Release
-> 上传附件并匿名校验
-> 生成候选 latest.json（含 Gitee 真实下载地址和签名）
-> 提交 latest.json 到 Gitee main
```

执行完成后验证公开清单已更新为目标版本且包含三个平台：

```bash
curl -fsSL \
  https://gitee.com/wanglinqiao/trellis-visual-console/raw/main/releases/latest.json \
  | jq '{version, platforms: (.platforms | keys)}'
```

期望平台为 `darwin-aarch64`、`darwin-x86_64`、`windows-x86_64`。随后同步 Gitee 写入的提交到本地：

```bash
git pull --ff-only origin main
```

最后在已安装客户端中手动检查更新，核对目标版本、中文说明、安装/重启结果和当前版本显示。

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

### Gitee 发布令牌（本地打包不需要）

方式二只生成和验证本地 macOS 产物，不访问 Gitee，因此不需要令牌。仓库仍保留历史本地上传兼容命令；只有经过单独评审、准备执行三平台高级事故恢复时，才前往 `https://gitee.com/profile/personal_access_tokens` 创建只用于本仓库发布的私人令牌，授予仓库（`projects`）读写权限，并只存入 macOS 登录钥匙串：

```bash
read -r -s "GITEE_RELEASE_TOKEN?请输入 Gitee 发布令牌："
security add-generic-password -U \
  -a "$USER" \
  -s com.wanglinqiao.trellis-visual-console.gitee-release \
  -w "$GITEE_RELEASE_TOKEN"
unset GITEE_RELEASE_TOKEN
```

令牌不得写入仓库、`.env`、命令参数或发布目录。脚本只在 Gitee API 请求体中使用令牌，不会打印其内容。令牌泄露时应立即在 Gitee 撤销并重新生成，不影响已经安装客户端的 Tauri 更新信任根。

## 方式二：macOS 本地双架构打包

该方式只生成和验证 macOS arm64/x64 安装包，适用于 CI 故障定位、正式发布前的 Mac 预验收，或手工提供 DMG。它不能单独完成当前三平台在线发布。

以下命令全部在 macOS 上执行。正式打包前确认仓库外更新私钥、钥匙串密码和两个 Rust target 仍然可用。

### 1. 准备与构建

先确保当前处于已与 `origin/main` 同步的干净 `main`，然后输入目标版本和一条或多条中文更新说明：

```bash
pnpm release:mac:prepare -- \
  0.2.0-beta.7 \
  "本次发布的中文更新说明"
```

脚本依次同步 `package.json`、工作区 `Cargo.toml` 和 Tauri 配置版本，更新 `Cargo.lock`，执行前端/Rust 门禁，读取仓库外签名密钥与钥匙串密码，清理两个 target 下明确的旧 macOS updater 生成物，再以 `app,dmg` 模式构建 macOS arm64/x64。整理产物前，脚本会从每个 `.app.tar.gz` 内读取 `Info.plist` 和 Mach-O，断言内部版本与架构正确，然后才把唯一命名的 DMG、更新包、签名、`SHA256SUMS.txt`、更新说明和发布元数据整理到：

```text
~/Desktop/Trellis Visual Console Releases/v<版本>/
```

任一步失败都会立即停止且不会创建 Gitee Release。若双架构构建已经完成、仅在产物校验或归档阶段失败，修正脚本后可使用相同版本与相同更新说明恢复，无需重新编译：

```bash
pnpm release:mac:stage -- \
  0.2.0-beta.7 \
  "本次发布的中文更新说明"
```

恢复阶段要求三个版本来源一致，仍会重新解包校验两个 updater 的内部版本、架构和签名，再覆盖稳定发布目录中的生成产物，但不会删除目录中的其他文件。禁止仅凭新文件名、修改时间、SHA-256 或签名存在判断版本正确：这些信息无法发现“新版本文件名包含旧版本应用”的情况。

### 2. 校验本地产物

产物固定位于：

```text
~/Desktop/Trellis Visual Console Releases/v0.2.0-beta.7/
```

应包含两个 DMG、两个 `.app.tar.gz`、两个 `.sig`、`SHA256SUMS.txt`、`RELEASE_NOTES.md` 和 `release-metadata.json`。进入目录校验哈希：

```bash
pushd "$HOME/Desktop/Trellis Visual Console Releases/v0.2.0-beta.7"
shasum -a 256 -c SHA256SUMS.txt
popd
```

安装测试时必须声明唯一目标路径 `/Applications/Trellis Visual Console.app`，核对版本和架构；测试结束后退出应用、卸载 DMG，并清理本轮产生的额外应用副本。

### 3. 保留版本说明并提交

本地脚本会生成发布说明，但当前不会自动写入仓库的 `releases/notes/`。如果保留这个版本，必须把同一说明复制进版本提交：

```bash
cp \
  "$HOME/Desktop/Trellis Visual Console Releases/v0.2.0-beta.7/RELEASE_NOTES.md" \
  releases/notes/v0.2.0-beta.7.md
git add package.json Cargo.toml Cargo.lock src-tauri/tauri.conf.json releases/notes/v0.2.0-beta.7.md
git commit -m "chore(release): 升级到 v0.2.0-beta.7"
git push origin main
```

### 4. 选择后续用途

- **只做本地或手工安装验证**：直接使用两个 DMG，流程到此结束，不修改 Gitee Release 和公开清单。
- **继续正式在线发布**：不要上传本地产物；为该提交创建同版本标签，然后从方式一的“同步两个远端并触发构建”继续。GitHub Actions 会重新构建三个平台。
- **CI 已经为同版本创建候选 Release**：不要上传本地同名附件。不同构建环境产生的同名文件可能哈希不同，脚本会拒绝覆盖。

### 当前禁止的本地命令

仓库暂时保留以下历史兼容命令，但当前三平台通道不得把它们作为正式发包步骤：

```text
pnpm release:mac:upload
pnpm release:mac:publish
```

`release:mac:upload` 只会准备 Mac-only 候选并可能占用同版本附件名；`release:mac:publish` 会把公开三平台清单覆盖为 Mac-only。除非后续代码先补齐三平台合并和强制校验，否则两者都不得用于正式发布。

## 高级事故恢复：手工汇总三平台

这不是第三种日常发包方式，只在 GitHub Actions 无法恢复且确实具备 macOS、Windows 原生构建环境时使用。没有 Windows x64 产物时立即停止，不能发布 Mac-only 清单。

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
