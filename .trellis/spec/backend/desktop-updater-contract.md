# 桌面在线更新可执行合同

## 场景：Tauri 签名在线更新

### 1. 范围与触发条件

- 修改更新插件、端点、公钥、版本、更新 Command、`updater-state.json`、重启流程或发布产物时必须遵守本合同。
- 更新能力只属于 `src-tauri` 桌面适配层；`trellis-core` 不得依赖 Tauri、HTTP 客户端或更新插件。
- 更新实现和公开内测清单支持 `darwin-aarch64`、`darwin-x86_64`、`windows-x86_64`；三个目标必须使用同一 SemVer、源码提交、中文说明、签名和 HTTPS Release 地址。

### 2. 签名

```text
check_for_update(mode, app, state) -> UpdateCheckResponse
install_update(onProgress: Channel<UpdateDownloadProgress>, state) -> UpdateInstallResponse
restart_application(app, state) -> ()

pnpm release:mac:prepare -- <version> <chineseNote...>
pnpm release:mac:stage -- <version> <chineseNote...>
pnpm release:prepare -- <version> <chineseNote...>
pnpm release:ci -- <validate-tag|stage-platform|aggregate|upload|publish-manifest> ...
normalizeReleaseNotes(notes) -> LF-normalized notes
```

- `mode`：`automatic | manual`。
- `UpdateCheckResponse.status`：`skipped | upToDate | available`。
- `available.update`：`currentVersion`、`version`、非空中文 `notes`、RFC 3339 `publishedAt`、`platform`。
- Channel 事件：`started { contentLength }`、`progress { downloaded, contentLength }`、`downloadFinished`。
- `UpdateInstallResponse`：`restartRequired: boolean`。
- Rust 内部可使用 snake_case 字段，但 Serde 枚举必须同时配置变体和变体字段的 camelCase；`rename_all` 不会自动重命名结构化枚举变体中的 `current_version`、`content_length` 等字段。
- `release-metadata.json`：`schemaVersion`、`version`、中文 `notes`、`preparedAt`、三平台 `platforms` 和产物 `name/size/sha256`；CI 平台元数据还必须记录唯一源码 `commit` 和 `platform`，所有文件引用必须是当前发布目录内的纯文件名。
- 更新私钥固定来自仓库外文件或 `TAURI_SIGNING_PRIVATE_KEY`；签名密码来自钥匙串 service `com.wanglinqiao.trellis-visual-console.updater-signing` 或 GitHub Secret；Gitee 令牌来自钥匙串 service `com.wanglinqiao.trellis-visual-console.gitee-release` 或 GitHub Secret，禁止明文参数和 `.env`。
- macOS 构建必须显式使用 `--bundles app,dmg`；只使用 `--bundles dmg` 可能生成新 DMG 却保留上个版本的 `.app.tar.gz/.sig`。

### 3. 合同

