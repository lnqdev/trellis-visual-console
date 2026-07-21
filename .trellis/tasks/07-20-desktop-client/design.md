# Tauri 桌面客户端技术设计

## 0. 交付范围变更（2026/7/21）

共享架构与代码边界仍面向 macOS 和 Windows。当前任务的交付与完成门禁收敛为 macOS arm64/x64；Windows x64 原生构建、NSIS、WebView2、平台路径/监听/性能/卸载验收由独立任务 `.trellis/tasks/07-21-desktop-client-windows-x64` 承接。本节覆盖本文后续任何“Windows 未验证则当前任务不能完成”的旧表述。

## 1. 设计摘要

客户端采用 Tauri 2 + 独立 Rust Core + 现有 React/Vite 前端。首版生产环境不启动 Node.js、Fastify、本地 HTTP 端口或 sidecar；原 HTTP API 映射为 Tauri Command，原 SSE 映射为 Tauri Event。

Rust 后端分为传输无关的 `trellis-core` 与 Tauri 桌面适配层。Core 不依赖 Tauri、HTTP 框架、窗口或插件类型；未来如需恢复本机 Web 形态，可新增 Axum HTTP/SSE adapter 复用相同应用服务、DTO 和事件端口，不重写领域实现。首版不创建该 Web adapter。

桌面化是运行形态与后端语言迁移，不改变现有产品领域合同：源项目 `.trellis/` 始终只读，应用只写自己的注册表、快照和日志；历史项目零监听；焦点项目只监听允许的 Trellis 路径；正文读取继续经过临时读取资格、快照白名单和 realpath 边界三层校验。

```text
React/Vite WebView
  ├─ invoke / listen
  ▼
Tauri 桌面适配层（首版）
  ├─ Command / Event 映射
  ├─ 窗口、单实例与插件
  └─ 目录选择、外部打开、日志与数据清理
  │
  │                    未来可新增
  │                    Axum HTTP / SSE adapter
  ▼
trellis-core（无 Tauri / HTTP 依赖）
  ├─ 应用服务、DTO 与错误合同
  ├─ 项目注册表、快照与迁移
  ├─ 扫描、校验、索引和正文读取
  └─ 文件监听、批量重索引与事件端口
  │
  ▼
已登记项目的本地 .trellis/ 目录
```

## 2. 代码边界

新增 Cargo workspace、独立 Core crate 与标准 Tauri 目录：

```text
Cargo.toml
crates/
  trellis-core/
    Cargo.toml
    src/
      application/
      contracts/
      projects/
      realtime/
      storage/
      lib.rs
src-tauri/
  Cargo.toml
  build.rs
  tauri.conf.json
  capabilities/
    default.json
  icons/
  src/
    main.rs
    lib.rs
    commands/
    system/
```

模块映射：

| 当前 TypeScript | Rust 目标 | 迁移要求 |
| --- | --- | --- |
| `src/server/storage/*` | `crates/trellis-core/src/storage/*` | 版本校验、备份、原子写、串行读改写和损坏隔离保持一致 |
| `src/server/projects/*` | `crates/trellis-core/src/projects/*` | 稳定 ID、扫描忽略、Task 关系、中文诊断与 realpath 边界保持一致 |
| `src/server/realtime/*` | `crates/trellis-core/src/realtime/*` | 历史零监听、焦点顺序、300ms 防抖、10s 轮询降级和轻量事件保持一致 |
| `src/server/api/project-api-service.ts` | `crates/trellis-core/src/application/*` | 保留 DTO 组合与正文读取资格，不依赖具体传输协议 |
| `src/server/system/*` | `src-tauri/src/system/*` | 改用 Tauri 原生对话框、受控路径打开和日志目录打开 |
| `src/shared/api.ts` | 前端 Zod 线协议合同 + Core Serde DTO | 继续校验所有 IPC 返回；Core DTO 使用相同字段名与可空语义 |
| `src/shared/project-events.ts` | 前端事件线协议合同 + Core 事件端口 | 保留事件字段与运行时守卫，由 adapter 选择 Event 或未来 SSE |
| `src/web/api-client.ts` | `src/web/desktop-client.ts` | 保留函数级调用入口，内部从 `fetch` 改为 `invoke` |
| `useProjectConsole` 的 `EventSource` | Tauri `listen` | 保留 150ms 前端合并、单订阅和过期响应保护 |

