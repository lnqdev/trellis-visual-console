# Tauri 桌面客户端调研记录

## 调研时间

2026-07-20

## 仓库现状

- 当前产品由 React/Vite 页面与 Node.js/Fastify 本地服务组成，页面通过 HTTP API 与 SSE 消费本机数据：`README_CN.md:30-48`、`src/server/index.ts:51-65`。
- Rust 迁移涉及约 24 个服务端 TypeScript 文件；整个 `src/server`、`src/shared`、`src/web` 当前约 8387 行 TypeScript/TSX。
- Rust 后端需要覆盖文件系统、路径、加密哈希、子进程/系统打开、HTTP/SSE、Chokidar 监听与 JSON 原子存储等 Node 能力。
- 现有 Web 页面已经通过 `src/web/api-client.ts` 集中封装全部后端调用，通过 `useProjectConsole` 集中管理 SSE 和选择状态，替换通信层不要求重写组件树。
- 当前机器为 Apple Silicon macOS 26.3.1，已安装 Go 1.25，尚未安装 Rust 工具链；Windows x64 实机由用户在开发完成后提供。
- 当前仓库没有多平台 CI、签名、公证、安装包或发布流水线，远端为 Gitee。

## 官方资料结论

### Tauri 原生通信

Tauri 2 提供 Command 机制让 Web 前端调用 Rust 函数，支持参数、返回值、错误和异步命令；Event 机制适合 Rust 向前端发送 JSON 事件。现有 HTTP 请求可以映射为 Command，SSE 可以映射为 Event。

来源：<https://v2.tauri.app/develop/calling-rust/>

### 不采用 Go/Node sidecar

Tauri sidecar 需要在 `externalBin` 中登记外部二进制，并为每个目标架构准备带 target triple 后缀的二进制。保留 Node 或新增 Go sidecar 都会形成额外进程和 IPC，并保留独立运行时，不符合本任务的内存优先目标。

来源：<https://v2.tauri.app/develop/sidecar/>

### Go 备选

Wails 原生支持 Go + Web 前端、Go 方法到 JavaScript 的绑定和 TypeScript 模型生成，也能产出 macOS/Windows 原生程序。如果团队开发效率优先于最低内存，Wails + Go 是合理备选；用户已确认本任务继续采用 Tauri + Rust。

来源：<https://wails.io/docs/introduction/>

### 单实例

Tauri 官方单实例插件要求最先注册，第二次启动可在回调中显示并聚焦已有主窗口。该行为与本任务的存储安全和低资源目标一致。

来源：<https://v2.tauri.app/plugin/single-instance/>

### 本机集成

- Dialog 插件支持原生文件/目录选择和消息对话框。
- Opener 插件支持打开路径；本任务不向前端授予任意路径打开权限，而由 Rust Command 完成项目白名单和 realpath 校验后调用 Rust 侧 API。
- Logging 插件支持日志目标与轮转策略，可用于本地结构化日志。

来源：

- <https://v2.tauri.app/plugin/dialog/>
- <https://v2.tauri.app/plugin/opener/>
- <https://v2.tauri.app/plugin/logging/>

### 分发

- macOS 可生成 App Bundle 与 DMG。
- Windows 可生成 NSIS `setup.exe` 或 WiX MSI；MSI 只能在 Windows 构建。
- 官方说明 macOS/Linux 交叉构建 Windows NSIS 存在限制，应优先使用 Windows 原生环境或 CI。
- Windows 安装器默认在缺少 WebView2 时下载 bootstrapper；完整离线 WebView2 会显著增大安装包。

来源：

- <https://v2.tauri.app/distribute/>
- <https://v2.tauri.app/distribute/windows-installer/>

## 结论

首版采用 Tauri 2 + Rust 原生后端，保留 React/Vite 前端，不包含 Node/Go sidecar。现有业务合同逐项迁移到独立 `trellis-core` crate，Tauri 通过 Command 与 Event 适配同形 DTO。未来若恢复本机 Web 形态，可新增 Axum HTTP/SSE adapter 复用 Core；远程 Web 仍需要独立的认证、TLS 和路径安全设计。首版交付 macOS arm64/x64 DMG 与 Windows x64 NSIS 安装器，Windows 构建和验收在原生 Windows x64 实机完成。