- Tauri 配置必须使用 HTTPS `latest.json`、内置公钥和 `bundle.createUpdaterArtifacts=true`；禁止启用无效证书、无效主机名或 HTTP 例外。
- 自动检查距离上次完成不足 24 小时返回 `skipped`，不联网；手动检查不受限制。检查只读取清单，不下载。
- 检查与安装共享一个进程内互斥标记。开始真实检查前清除旧 `Update` 句柄；只有成功发现新版本后才保存新句柄。
- 用户明确确认后才调用安装。Tauri 在安装前强制验证签名，前端不能绕过或直接调用 updater 插件。
- `updater-state.json` 位于固定应用数据目录，格式为 `{ version: 1, lastAutomaticCheckAt: string | null }`；损坏文件隔离，更高版本原字节保留且拒绝覆盖。
- macOS 安装完成后应用包已经替换：立即重启调用受控 Command，稍后重启保持旧进程并在下次正常启动进入新版本，不持久化或重复下载更新包。
- Windows 安装阶段通过 `on_before_exit` 同步关闭 Core 和日志后退出，由当前用户 NSIS 完成替换。
- 构建只读取 `TAURI_SIGNING_PRIVATE_KEY` 和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`；私钥、密码、下载 URL、签名和插件错误原文不得写入仓库或日志。
- 静态清单必须包含同一 SemVer、中文说明、UTC 发布时间及三个目标的 HTTPS URL 和签名；下载 URL 必须属于当前 Gitee 仓库的 Release 路径并包含目标版本，防止清单篡改后跳转任意站点或重放旧签名包。`latest.json` 是最后发布的唯一开关。
- Gitee `main` 是唯一源码主线，公开 GitHub 仓库只作为同步镜像和 CI 控制面；发布标签固定为 `v<SemVer>`，标签提交必须属于 Gitee `main`，三个版本来源一致，并包含非空中文 `releases/notes/v<版本>.md`。
- 版本说明进入标签校验和平台元数据前必须通过 `normalizeReleaseNotes` 把 CRLF、CR 统一为 LF 并去除首尾空白；不得把 Runner checkout 后的原始换行直接写入 `platform-metadata.json`，否则 Windows 与 macOS 会把同一说明误判为不一致。
- 发包只有两个受支持入口：日常正式发布由公开 GitHub Actions 在标准 Runner 上完成三平台构建、上传和公开；macOS 本地工具只生成、校验双架构安装包，用于故障排查、预验收或手工 DMG，不负责公开在线更新。
- 任一准备方式保留版本提交时都必须包含 `releases/notes/v<版本>.md`。本地 `release:mac:prepare` 尚未自动生成该文件，提交前必须把桌面发布目录中的 `RELEASE_NOTES.md` 复制到该路径，保证后续标签预检和托管发布使用同一说明。
- 当前公开清单要求三平台齐套。本地兼容命令 `release:mac:upload` 和 `release:mac:publish` 只能生成或写入 Mac-only 候选，因此在补齐三平台合并与强制校验前禁止用于正式发布；计划交给 CI 构建的同版本也禁止先上传本地同名附件。
- 敏感值只从仓库外文件、macOS 钥匙串或 GitHub Secret 读取，上传后匿名校验大小与 SHA-256，公开清单必须经过 `release-production` 人工门禁。
- GitHub Actions 的每个 job 都运行在全新的隔离 Runner 上，不继承前置 job 安装的 Node、pnpm、Rust 或依赖。任何执行 `pnpm` 的 job 都必须在 checkout 后先调用 `./.github/actions/setup-project`；公开 job 的稳定顺序为 `checkout -> setup-project -> download candidate -> publish-manifest`，不能因为 `aggregate` 已完成环境初始化而省略公开 job 的初始化。
- 同一 Actions 运行的 `Re-run failed jobs` 固定使用触发提交中的工作流定义；后续 `main` 上的工作流修复不会注入旧标签运行。公开 job 因环境初始化缺失而失败时，公开清单必须保持旧版本；恢复只能使用包含修复的新工作流入口，或在不移动旧标签的前提下用现有发布脚本重建并验证同一候选目录后执行已批准的公开动作。
- 三平台产物必须齐套后才能生成候选清单；同一标签重试只允许复用名称、大小和 SHA-256 全部一致的 Gitee 附件。标准 Runner 无法完成构建时必须停止并重新评审，禁止静默切换 Larger Runner、长期自托管机器或缺平台清单。
- `prepare` 构建前必须删除两个 target 下明确的旧 `.app`、`.app.tar.gz` 和 `.sig` 生成物；整理前必须读取新压缩包内的 `Info.plist` 与 Mach-O，断言版本和架构分别等于目标 SemVer 与平台键。文件名、修改时间、哈希和签名存在不能替代内容检查。
- 双架构构建已完成但校验或归档失败时，`stage` 可在版本来源一致的前提下复用现有构建；仍须从临时目录中的真实文件执行包内版本和架构断言，并在结束后清理临时目录，不得用大文件标准输入管道代替。

### 4. 校验与错误矩阵

| 条件 | 稳定结果 |
| --- | --- |
| 自动检查不足 24 小时 | `skipped`，零网络请求 |
| 检查或安装已有活动操作 | `update-check-busy` / `update-install-busy` |
| 清单 JSON、SemVer 或 URL 无效 | `update-manifest-invalid` |
| 当前平台或架构缺失 | `update-platform-unsupported` |
| 下载 URL 不属于批准仓库或不含目标版本 | `update-download-endpoint-invalid` |
| 更新说明为空、无中文或缺少发布时间 | `update-notes-missing` / `update-date-missing` |
| HTTPS 网络失败 | `update-check-failed` / `update-download-failed` |
| Tauri 签名无效 | `update-signature-invalid`，不安装 |
| 没有待更新句柄 | `update-not-available` |
| 状态文件损坏 | 隔离为 `updater-state.corrupt-*.json` 后重新检查 |
| 状态文件版本高于当前支持版本 | `update-state-version-unsupported`，原文件不变 |
| 目标版本不是更高 SemVer、标签提交与 Gitee 主线不一致、工作区不干净或未与 origin/main 同步 | 准备/上传/公开阶段立即停止，不修改远端 Release 或公开清单 |
| 签名材料或 Gitee 钥匙串令牌缺失 | 中文错误提示对应 service，禁止降级为明文参数或 `.env` |
| 已有同名附件哈希不同、已有 Release 未指向当前 main 提交 | 拒绝复用并停止发布 |
| 匿名下载状态、大小或 SHA-256 不一致 | 不生成或不公开候选清单 |
| 三平台说明仅换行风格不同 | 归一化为 LF 后继续汇总；归一化后正文仍不同则报“三平台更新说明不一致” |
| job 执行 `pnpm` 前未调用 `setup-project` | Runner 报 `pnpm: command not found` 并失败；候选 Release 可保留，公开清单不得变化 |
| 修复工作流后直接重跑旧标签的失败 job | 仍使用旧标签提交中的工作流定义；禁止移动标签，改用包含修复的新入口或验证后的本地恢复流程 |
| 本次构建未重新生成 `.app.tar.gz/.sig`，或压缩包内部版本/架构不匹配 | 准备/恢复阶段立即停止，禁止复制、上传和生成清单 |
| 本地 Mac-only 候选尝试上传同版本 CI 附件或覆盖三平台公开清单 | 立即停止；保留本地 DMG 做验收，由三平台托管流程完成上传和公开 |

### 5. Good / Base / Bad Cases

- Good：正式发布从 Gitee `main` 提交版本文件、仓库内中文说明和标签，GitHub Actions 校验同一提交后并行构建三平台，Gitee 附件匿名下载与哈希验证通过，人工门禁批准后才提交清单；本地 Mac 打包只把验证通过的 DMG 留在桌面稳定目录。
- Base：双架构本地构建完成后校验或归档失败，修复原因并用相同版本和说明执行 `stage`；它从临时目录中的真实文件重新校验并覆盖稳定发布目录，不重复编译或访问远端。公开 job 缺少工具链时保留已验证候选 Release 和旧公开清单，修复工作流后通过新入口完成三平台发布。
- Bad：把 Mac-only 本地候选上传为计划中的同版本 CI 附件或覆盖三平台公开清单、假设前置 job 的 pnpm 会出现在公开 job、修复 `main` 后直接重跑旧标签并期待工作流自动更新、把完整 Mach-O 通过标准输入交给会提前退出的 `file -`、把 Runner checkout 后的原始 CRLF/LF 直接写入平台元数据、只构建新 DMG 却把 target 中旧 `.app.tar.gz` 重命名为新版本、让脚本自动提交推送、把令牌或私钥写进仓库、静默覆盖不同内容的同名附件，或 macOS 稍后重启时再次下载安装包。

### 6. 必需验证与断言点

- 运行 `pnpm check:version`，断言前端、Rust 工作区和 Tauri 版本完全一致。
- 运行 `pnpm check:update-manifest -- <候选清单>`，断言平台键、SemVer、中文说明、UTC 时间、HTTPS、版本化 URL 和 Base64 签名均合法。
- 迁移对象存储或 CDN 前必须同时更新运行时批准域名/路径和清单校验器，并先完成匿名下载、重定向与签名验证；不能只替换清单地址。
- 运行完整 Rust/前端门禁，并用 `cargo tree -p trellis-core` 断言 Core 不包含 Tauri 或 updater。
- 静态检查 `.github/workflows/release.yml`：每个包含 `run: pnpm` 的 job 都在该命令前调用 `./.github/actions/setup-project`；尤其断言 `publish` 顺序为 checkout、setup、下载候选、公开清单。真实演练中公开 job 不得依赖前置 job 的 PATH 或依赖目录。
- Rust 回归测试必须把 `UpdateCheckResponse` 与 `UpdateDownloadProgress` 的全部变体序列化为 JSON，逐字段断言 `status`、`currentVersion`、`event`、`contentLength` 和 `downloaded` 与前端 Zod Schema 一致。
- 本地发布脚本至少验证帮助入口、非法版本、脏工作区、缺失发布目录、三平台示例清单和 macOS 候选清单；涉及 Gitee 的真实上传只使用测试版本，并确认重复执行不会产生不同内容的同名附件。
- 使用仓库外临时 fixture 分别以 LF、CRLF、CR 写入相同中文说明，依次执行三平台 `stage-platform` 与 `aggregate`；断言三个 `platform-metadata.json` 和最终 `release-metadata.json` 的 `notes` 完全相同且只包含 LF。
- macOS 双架构签名构建后，分别从 `.app.tar.gz` 解出 `Contents/Info.plist` 和主二进制；断言 `CFBundleShortVersionString` 等于目标版本，`file` 输出分别包含 `arm64`、`x86_64`，且 `.sig` 为本次清理后重新生成。
- 模拟构建完成后的归档失败，再以相同版本和中文说明执行 `stage`；断言不触发 Tauri 构建、双架构内容检查通过、稳定发布目录完整，并且成功或失败后均不残留 `trellis-updater-*` 临时目录。主二进制必须由 `file <path>` 检查，不得通过可能产生 `EPIPE` 的大文件标准输入传递。
- 仓库外 IPC mock 覆盖自动/手动检查、可用更新、错误、进度、立即/稍后重启和 375/768/1024/1440 零横向滚动。
- 当前在 macOS arm64、macOS x64 环境分别从 `0.2.0-beta.1` 升级到更高版本；断言版本、架构、数据保留和主业务正确。Windows 在恢复发布前补做原生验收。
- macOS 遵守 `desktop-runtime-contract.md` 的唯一安装副本与挂载清理；Windows 不得以 macOS 交叉构建替代原生验收。

### 7. Wrong vs Correct

#### Wrong

```text
构建一个平台 -> 立即覆盖 latest.json -> 客户端直接下载 -> 签名失败时允许继续
```

#### Correct

```text
Gitee main：提交版本文件、中文说明和 v<SemVer> 标签
-> GitHub Actions：标签提交校验、macOS 双架构/Windows x64 并行签名构建
-> aggregate/upload：Gitee Release、附件上传、匿名哈希验证、候选清单
-> release-production：人工批准后 Contents API 写入 latest.json
-> 客户端确认后下载并强制验签
```

```text
本地 Mac：release:mac:prepare（失败后可 stage）
-> 校验双架构 DMG/updater/签名/SHA-256
-> 手工安装验收或提供 DMG
-> 停止，不上传 Mac-only 候选，不修改 latest.json
```

```yaml
# 每个 Runner 都必须独立初始化，不能继承 aggregate 的工具链。
- uses: actions/checkout@v4
- uses: ./.github/actions/setup-project
- uses: actions/download-artifact@v4
- run: pnpm release:ci -- publish-manifest --directory candidate
```