完整功能对等后删除 `src/server/`、Fastify、Chokidar、`open`、`tsx`、`concurrently` 和服务端 TypeScript 构建配置。迁移过程中旧服务代码只作为行为对照，不进入最终生产包。

依赖方向固定为 `src-tauri -> trellis-core`。Core 通过构造参数接收应用数据路径，通过 `EventSink` 端口发布领域事件，不导入 `tauri::AppHandle`。未来的 `web-server -> trellis-core` 可以使用同一应用服务并把 `EventSink` 映射为 SSE；不会出现 Tauri Command 调用 HTTP 或 Web adapter 反向依赖桌面插件的结构。

## 3. IPC 合同

Tauri Command 是 Core 应用服务的薄适配器，只负责参数反序列化、调用和错误透传。Core 使用对象请求和可序列化响应，字段统一使用 camelCase；命令名保持稳定的 snake_case：

| Command | 请求 | 响应 |
| --- | --- | --- |
| `list_projects` | 无 | `ProjectListResponse` |
| `list_tasks` | 无 | `TaskCenterResponse` |
| `get_project` | `{ projectId }` | `ProjectDetailResponse` |
| `scan_projects` | `{ rootPath }` | `ProjectScanResponse` |
| `register_projects` | `{ projects }` | `ProjectRegisterResponse` |
| `set_project_focus` | `{ projectId, focused }` | `ProjectActionResponse` |
| `refresh_project` | `{ projectId }` | `ProjectActionResponse` |
| `read_spec_document` | `{ projectId, sourcePath }` | `ProjectDocumentResponse` |
| `read_task_detail` | `{ projectId, sourcePath }` | `TaskDetailResponse` |
| `read_task_document` | `{ projectId, taskSourcePath, documentPath }` | `ProjectDocumentResponse` |
| `open_project_path` | `{ projectId, sourcePath? }` | `{ opened: true }` |
| `select_directory` | 无 | `DirectoryPickerResponse` |
| `open_log_directory` | 无 | `{ opened: true }` |
| `clear_application_data_and_exit` | `{ confirmed: true }` | 不返回，清理后退出 |

所有 Command 返回 `Result<T, CommandError>`。错误固定包含 `code`、中文 `message` 和可选 `details`，不再携带没有意义的 HTTP 状态码。前端把未知错误先视为 `unknown`，用 Zod 校验错误与成功响应；IPC 漂移统一显示“客户端返回格式不正确”。

Core 通过 `EventSink` 发布 `ProjectRealtimeEvent`。Tauri adapter 将其映射为固定事件名 `trellis://project-realtime`；payload 只包含事件 ID、项目 ID、资源、失效范围、时间、监听模式，不包含快照、正文或绝对路径。前端只建立一个 `listen` 订阅，卸载 Hook 时调用 `unlisten`。

Tauri IPC 不支持等价的 `AbortController` 网络取消。用户切换与后台刷新继续依赖现有请求代次、当前项目 ref 和响应项目 ID 丢弃过期结果；耗时扫描和索引放入异步任务，不能阻塞窗口线程。

## 4. 启动与生命周期

1. Tauri Builder 首先注册 single-instance 插件，第二次启动只显示并聚焦 `main` 窗口。
2. 初始化受控滚动日志和应用路径，加载或迁移注册表/快照。
3. 创建共享 `AppState`，其中持有 `trellis-core` 应用服务，以及桌面日志、窗口和关闭状态。
4. 主窗口在 2 秒预算内进入可操作状态；不等待焦点项目完整重索引。
5. 后台顺序恢复焦点项目：重新校验、索引、启动监听，并通过事件通知前端刷新。
6. 主窗口关闭时通过 Core 拒绝新任务，等待项目队列，清除定时器并关闭全部监听器，然后退出进程。

