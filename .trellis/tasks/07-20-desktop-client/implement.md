# Tauri 桌面客户端实施计划

## 0. 范围变更（2026/7/21）

- 阶段 0-9 及共享跨平台实现由当前任务完成。
- 原阶段 10 已拆分为独立任务 `.trellis/tasks/07-21-desktop-client-windows-x64`，当前任务不等待 Windows 机器即可进入 macOS 交付收尾。
- macOS 主动断网验收按用户要求后置；运行期零 TCP/UDP 连接与监听审计已经完成。

## 1. 实施原则

- 当前任务已完成规划审批并进入 `in_progress`；本计划保留原实施顺序和验收证据。
- Codex 使用项目默认 inline 模式，不创建 worktree，不分派实现子代理。
- 默认不新增测试类或仓库测试文件；验证 fixture、断言脚本和 Playwright IPC mock 放在仓库外临时目录。
- 每个阶段都以现有 TypeScript 行为和 `.trellis/spec` 合同为对照，不在迁移时顺带重构 UI 或增加业务功能。
- Node/Fastify 后端在功能对等前保留作参考，最终交付必须删除生产依赖和启动入口。
- Rust 代码保持 `src-tauri -> trellis-core` 单向依赖；Core 禁止依赖 Tauri、HTTP 框架、窗口和插件类型，首版不创建 Web server crate。

## 2. 有序实施清单

### 阶段 0：建立基线与工具链

- 记录当前 Git 状态、Node/pnpm 版本、现有构建结果和阶段六性能基线。
- 安装 Rust stable、Cargo、macOS x64 target 与 Tauri 2 系统依赖；记录实际版本。
- 使用仓库外临时目录准备现有 28 项目/2 焦点基准、坏 YAML/JSON/JSONL、Task 关系、符号链接和路径攻击 fixture。
- 启动当前 Web 版本，保存项目列表、任务中心、项目详情、正文、错误和事件的基线输出。

### 阶段 1：建立 Cargo workspace、Core 边界与 Tauri 外壳

- 修改 `package.json`：加入 Tauri CLI/API 与桌面开发、构建、Rust 检查脚本；移除动作留到最终清理阶段。
- 新增根 `Cargo.toml` workspace 与 `crates/trellis-core/Cargo.toml`、`src/lib.rs`，先建立无 Tauri/HTTP 依赖的空 Core crate。
- 新增 `src-tauri/Cargo.toml`、`build.rs`、`tauri.conf.json`、`capabilities/default.json`、`src/main.rs` 与 `src/lib.rs`。
- 配置应用名、bundle identifier、macOS 13 最低版本、NSIS 当前用户安装和 WebView2 下载 bootstrapper。
- single-instance 插件必须最先注册；二次启动显示并聚焦主窗口。
- 建立 Core 应用服务入口、空 Command 适配与共享 `AppState`，确保 `tauri dev` 可打开现有 React 页面。
- 生成 1024x1024 图标源和 Tauri 全套图标，检查 macOS/Windows 缩略尺寸可辨识。

### 阶段 2：迁移线协议、存储和版本 1→2 数据

- 在 `crates/trellis-core/src/contracts/` 建立与 `src/shared/api.ts`、`src/shared/project-events.ts` 同形的 Serde DTO，统一 camelCase、null、默认字段与 ISO UTC 时间。
- 实现 `CommandError { code, message, details }`，禁止返回堆栈、绝对路径和底层错误原文。
- 在 `crates/trellis-core/src/storage/` 实现版本 2 Schema、串行读改写、UTF-8、损坏隔离、版本拒绝、同目录临时文件、sync 与跨平台原子替换；路径从 adapter 注入。
- 实现版本 1 注册表校验、双文件备份、版本 2 提交标记、空快照写入和幂等中断恢复。
- 保持稳定 ID 与旧注册表项目完全一致；验证迁移前后项目 ID、路径、名称、状态和时间字段不变。
- 通过仓库外 fixture 验证缺失、损坏、未来版本、迁移中断、并发保存和源项目零写入。

### 阶段 3：迁移项目发现、索引和正文读取

