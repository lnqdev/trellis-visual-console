# 桌面在线更新可执行合同

## 场景：Tauri 签名在线更新

### 1. 范围与触发条件

- 修改更新插件、端点、公钥、版本、更新 Command、`updater-state.json`、重启流程或发布产物时必须遵守本合同。
- 更新能力只属于 `src-tauri` 桌面适配层；`trellis-core` 不得依赖 Tauri、HTTP 客户端或更新插件。
- 支持目标固定为 `darwin-aarch64`、`darwin-x86_64`、`windows-x86_64`，扩展目标前必须同步清单校验与真实升级矩阵。

### 2. 签名

```text
check_for_update(mode, app, state) -> UpdateCheckResponse
install_update(onProgress: Channel<UpdateDownloadProgress>, state) -> UpdateInstallResponse
restart_application(app, state) -> ()
```

- `mode`：`automatic | manual`。
- `UpdateCheckResponse.status`：`skipped | upToDate | available`。
- `available.update`：`currentVersion`、`version`、非空中文 `notes`、RFC 3339 `publishedAt`、`platform`。
- Channel 事件：`started { contentLength }`、`progress { downloaded, contentLength }`、`downloadFinished`。
- `UpdateInstallResponse`：`restartRequired: boolean`。

### 3. 合同

- Tauri 配置必须使用 HTTPS `latest.json`、内置公钥和 `bundle.createUpdaterArtifacts=true`；禁止启用无效证书、无效主机名或 HTTP 例外。
- 自动检查距离上次完成不足 24 小时返回 `skipped`，不联网；手动检查不受限制。检查只读取清单，不下载。
- 检查与安装共享一个进程内互斥标记。开始真实检查前清除旧 `Update` 句柄；只有成功发现新版本后才保存新句柄。
- 用户明确确认后才调用安装。Tauri 在安装前强制验证签名，前端不能绕过或直接调用 updater 插件。
- `updater-state.json` 位于固定应用数据目录，格式为 `{ version: 1, lastAutomaticCheckAt: string | null }`；损坏文件隔离，更高版本原字节保留且拒绝覆盖。
- macOS 安装完成后应用包已经替换：立即重启调用受控 Command，稍后重启保持旧进程并在下次正常启动进入新版本，不持久化或重复下载更新包。
- Windows 安装阶段通过 `on_before_exit` 同步关闭 Core 和日志后退出，由当前用户 NSIS 完成替换。
- 构建只读取 `TAURI_SIGNING_PRIVATE_KEY` 和 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD`；私钥、密码、下载 URL、签名和插件错误原文不得写入仓库或日志。
- 静态清单必须包含同一 SemVer、中文说明、UTC 发布时间及三个标准平台的 HTTPS URL 和签名；下载 URL 必须属于当前 Gitee 仓库的 Release 路径并包含目标版本，防止清单篡改后跳转任意站点或重放旧签名包。`latest.json` 是最后发布的唯一开关。

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

### 5. Good / Base / Bad Cases

- Good：三平台同版本产物和签名齐全，匿名下载与哈希验证通过，最后提交清单；客户端展示中文说明后由用户确认安装。
- Base：清单不可访问或当前无更新；界面给出可恢复结果，项目浏览、本机数据和源项目保持不变。
- Bad：先发布只有一个平台的清单、把私钥写进仓库、自动静默下载，或 macOS 稍后重启时再次下载安装包。

### 6. 必需验证与断言点

- 运行 `pnpm check:version`，断言前端、Rust 工作区和 Tauri 版本完全一致。
- 运行 `pnpm check:update-manifest -- <候选清单>`，断言平台键、SemVer、中文说明、UTC 时间、HTTPS、版本化 URL 和 Base64 签名均合法。
- 迁移对象存储或 CDN 前必须同时更新运行时批准域名/路径和清单校验器，并先完成匿名下载、重定向与签名验证；不能只替换清单地址。
- 运行完整 Rust/前端门禁，并用 `cargo tree -p trellis-core` 断言 Core 不包含 Tauri 或 updater。
- 仓库外 IPC mock 覆盖自动/手动检查、可用更新、错误、进度、立即/稍后重启和 375/768/1024/1440 零横向滚动。
- 在 macOS arm64、macOS x64、Windows x64 原生环境分别从 `0.2.0-beta.1` 升级到更高版本；断言版本、架构、数据保留和主业务正确。
- macOS 遵守 `desktop-runtime-contract.md` 的唯一安装副本与挂载清理；Windows 不得以 macOS 交叉构建替代原生验收。

### 7. Wrong vs Correct

#### Wrong

```text
构建一个平台 -> 立即覆盖 latest.json -> 客户端直接下载 -> 签名失败时允许继续
```

#### Correct

```text
统一版本 -> 三平台原生构建与签名 -> 匿名下载和哈希验证
-> 校验候选清单 -> 最后发布 latest.json -> 客户端确认后下载并强制验签
```