没有托盘、后台常驻、多窗口和本地 HTTP 健康接口。界面中的“实时通道”语义调整为进程内事件通道；初始化失败展示可恢复中文错误，致命存储版本错误阻止业务操作但不得覆盖原文件。

## 5. 存储与一次性迁移

Core 存储使用 UTF-8 JSON、严格 Serde 结构、同目录临时文件、文件同步和跨平台原子替换。Catalog 使用一个异步串行锁保护注册表与快照的完整读改写；项目生命周期另使用项目级队列，保持现有顺序与竞态隔离。应用数据路径由 adapter 解析后传入 Core，使未来本机 Web 服务能够显式复用同一目录规则。

桌面版存储版本升级为 2，业务字段保持与版本 1 兼容：

1. 若不存在数据文件，创建空的版本 2 注册表和快照。
2. 若注册表为版本 1，先完整读取并校验；校验失败不得进入迁移。
3. 使用带时间戳且不覆盖的名称备份原 `registry.json` 与 `snapshots.json`。
4. 先原子写入空的版本 2 快照，再原子写入版本 2 注册表；注册表版本 2 是迁移提交标记。
5. 窗口可操作后，根据迁移后的项目列表在后台重建快照；焦点项目恢复监听，历史项目只在本次迁移中执行一次重建，不形成长期监听。
6. 迁移中断时，根据注册表版本重新进入幂等流程；版本高于 2 时停止初始化并保留原字节。

正常版本 2 启动继续加载已保存快照，先显示摘要，再在后台恢复焦点项目。`TRELLIS_VISUAL_CONSOLE_DATA_DIR` 继续作为开发和隔离验证入口。

Windows 卸载器默认保留数据，并提供明确的删除选项。macOS 的“清除本地数据并退出”先关闭监听与写入队列，再删除注册表、快照、备份和日志目录，最后退出；删除目标由后端固定解析，前端不能传入路径。

## 6. 项目发现与只读安全

Core 逐项复刻现有合同：

- 不跟随符号链接，拒绝符号链接项目根、`.trellis` 和必需入口。
- 扫描忽略 `.git`、`node_modules`、构建产物和缓存目录。
- 稳定项目 ID 继续使用真实路径 SHA-256 前 24 位，保证旧注册表可复用。
- YAML/JSON/JSONL 只在输入边界解析一次，错误转为稳定中文诊断。
- Task 父子关系先收集全部活动与归档候选，再按一致性和稳定键解析；不依赖目录遍历顺序。
- 正文路径先拒绝绝对路径与原始 `..`，再验证扩展名、普通文件、符号链接和最终 canonical path 包含关系。
- 历史项目启动时不访问源文件；正文读取仍要求当前进程内显式刷新授权。
- 外部打开只接受已登记项目根或快照允许的项目相对路径，由 Rust 校验后调用系统 API。

Tauri capability 仅绑定主窗口并开启必需能力；不向前端暴露通用文件系统、Shell 或任意路径 Opener 权限，不配置远程 IPC 域名，CSP 禁止非必要远程脚本和资源。

## 7. 实时更新

Core 使用跨平台原生文件事件库监听 `.trellis/spec/`、`.trellis/tasks/`、`.trellis/config.yaml` 与 `.trellis/workflow.md`，不得监听整个仓库或跟随符号链接。

- 单项目事件先转为项目内 POSIX 相对路径，使用 Set 去重并进行 300ms 防抖。
- 一批事件只执行一次完整索引，成功保存快照后发送轻量事件。
- 原生监听启动或运行失败时关闭失败实例，重新校验后切换 10 秒低频轮询。
- 轮询也失败时清除运行时状态并向界面暴露失败，不伪装实时。
- 历史和不可用项目没有活动监听器；取消焦点和应用退出必须释放 watcher 与定时任务。

## 8. 前端迁移