- 在 `crates/trellis-core/src/projects/` 迁移文件系统错误归一、路径工具、项目校验、递归扫描、Trellis 索引、Task 详情和 Markdown/JSONL 读取。
- 保持扫描忽略目录、符号链接拒绝、稳定 ID、Spec 树、Workflow 摘要和中文诊断合同。
- 完整迁移 Task 父子关系候选收集、优先级、稳定排序、跨活动/归档解析、循环/冲突隔离和原顺序保留。
- 正文读取按“读取资格 → 快照白名单 → 原始路径拒绝 → 文件类型/符号链接 → canonical path 边界”执行。
- 对同一临时 fixture 比较 TypeScript 与 Rust 的注册候选、快照、诊断 code、Task 关系和正文拒绝结果。

### 阶段 4：迁移 Core 应用服务并接入 Tauri Command

- 迁移 Catalog 的扫描、单个/批量登记、列表、快照配对、刷新和状态更新；跨注册表/快照操作进入同一异步串行锁。
- 保持登记时“快照先保存、注册表后保存”，不可用时只更新注册表并保留旧快照。
- 迁移项目列表、跨项目任务中心和项目详情投影；任务中心只读取一次 Catalog 快照，不读取正文。
- 在 Core 中形成传输无关的应用服务；在 `src-tauri/src/commands/` 实现项目、任务、Spec/Task 正文、焦点、刷新等薄 Command adapter，并注册到单一 invoke handler。
- 保持当前进程内 `contentReadable` 临时授权：焦点为真，历史显式刷新成功后为真，重启/失败/移出焦点后清除。
- 使用 `src/shared/api.ts` 的 Zod Schema 对全部真实 Command 响应做运行时校验。

### 阶段 5：迁移实时监听和事件

- 在 `crates/trellis-core/src/realtime/` 实现事件端口、允许路径 watcher、项目级队列、300ms 防抖、10 秒轮询和 RealtimeManager。
- 只监听 Spec、Task、config 与 workflow；历史/不可用项目保持零监听。
- 保持聚焦、取消聚焦、不可用、修复刷新、原生失败降级和退出清理的固定顺序。
- Core 只调用 `EventSink`；Tauri adapter 使用 `AppHandle` 将事件发送到主窗口的 `trellis://project-realtime`，payload 继续使用共享事件合同。
- 使用临时 fixture 验证批量事件、原生失败、轮询失败、项目移动/删除、修复恢复、启动焦点恢复和关闭资源释放。

### 阶段 6：迁移系统集成、日志和数据清理

- 用 Tauri Dialog Rust API 替换 PowerShell/AppleScript 目录选择，保留取消、忙碌和中文错误语义。
- 用 Rust 侧 Opener API 实现受控项目路径、日志目录和外部 HTTP(S) 链接打开；前端不获得任意路径权限。
- 配置本地日志：最多 5 个文件、每个 2 MiB；所有日志调用只传稳定 ID、计数、模式和错误类型。
- 实现 `clear_application_data_and_exit`：确认标记、拒绝新任务、关闭 watcher/队列、删除固定应用数据目录并退出。
- 为 Windows NSIS 增加卸载时数据保留/删除选择，默认保留且删除范围固定为应用数据目录。

### 阶段 7：迁移 React 通信层并保持 UI 对等

- 将 `src/web/api-client.ts` 改造为集中式 Tauri invoke 客户端；组件不直接导入 Tauri API。
- 成功响应与错误响应继续经过 Zod；将 `ApiClientError` 改为无 HTTP 语义的桌面错误类型。
- `useProjectConsole` 用单一 Tauri `listen` 替换 EventSource，保留 150ms 合并、任务中心刷新代次和项目详情过期响应保护。
- 删除健康接口和 HTTP 重连文案，增加桌面初始化状态、打开日志目录与清除数据二次确认。
- 保持项目发现、任务中心、项目视图、URL 选择、Markdown 安全、响应式布局和全部中文错误行为。
- 使用 Playwright + 临时 IPC mock 验证 375/768/1024/1440 布局、任务中心 2000 行分批渲染、URL 清理、异步竞态和 Markdown 安全；使用真实 Tauri 应用验证 Command/Event 集成。

### 阶段 8：删除 Node 生产后端并同步文档/规范

