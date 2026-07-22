# 桌面端在线更新技术设计

## 1. 架构与边界

在线更新属于 Tauri 桌面适配能力，不进入 `trellis-core`。依赖方向保持 `React -> Tauri Command -> tauri-plugin-updater`，不新增本地 HTTP 服务、Node sidecar 或任意网络代理。

```text
DiagnosticsPanel / 顶层更新提示
  -> src/web/api-client.ts（Zod 校验）
  -> update_check / update_install Command
  -> tauri-plugin-updater
  -> Gitee raw/main/releases/latest.json
  -> Gitee Release 平台更新包
```

- Rust 侧独占待安装 `Update` 句柄和安装流程，前端不得直接导入 updater 插件。
- `src/shared/api.ts` 定义更新响应、状态和错误的线协议；所有用户可见文案为中文。
- `AppState` 增加更新会话状态及自动检查时间存储；更新状态与项目 Core 相互独立。
- 更新端点固定使用 HTTPS；生产配置不启用非 TLS 例外。

## 2. 更新合同

### 2.1 检查更新

新增 `check_for_update` Command，参数 `mode` 为 `automatic | manual`：

- `automatic` 读取 `<应用数据目录>/updater-state.json`；距离上次自动检查不足 24 小时则返回 `skipped`，不发起网络请求。
- 超过 24 小时或不存在记录时请求更新清单；请求结束后原子记录检查时间，避免连续重启反复访问。
- `manual` 不受 24 小时限制。
- 响应为 `upToDate | available | skipped`，可用更新仅暴露当前版本、目标版本、中文说明和发布时间，不向前端暴露签名或内部下载地址。
- 同一时刻只允许一个检查；并发调用返回稳定 `update-check-busy` 错误。

`updater-state.json` 只保存格式版本和上次自动检查时间，使用 UTF-8、同目录临时文件、同步和原子替换；损坏时隔离后视为从未检查，不影响 `registry.json`、`snapshots.json` 或源项目。

### 2.2 下载、安装与重启

`check_for_update` 将插件返回的待更新句柄保存在 Rust 内存。新增 `install_update` Command：

- 没有待更新句柄时返回 `update-not-available`。
- 用户在界面阅读版本和中文说明并确认后才调用。
- 下载过程通过 Tauri Channel 返回总字节数、累计字节数和完成事件，用于稳定进度显示。
- 插件在安装前验证内置公钥对应的 Tauri 签名；签名失败统一映射为中文稳定错误，日志只记录错误类型。
- macOS 安装完成后返回 `restartRequired=true`。选择“立即重启”调用受控 `restart_application`；选择“稍后重启”不做额外持久化，因为应用包已替换，当前旧进程继续运行，下次启动直接进入新版本。
- Windows 在下载前说明安装阶段将退出；插件执行 NSIS 更新时应用自动退出，不提供“稍后重启”。
- 下载或安装失败时清理内存待更新句柄，用户可重新检查；不得触碰应用数据和已登记项目。

### 2.3 前端状态

新增独立 `useApplicationUpdater` Hook，状态机为：

```text
idle -> checking -> upToDate | available | failed
available -> downloading -> installed | failed
installed(macOS) -> restartNow | restartLater
```

- 应用主界面可操作后触发一次 `automatic` 检查。
- 构建时注入的当前版本在全局侧边栏与诊断页同时展示；重启进入新应用包后，两处均直接显示新版本，不依赖网络检查成功。
- 发现更新时显示非阻断顶层提示；诊断页提供应用版本、内测标识、上次检查结果和“检查更新”按钮。
- 确认界面展示目标版本和非空中文更新说明，不使用 `window.confirm` 承载长文本。
- 更新按钮、进度条、失败重试与重启操作具有稳定尺寸、`aria-live` 状态和键盘可达性。
- 项目操作的 `busyAction` 与更新状态分离，检查或下载不得阻止项目只读浏览。

## 3. 发布与签名

### 3.1 信任根

- 使用 Tauri CLI 生成更新签名密钥对；公钥内容写入 `tauri.conf.json`，不能配置为本机文件路径。
- 私钥和密码不得进入仓库、安装包、日志或任务文档；构建时只通过 `TAURI_SIGNING_PRIVATE_KEY` 与 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 注入。
- 私钥至少保留一份离线加密备份。丢失私钥后，已安装客户端不能切换信任根，只能再次手工安装新过渡版本。
- Tauri 更新签名不可关闭；Apple Developer ID、公证和 Windows 商业签名不属于本次免费内测门槛。