React 组件、样式、任务中心计算和 URL 状态保持原结构。主要修改集中在通信与少量桌面入口：

- `api-client.ts` 替换为 Tauri `invoke` 包装，函数签名尽量保持不变，响应继续经过现有 Zod Schema。
- `useProjectConsole` 用 `listen` 替换 `EventSource`，保留单订阅、150ms 合并和过期响应保护。
- 目录选择与外部打开仍通过统一客户端模块，不让组件直接访问 Tauri API。
- 诊断区增加“打开日志目录”和“清除本地数据并退出”；清理操作要求二次确认并明确删除范围。
- 删除 HTTP 健康检查、断线重连和服务端端口相关文案，替换为桌面后端初始化/事件通道状态。
- 外部 HTTP(S) Markdown 链接继续使用系统浏览器打开；Markdown 原始 HTML 仍不执行。

## 9. 日志与网络

日志写入应用日志目录，单文件上限 2 MiB，最多保留 5 个文件。只记录生命周期、稳定项目 ID、错误类型、恢复数量和监听模式；路径、正文、令牌、命令参数和底层错误原文在进入日志前丢弃。

首版生产运行不包含 HTTP 服务、遥测、崩溃上传和更新检查。Windows 安装器仅在缺少 WebView2 时由官方 bootstrapper 联网；应用核心功能必须在断网环境运行。未来 Web adapter 必须单独规划绑定地址、认证、TLS、CORS、CSRF 和远程路径边界，不能直接把首版本机 Core 暴露到网络。

## 10. 构建与分发

- 应用名：`Trellis Visual Console`。
- Bundle identifier：`com.wanglinqiao.trellis-visual-console`。
- 最低系统：macOS 13+；Windows 10 22H2/Windows 11。
- macOS：分别构建 arm64 DMG 与 x64 DMG，不生成 Universal。
- Windows：保留中文 NSIS 当前用户安装器与 WebView2 bootstrapper 配置；原生产物和验收由独立 Windows 任务完成。
- 首版允许未签名或临时签名内测包，文档必须说明 Gatekeeper/SmartScreen 提示；配置不得阻塞未来正式签名与公证。

图标先生成 1024x1024 主源，再用 Tauri 图标工具生成 `.icns`、`.ico` 与各尺寸 PNG，所有安装包和窗口使用同一品牌资产。

## 11. 性能与验证

窗口创建与注册表读取属于启动关键路径；焦点重索引、Watcher 恢复和迁移快照重建放到后台。历史项目不在正常启动时访问源目录。任务中心继续只投影内存快照，正文按需读取。

性能按 PRD R15/R16 的 28 项目、2 焦点项目 fixture 测量整个应用进程树。当前任务完成 macOS arm64 验证，macOS x64 通过 Rosetta 验证并注明 Intel 实机缺口；Windows x64 指标由独立任务在用户实体机采集。

默认不新增仓库测试文件。高风险路径、迁移、监听和 UI 回归使用仓库外临时 fixture、命令行断言、Playwright 浏览器临时 IPC mock，以及真实 Tauri 应用人工流程验证。

## 12. 回滚与风险控制

- 旧版本 1 数据在迁移前完整备份；回滚 Web 版时只能显式恢复备份，不能让旧程序读取版本 2 文件。
- Core 按存储、项目发现、Catalog、实时分阶段迁移，Tauri adapter 单独迁移系统集成；每阶段使用同一 fixture 与旧 TypeScript 输出对照。
- `trellis-core` 独立执行 `cargo check` 和依赖树检查；一旦出现 Tauri、Axum、Actix、窗口或插件依赖，视为架构回归。
- 在 Command/Event 功能对等与桌面验收完成前保留旧 `src/server` 作为参考；最终一次性删除，避免长期双后端漂移。
- Windows 原生行为不能由 macOS 审查替代；独立 Windows 任务发现阻断问题时回到对应 Rust 模块修复，不通过放宽验收或恢复 Node sidecar 绕过。
- 性能预算只有在记录系统 WebView 固有开销并经用户批准后才能调整。