- 删除 `src/server/`、`src/shared/health.ts`、Fastify/Vite 代理和 Node 服务 TypeScript 配置。
- 从依赖中删除 Fastify、静态插件、Chokidar、`open`、`tsx`、`concurrently` 与不再使用的类型。
- 调整 `package.json` 脚本，使 `pnpm dev` 进入 Tauri 开发，`pnpm build` 产出桌面包；保留独立 `build:web` 用于前端检查。
- 更新 README、产品架构文档、验证报告和 `.trellis/spec`：HTTP/SSE 合同改为 Tauri Command/Event 合同，存储合同升级到版本 2，新增 Core/adapter 边界、桌面生命周期、隐私和分发规范。
- 检查仓库不存在第二套生产后端、未使用端口、遥测、自动更新或 Node sidecar。
- 运行 Core 独立编译与依赖树检查，确认没有 Tauri、Axum、Actix、窗口或插件依赖；不创建占位 Web server。

### 阶段 9：macOS 构建与验收

- 构建并安装 macOS arm64 DMG，验证首次安装、覆盖安装、单实例、目录选择、完整业务流程、监听、日志、迁移、清理数据和退出。
- 构建 macOS x64 DMG，在 Apple Silicon + Rosetta 下执行相同核心流程；明确记录未完成 Intel 实机的部分。
- 采集冷启动、窗口可操作时间、应用进程树内存、5 分钟空闲 CPU、安装包大小和退出耗时。
- 验证断网运行、无运行期网络请求、Gatekeeper 提示说明和应用图标。

### 阶段 10：Windows x64 后置验收（已拆分）

- 完整范围、设计、执行顺序和门禁已迁移到 `.trellis/tasks/07-21-desktop-client-windows-x64`。
- 新任务保持 `planning`，取得 Windows x64 实体机并经用户审阅后再启动。

## 3. 验证命令

规划中的主要门禁，实际版本与 target 名称在工具链初始化后记录：

```bash
pnpm install
pnpm lint
pnpm typecheck
pnpm build:web
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo check --workspace --all-targets --all-features
cargo check -p trellis-core
cargo tree -p trellis-core
pnpm tauri build --target aarch64-apple-darwin
pnpm tauri build --target x86_64-apple-darwin
git diff --check
```

以下命令迁移到独立 Windows 任务执行：

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
cargo fmt --manifest-path src-tauri/Cargo.toml -- --check
cargo clippy --manifest-path src-tauri/Cargo.toml --all-targets --all-features -- -D warnings
cargo check --workspace --all-targets --all-features
cargo check -p trellis-core
pnpm tauri build --target x86_64-pc-windows-msvc
```

## 4. 风险文件与回滚点

| 风险区域 | 风险 | 回滚点 |
| --- | --- | --- |
| `crates/trellis-core/` | Core 泄漏 Tauri/HTTP 类型，未来 Web 无法复用 | Core 独立编译与依赖树门禁；adapter 只能单向依赖 Core |
| `crates/trellis-core/src/storage/` | 迁移或原子替换错误导致应用数据丢失 | 所有 v1 文件先备份；版本 2 注册表最后提交 |
| `crates/trellis-core/src/projects/` | Rust 与 Node 路径、解析或 Task 关系语义漂移 | 同一 fixture 双实现输出对照，失败时只回滚对应模块 |
| `crates/trellis-core/src/realtime/` | 重复 watcher、降级竞态或退出泄漏 | 项目级队列与可注入 watcher；保留旧实时合同作验收基线 |
| `src/web/api-client.ts`、`useProjectConsole.ts` | IPC 无原生取消导致陈旧响应覆盖 | 保留代次/ref/响应 ID 三重提交校验 |
| `src-tauri/tauri.conf.json`、NSIS hooks | 安装范围、WebView2 或卸载数据误删 | 当前用户安装、固定数据目录、虚拟机/实机先验证再交付 |
| 删除 `src/server/` | 过早删除使行为基线丢失 | 仅在 Command/Event 与 UI 对等通过后执行最终清理 |

## 5. 启动实施前检查

- [x] 用户已审阅并批准 `prd.md`、`design.md` 与 `implement.md`。
- [x] PRD 不含重复、冲突或已解决开放问题，验收标准可测试。
- [x] Rust 工具链与 Tauri 系统依赖的安装权限可用。
- [x] 当前工作区用户改动已识别，不覆盖无关修改。
- [x] 临时 fixture 和基线输出位于仓库外，不写入真实 Trellis 项目。
- [x] Windows x64 原生交付已拆分为独立规划任务，不再阻塞当前 macOS 任务收尾。