### 3.2 产物与清单

`bundle.createUpdaterArtifacts=true`。当前 macOS 内测版本必须准备：

- macOS arm64：DMG 手工安装包、`.app.tar.gz` 更新包及 `.sig`。
- macOS x64：DMG 手工安装包、`.app.tar.gz` 更新包及 `.sig`。
- Windows x64 的 NSIS 手工/更新安装包及 `.sig` 保留为后续正式扩展目标，不进入当前 Mac-only 发布门禁。

Gitee Release 托管上述产物。仓库 `releases/latest.json` 使用 Tauri 静态清单格式，当前包含 `version`、非空中文 `notes`、`pub_date` 及 `darwin-aarch64`、`darwin-x86_64` 两个平台的 HTTPS URL 和签名；恢复 Windows 发布时再加入 `windows-x86_64`。

当前发布顺序必须为：统一版本 -> macOS 双架构构建 -> 校验签名/哈希 -> 上传同一 Gitee Release -> 验证匿名下载 -> 生成并校验清单 -> 最后更新 `main` 分支的 `releases/latest.json`。清单是唯一发布开关；任一 Mac 架构缺失都不得更新。

### 3.3 本地发布自动化

- 使用仓库内 Node.js 脚本编排现有 `pnpm`、Tauri CLI、Git 和 Gitee Open API，不引入付费托管或常驻发布服务。
- `prepare` 阶段接收目标 SemVer 与中文说明，更新三个版本来源，执行质量门禁和 macOS arm64/x64 签名构建，再把同名的 Tauri 原始产物复制为带架构后缀的唯一文件名，集中写入仓库外稳定发布目录。
- 脚本直接从现有仓库外私钥和 macOS 钥匙串读取签名密码；Gitee 私人令牌也只从钥匙串读取。任何密钥、密码和令牌都不得进入参数、Git、日志或生成文件。
- `upload` 阶段通过 Gitee Open API 创建或复用目标 Release，上传附件后以匿名请求逐个校验状态、大小和 SHA-256，并据实际附件 URL 与 `.sig` 内容生成候选清单。
- `publish-manifest` 必须是独立显式动作：重新校验候选清单后才写入仓库 `releases/latest.json`，默认不自动提交或推送，确保构建、上传与客户端发现之间仍有人工门禁。
- 首版自动化以当前 macOS 内测发布为目标，脚本结构保留后续在 Windows 原生机提供 `prepare` 产物并合并为三平台正式清单的入口。

首个版本为 `0.2.0-beta.1`，现有 `0.1.0` 用户必须手工安装一次。之后使用 SemVer 单调递增更新。

## 4. 失败、冻结与恢复

- 清单不可访问、格式错误、Gitee 超时或下载失败均为可恢复错误，不影响主界面和本地数据。
- 签名、目标架构或版本校验失败时拒绝安装，不允许用户绕过。
- 严重问题版本先把 `latest.json` 恢复为最后安全版本或临时撤下，阻止尚未升级的客户端继续发现；已升级客户端等待更高修复版本。
- 不支持静默降级、自动回退或替换内置公钥。
- Gitee 迁移到对象存储/CDN 时只变更端点与清单中的下载基地址；更新状态机和签名信任根保持不变。

## 5. 兼容与验证边界

- macOS 继续按未签名内测包处理 Gatekeeper，Windows 继续说明 SmartScreen 风险。
- macOS 验收遵循唯一目标安装副本和 DMG 挂载清理合同；既有用户副本未经授权不得删除。
- Windows 更新必须在 Windows x64 实体机使用当前用户 NSIS 验证，不能由 macOS 交叉构建代替。
- 日志只记录检查开始/结束、是否发现版本、下载/安装阶段和稳定错误类型，不记录 URL 查询参数、签名、公钥、私钥、绝对路径或插件原始错误。
- 前端 IPC mock 覆盖状态机与响应式布局；当前真实安装从 `0.2.0-beta.1` 升级到更高测试版本，验证 macOS 双架构均不重复手工安装。Windows 留作后续原生环境验收。
