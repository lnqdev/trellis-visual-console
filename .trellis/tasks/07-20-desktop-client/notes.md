# 桌面客户端执行记录

## 2026/7/20：阶段 0 与阶段 1

### 基线

- 工作分支：`feature/v2.0.0_desktop`。
- Node.js：`v24.12.0`；pnpm：`10.33.0`。
- 旧 Web 基线通过 `pnpm lint`、`pnpm typecheck`、`pnpm build`。
- 旧 Web 产物：JavaScript 约 488 KiB，gzip 后约 146 KiB。
- 当前开发机：Apple Silicon、macOS 26.3.1、16 GiB 内存。

### 工具链

- 安装 Rust stable `1.97.1`、Cargo `1.97.1`、rustfmt 与 clippy。
- 安装 `aarch64-apple-darwin` 和 `x86_64-apple-darwin` target。
- 当前只有 Xcode Command Line Tools，没有完整 Xcode；Core 编译、桌面二进制和 `.app` bundle 可验证，DMG 打包仍需补齐完整 Xcode 后复核。

### 已完成

- 建立根 Cargo workspace、独立 `trellis-core` crate 和 `src-tauri` 桌面适配层。
- Core 正常依赖树为空，不包含 Tauri、Axum、Actix、窗口或插件类型。
- 配置应用名称、bundle identifier、macOS 13 最低版本、当前用户 NSIS 和 WebView2 在线引导。
- 单实例插件最先注册；第二次启动实测只有一个桌面进程。
- 生成 Trellis 风格 1024×1024 图标源、`.icns`、`.ico` 和各平台尺寸 PNG。
- `Trellis Visual Console.app` 已构建并通过桌面窗口检查，现有 React 页面可见。
- 桌面 Command/Event 尚未迁移完成前，WebView 明确进入“桌面后端尚未初始化”状态，不回退请求旧 HTTP/SSE。

### 已通过门禁

```text
pnpm lint
pnpm typecheck
pnpm build:web
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo check --workspace --all-targets --all-features
pnpm tauri build --debug --no-bundle
pnpm tauri build --debug --bundles app
git diff --check
```

### 下一步

- 已建立版本 2 Serde 存储模型、语义校验与跨平台原子 JSON 文件层。
- 仓库外 fixture 已验证首次创建、往返保存、损坏隔离、未来版本保护和非法数据写入前拒绝。
- 下一步迁移 Serde IPC 合同与稳定中文错误合同。
- 下一步实现版本 1 数据双文件备份迁移与幂等中断恢复。
- 使用仓库外临时 fixture 验证损坏、未来版本、中断恢复与源项目零写入。

## 2026/7/21：阶段 2 存储迁移与 IPC 合同

### 已完成

- 新增 `ApplicationStorage`，应用数据目录由桌面适配层注入，Core 不解析 Tauri 路径。
- 实现版本 1 注册表严格校验、注册表与快照字节级备份、空版本 2 快照写入，以及版本 2 注册表最终提交。
- 迁移结果保留原项目 ID、路径、名称、状态和时间字段，并返回待后台重建的项目 ID。
- 旧快照不参与迁移后运行数据，即使内容损坏也先按原字节备份。
- 实现传输无关的 Command/Event Serde DTO，并直接复用 Core 存储模型。
- 实现稳定 `CommandError`，存储错误转换时不暴露绝对路径和底层 I/O 原文。

### 仓库外验证

- 空目录首次初始化生成两个版本 2 文件。
- 合法版本 1 数据迁移成功，两个备份与原字节一致，源项目标记文件不变。
- 使用“版本 1 注册表 + 已写版本 2 空快照”模拟中断，重启后可幂等完成迁移。
- 非法版本 1、未来版本和孤立快照场景均停止初始化并保留原字节。
- Rust DTO 真实序列化结果通过现有 TypeScript Zod Schema 与实时事件守卫。

### 下一步

- 将 `ApplicationStorage` 接入 Core 应用服务与 Tauri 初始化状态。
- 迁移项目路径、发现、索引和正文读取能力。

## 2026/7/21：阶段 3 项目发现第一批

### 已完成

- 迁移真实路径稳定 ID、项目相对路径规范化、严格 UTF-8 读取和受控 realpath 解析。
- 路径解析按“原始绝对路径与 `..` 拒绝 → 边界检查 → 逐段符号链接检查 → canonical 边界检查”执行。
- 迁移项目根目录、`.trellis`、`config.yaml`、`spec` 和 `tasks` 的结构校验。
- 迁移递归项目扫描、忽略目录、符号链接跳过与稳定中文文件系统诊断。

### 仓库外验证

- 直属与嵌套 Trellis 项目均可发现，`node_modules` 内项目不会成为候选。
- 项目根符号链接和 `.trellis` 符号链接均被拒绝。
- 绝对路径、Windows 绝对路径、原始 `..` 和文件符号链接均无法绕过读取边界。
- 扫描前后模拟源项目文件字节保持一致。

### 下一步

- 迁移 YAML 配置、Spec 树、Task/Workflow 索引与父子关系解析。
- 迁移 Markdown/JSONL 正文读取和快照白名单检查。

## 2026/7/21：阶段 3 项目发现、索引与正文读取完成

### 已完成

- 使用 `serde_yaml` 迁移 `config.yaml` 包配置解析，未知字段保持宽容。
- 迁移 Spec Markdown 树、活动与归档 Task、Workflow 摘要和稳定中文诊断。
- 完整迁移 Task 父子候选收集、双向一致优先、跨活动/归档解析、稳定冲突隔离、循环拒绝和父任务原始子项顺序保留。
- 迁移 Markdown、Task 详情和 Markdown/JSONL 文档读取，复用原始绝对路径、`..`、符号链接和 canonical path 边界校验。
- Task 详情只接受快照中的 Task，Task 文档只接受实时清单中的普通文件，并保持 `prd.md`、`design.md`、`implement.md` 优先排序。

### 仓库外验证

- 同一混合 fixture 下，Rust 与旧 TypeScript 的包、Spec、Task、Workflow、关系和诊断规范化输出完全一致。
- reader 双实现对照覆盖合法 Markdown、原始 `..`、绝对路径、非 Markdown、快照外 Task、清单外文档、Task 文档符号链接和规划文档排序，结果完全一致。
- 当前项目真实索引结果为 1 个活动任务、11 个归档任务、0 条诊断，Rust 与 TypeScript 输出一致。
- Trellis 主仓库真实索引结果为 11 个活动任务、215 个归档任务、31 条既有诊断；旧坏任务未阻塞索引，Rust 与 TypeScript 输出一致。
- `cargo clippy -p trellis-core --all-targets --all-features -- -D warnings` 通过。

### 下一步

- 进入阶段 4，迁移 Catalog、Core 应用服务与 Tauri Command 适配。
- 在进入阶段 4 前执行阶段 3 全量质量门禁。

## 2026/7/21：阶段 4 Catalog、应用服务与 Tauri Command

### 已完成

- 新增 Core `ProjectCatalog`，用单一互斥锁串行保护跨注册表与快照的完整读改写。
- 迁移扫描、单项/批量登记、重复路径更新、列表与快照配对、刷新、不可用状态和焦点/历史状态持久化。
- 保持登记与刷新时快照先保存、注册表后保存；项目不可用时只更新注册表并原样保留旧快照。
- 新增传输无关 `ApplicationService`，迁移项目列表、任务中心、项目详情、正文临时授权、Spec/Task 白名单读取和稳定 Command 错误映射。
- 任务中心只读取一次 Catalog 数据，排除不可用项目旧任务，并通过已解析 `parentSourcePath` 投影父标题。
- 历史项目显式刷新后获得当前进程内正文授权；移出焦点、刷新失败或进程重启后清除。
- Tauri 接入 10 个异步 Command，所有同步文件系统业务通过线程池执行，不阻塞窗口线程。
- adapter 负责解析应用数据目录；Core 仍不依赖 Tauri、HTTP、窗口或插件类型。
- 存储初始化失败保存在 `AppState` 并由 Command 返回稳定错误，窗口不会因底层存储错误直接崩溃。
- v2 启动时会识别注册表中缺失快照的项目并后台重建，迁移提交后提前退出也能在下次启动继续恢复。

### 仓库外验证

- 应用服务真实 fixture 覆盖扫描不落盘、首次/重复/无效登记、项目列表、任务中心和项目详情。
- 覆盖历史正文拒绝、显式刷新授权、Spec/Task 正文、焦点进出和授权清除。
- 覆盖项目不可用后保留旧快照、任务中心排除旧任务，以及缺失 v2 快照重启后继续重建。
- 所有真实 Rust 响应和 `CommandError` 均通过现有 `src/shared/api.ts` Zod Schema。
- `cargo clippy --workspace --all-targets --all-features -- -D warnings` 通过。
- `cargo check --workspace --target x86_64-apple-darwin` 通过。
- `pnpm tauri build --debug --no-bundle` 成功生成真实桌面二进制。
- `trellis-core` 依赖树不包含 Tauri、Axum、Actix、窗口或插件依赖。

### 下一步

- 进入阶段 5，迁移受限文件监听、300ms 防抖、10 秒轮询降级、项目级队列和 Core `EventSink`。
- Tauri adapter 将 Core 轻量事件映射为 `trellis://project-realtime`；前端 `listen` 迁移仍在阶段 7 统一完成。

## 2026/7/21：阶段 5 实时监听与事件

### 已完成

- Core 新增 `EventSink` 端口和集中事件发布器，事件只包含 ID、项目 ID、资源、失效范围、时间和监听模式。
- 使用 `notify 8.2.0` 的 `RecommendedWatcher` 与 `PollWatcher` 实现跨平台原生监听和 10 秒轮询降级。
- watcher 仅消费 Spec、Task、config 和 workflow 允许路径；Spec/Task 递归，固定文件非递归，不跟随或读取符号链接内容。
- 可选 `workflow.md` 缺失时使用 `.trellis` 非递归哨兵捕获创建事件，进入管理器后仍按允许路径过滤。
- 新增中央事件线程、项目级操作锁、路径去重和 300ms 防抖；一批事件只执行一次完整重索引。
- 保持聚焦顺序“刷新并保存快照 → 启动 native/polling → 保存 focus”，取消聚焦顺序“保存 history → 清理并关闭 watcher”。
- 原生启动失败降级 polling；原生运行失败先重新校验再切换 polling；polling 失败清理运行时并发布 `stopped` 失效事件。
- 项目删除或结构失效进入 `unavailable`、释放 watcher、保留旧快照；修复后显式刷新回到 `history`，不会自动创建 watcher。
- ApplicationService 列表与详情投影真实运行时状态，启动时后台恢复持久化焦点项目，关闭时拒绝新生命周期操作并释放线程与 watcher。
- Tauri `EventSink` 只向主窗口发布 `trellis://project-realtime`；关闭窗口时先等待 Core 清理完成再退出进程。
- 工作线程创建失败会阻止 Core 初始化，不会留下“watcher 已启动但事件无人处理”的假状态。
- 索引器补充 workflow 普通文件检查，符号链接 workflow 只降级为稳定读取诊断，不读取链接目标。

### 仓库外验证

- 受控 watcher 状态机验证快速 Spec/Task 事件合并为一次重索引，越界事件被忽略，取消焦点后迟到事件被丢弃。
- 验证 native 启动失败进入 polling 且 `realtime=false`，polling 运行失败进入 `stopped`，双模式启动失败不写入 `focus`。
- 验证项目失效、修复刷新、重新聚焦、关闭清理和重启只恢复持久化焦点集合。
- 12 条真实 Rust 事件全部通过 `src/shared/project-events.ts` 事件守卫。
- macOS 真实 `notify` 原生 watcher 在 5 秒门限内观察到 Spec 保存，并发布 `spec-changed` 与 `project-reindexed`。
- 应用服务完整 fixture 与现有 Zod Schema 继续通过。
- 当前项目和 Trellis 主仓库的 Rust/TypeScript 索引规范化结果继续完全一致。

### 下一步

- 进入阶段 6，迁移原生目录选择、受控外部打开、本地日志和应用数据清理生命周期。
- 阶段 7 再统一把前端 HTTP/SSE 客户端切换为 Tauri invoke/listen，当前界面继续保留明确的桌面后端占位状态。

## 2026/7/21：阶段 6 系统集成、日志与数据清理

### 已完成

- 使用 Tauri Dialog Rust API 实现 macOS/Windows 原生目录选择，取消返回正常结果，并用原子标记拒绝并发对话框。
- 使用 Tauri Opener Rust API 实现受控项目路径和日志目录打开；插件只由 Rust adapter 调用，前端 capability 未获得通用路径权限。
- Core 新增项目打开路径解析，项目根必须是普通真实目录，源路径必须位于 `.trellis` 且通过原始绝对路径、`..`、符号链接和 canonical 边界检查。
- 应用数据目录继续兼容旧版：macOS 使用 `~/Library/Application Support/Trellis Visual Console`，Windows 使用 `%APPDATA%\Trellis Visual Console`。
- `TRELLIS_VISUAL_CONSOLE_DATA_DIR` 相对路径按当前工作目录解析为绝对路径；Windows `APPDATA` 缺失时回退 `%USERPROFILE%\AppData\Roaming`。
- 新增受控 JSONL 日志轮转器：每个文件最多 2 MiB、总数最多 5 个；日志 API 只接受生命周期枚举、稳定项目 ID、事件类型、监听模式和错误类型。
- 实时事件写入日志时不包含项目路径、正文、命令参数或底层错误原文。
- 新增 `open_log_directory` 和 `clear_application_data_and_exit` Command；清理必须明确确认，先拒绝新任务并关闭 Core，再只删除固定应用数据目录并退出。
- 即使 Core 因损坏或未来版本数据初始化失败，清理 Command 仍可删除固定应用数据目录进行恢复。
- Windows NSIS 卸载 hook 增加本地数据删除询问，默认按钮为“否”，删除目标固定为 `%APPDATA%\Trellis Visual Console`。

### 仓库外验证

- Core 打开路径验证合法项目根和 Spec 文件可解析，绝对路径、原始 `..` 和 `.trellis` 外路径均返回 `unsafe-project-path`。
- 日志压力 probe 写入 150000 条受控错误记录，最终文件数为 5，最大文件 2097056 字节，未超过 2 MiB。
- 隔离开发进程真实日志只包含 `desktop-starting`、`desktop-ready` 等受控字段，不含绝对项目路径或正文。
- 应用服务完整 fixture 和现有 Zod Schema 继续通过。

### 下一步

- 进入阶段 7，把集中式前端客户端从 HTTP 切换到 Tauri invoke，并把 EventSource 切换为单一 `listen`。
- 增加日志入口和清除数据二次确认 UI，随后用 Playwright 临时 IPC mock 和真实 Tauri 应用验证完整流程。

## 2026/7/21：阶段 7 前端通信迁移（代码完成，验收待继续）

### 已完成

- `api-client.ts` 已从 HTTP 请求整体切换为集中式 Tauri `invoke`，组件仍不直接依赖 Tauri API。
- 全部成功响应继续使用现有 Zod Schema；Command 错误先按 `unknown` 接收，再使用统一错误 Schema 转为稳定客户端错误。
- 不保留生产 HTTP 回退；非 Tauri 环境明确返回 `desktop-runtime-unavailable`。
- 保留现有函数签名中的 `AbortSignal`，调用前后识别主动取消；IPC 无法原生取消的旧响应继续由详情代次、项目 ref 和响应项目 ID 拦截。
- `useProjectConsole` 已用单一 `listen("trellis://project-realtime")` 替换 EventSource，事件 payload 继续经过共享守卫。
- 保留 150ms 尾随批量、项目列表/任务中心单次失效刷新和当前项目详情刷新；Effect 清理会释放 Tauri 订阅。
- 诊断页增加打开日志目录与清除本地数据并退出入口；清理前明确展示删除范围并要求用户确认。
- 前端 `pnpm lint`、`pnpm typecheck`、`pnpm build:web` 通过；Rust fmt、workspace Clippy 与 `git diff --check` 通过。

### 待继续验收

- 使用仓库外 Playwright IPC mock 覆盖 Command 成功/错误 Schema、延迟响应竞态、单订阅和 150ms 事件合并。
- 验证 375/768/1024/1440 布局、2000 行任务中心、Markdown 安全和新增诊断操作区。
- 使用真实 Tauri 应用完成扫描、登记、焦点、正文、原生事件、目录选择、外部打开和日志入口流程。
- 验收通过后再进入阶段 8 删除 Node/Fastify 生产后端，避免失去行为对照。

## 2026/7/21：阶段 7 前端通信迁移验收

### Playwright IPC mock

- Command 合法成功响应、非法成功响应和结构化 Command 错误分别通过 Zod 边界验证；非法响应稳定转换为 `invalid-command-response`。
- 模拟项目 A 延迟 450ms、切换项目 B 立即返回，最终详情保持项目 B，旧响应未覆盖当前选择。
- 开发模式 React 严格模式会执行一次订阅清理复查，但任意时刻只有一个活动 `trellis://project-realtime` 监听器。
- 三条连续事件在 100ms 内不刷新，150ms 窗口结束后只触发一次项目列表、当前详情和任务中心刷新。
- 2000 条任务响应首次只挂载 100 行，约 383ms 可用；“加载更多”后稳定增至 200 行。
- 375、768、1024、1440 四档视口均无页面横向滚动或越界元素。
- Markdown 中脚本未执行、DOM 未生成 `script`，`javascript:` 链接被清空，HTTPS 链接保留 `_blank` 与 `noreferrer`，GFM 表格正常渲染。
- 诊断页日志入口调用 `open_log_directory`；清理取消时不调用 Command，确认时只发送 `{ confirmed: true }`。

### 真实 Tauri debug app

- 使用 `/tmp/trellis-desktop-dev-data` 隔离数据目录构建并运行 debug `.app`，未读取或删除正式应用数据。
- 完成真实项目扫描、候选登记、历史项目显式刷新、Spec/Task 正文读取和焦点切换；焦点项目运行时显示原生实时监听。
- macOS 系统目录选择器能够打开，取消后正常回到应用；受控项目目录和隔离日志目录均可由系统外部应用打开。
- 清理命令的破坏性实测继续留在隔离数据目录，正式数据不参与验收。

### 验收修正

- 移除侧栏 `127.0.0.1` 与“重连中”残留语义；Tauri 订阅失败明确展示“实时通道不可用”。
- 项目发现说明改为桌面客户端语义，并同步事件合同注释和通道状态 CSS。

### 下一步

- 确认本次 `notes.md` 写入通过真实原生事件自动刷新当前正文后，阶段 7 验收完成。
- 进入阶段 8，删除 Node/Fastify 生产后端与旧依赖，并同步 README、架构文档和 `.trellis/spec`。

## 2026/7/21：阶段 8 Node 生产后端清理与文档同步

### 已完成

- 删除全部 `src/server/` 生产代码、`src/shared/health.ts` 和 `tsconfig.server.json`。
- 删除 `dev:server`、`build:server`、`start` 等旧服务脚本；`pnpm dev` 和 `pnpm build` 现在分别进入 Tauri 开发与桌面构建。
- 删除 Fastify、静态插件、Chokidar、`open`、`yaml`、`tsx`、`concurrently` 和 `cross-env` 直接依赖。
- Vite 不再代理 `/api`；ESLint 与 TypeScript 配置不再包含 Node 服务目录。
- 更新主 README 和当前架构文档，新增 macOS 桌面验收记录；迁移前规划和阶段六报告保留并标记为历史基线。
- `.trellis/spec` 已从 Node/HTTP/SSE 合同更新为 Rust Core、Tauri Command/Event、版本 2 存储、桌面生命周期、日志隐私与分发合同。
- 旧 `local-service-contract.md` 和 `readonly-api-contract.md` 已删除，分别由 `desktop-runtime-contract.md` 和 `desktop-command-contract.md` 取代。

### 验证

- `pnpm install --frozen-lockfile` 通过。
- `pnpm lint`、`pnpm typecheck`、`pnpm build:web` 通过。
- `cargo fmt --all -- --check` 通过。
- `cargo clippy --workspace --all-targets --all-features -- -D warnings` 通过。
- `cargo check --workspace --all-targets --all-features` 通过。
- `pnpm tauri build --debug --bundles app` 通过，清理后的真实 `.app` 可启动。
- 新 bundle 进程树只有 `trellis-visual-console`，应用进程没有 TCP 监听；不存在 Node/Fastify sidecar 或本地 HTTP 服务。
- `cargo tree -p trellis-core --edges normal` 不包含 Tauri、Axum、Actix、窗口或插件依赖。
- `git diff --check` 通过。

### 说明

- `pnpm-lock.yaml` 中的 `tsx`/`yaml` 是 Vite 自身的可选传递依赖，不是项目直接依赖，也不进入桌面应用运行进程。
- 当前 debug `.app` 为 40 MiB，包含未优化符号，不能作为 30 MiB release 安装包预算结论。

### 下一步

- 进入阶段 9，构建 macOS arm64/x64 release DMG，完成安装、覆盖安装、单实例、清理、断网和性能验收。
- macOS x64 在 Rosetta 下完成核心流程并明确保留 Intel 实机性能缺口。
- 当时规划将 Windows x64 原生 NSIS 验收作为任务完成前置条件；该范围已于 2026/7/21 拆分到独立任务。

## 2026/7/21：阶段 9 macOS release 构建与性能验收

### 构建与安装

- 使用 `CI=true` 分别构建 arm64 与 x64 release DMG；自动化环境因此跳过无 Apple Events 权限的 Finder 图标定位脚本。
- arm64 DMG 为 3,752,851 字节，SHA-256 为 `e994e8b1425f6b22b1dcfa2144acad4f361b09dc9188a1edf44f36193f4871a5`。
- x64 DMG 为 3,840,161 字节，SHA-256 为 `301baa61f45bcc88e7fd8be45f9683ddf3bc6b425c998c2fa7e275801a6df4c4`。
- 两个镜像均通过 `hdiutil verify`，内部二进制架构与文件名一致，单包远低于 30 MiB 预算。
- arm64 `.app` 已安装到 `~/Applications/Trellis Visual Console.app`；首次安装和同版本覆盖后都能使用隔离数据启动、恢复焦点和原生监听。
- x64 `.app` 在 Apple Silicon + Rosetta 下启动，任务列表和文档核心流程通过；Intel 实机与 Intel 性能未验证。
- 当前内测包未接入 Developer ID 签名/公证，README 已补充 Gatekeeper 安全打开说明。

### 性能

- 新增 Tauri `PageLoadEvent::Finished` 受控生命周期日志 `desktop-page-loaded`，不增加 IPC、权限或业务行为。
- arm64 release 从 `desktop-starting` 到 `desktop-page-loaded` 为 723ms，覆盖安装后为 527ms；Core ready 为 6ms。
- 稳定 RSS 为 31 MiB。
- 30 个、每 10 秒一次的空闲样本：平均 CPU 0.000%，峰值 0.000%。
- `desktop-closing` 到 `desktop-closed` 为 2ms，进程随后正常退出。
- release 应用没有子进程或 TCP 监听。

### 未完成项

- 干净用户环境的真实 quarantine/Gatekeeper 提示未复现；当前仅完成未签名内测说明。
- arm64 release 二次启动约 20ms 内退出，进程数保持 1，`desktop-starting` 计数不增加；单实例通过。
- release 运行期无 TCP/UDP 连接或监听；主动断开系统网络的离线验收按用户要求后置，本轮未改变系统网络状态。
- 当时规划将 Windows x64 原生构建与实机验收作为任务完成前置条件；该范围已于 2026/7/21 拆分到独立任务。

### 真实清理退出验收

- 2026/7/21 14:03 CST，在用户级 arm64 release 应用中从“诊断”执行“清除本地数据并退出”，永久删除范围由用户在操作时明确确认为隔离目录 `/tmp/trellis-desktop-dev-data`。
- 清理前应用进程 PID 为 `75203`，隔离数据目录及其中的 `registry.json` 均存在；源任务目录 `.trellis/tasks/07-20-desktop-client` 存在。
- 清理后 PID `75203` 消失，启动会话以退出码 0 正常结束，隔离数据目录及 `registry.json` 均不存在。
- 清理前后 `git status --porcelain=v1 | shasum -a 256` 均为 `358149db758a55eb13bb569f66219c1d8117b4d90843b1e32ae9291e78901510`，源任务目录仍存在，证明清理未修改或删除已登记 Trellis 项目。
- macOS “清除本地数据并退出”的真实应用退出、固定数据目录删除和源项目保护通过；离线验收按用户要求后置。

## 2026/7/21：Windows 交付范围拆分

- 用户决定先完成并使用 macOS 版本，Windows 机器当前不在手边。
- Windows x64 原生构建、NSIS 安装器、WebView2、中文/UNC 路径、原生监听、离线、性能和卸载验收已拆分到独立任务 `.trellis/tasks/07-21-desktop-client-windows-x64`。
- 新任务已补齐 `prd.md`、`design.md` 和 `implement.md`，状态保持 `planning`；取得 Windows x64 实体机并经用户审阅后再启动。
- 当前任务保留共享 Tauri/Rust 实现及 Windows 构建配置，完成门禁收敛为共享桌面迁移与 macOS arm64/x64 交付。

## 2026/7/21：macOS 正式安装交付

- 再次校验 arm64 DMG，SHA-256 为 `e994e8b1425f6b22b1dcfa2144acad4f361b09dc9188a1edf44f36193f4871a5`，`hdiutil verify` 通过。
- 从该 DMG 覆盖安装到 `~/Applications/Trellis Visual Console.app`；安装后二进制为纯 arm64，bundle identifier 为 `com.wanglinqiao.trellis-visual-console`，版本为 `0.1.0`。
- 未设置 `TRELLIS_VISUAL_CONSOLE_DATA_DIR`，应用使用正常的 `~/Library/Application Support/Trellis Visual Console` 数据目录启动；隔离目录 `/tmp/trellis-desktop-dev-data` 保持不存在。
- 首次正式启动恢复 5 个已登记项目和 4 个焦点项目，焦点项目均进入原生实时监听，主界面与项目概览可操作。
- 当前内测包仍为未签名/ad-hoc 形态，严格代码签名校验不通过属于已记录的分发缺口；本机可直接启动使用，正式公开分发仍需 Developer ID 签名与公证。

## 2026/7/21：旧代码与打包入口清理

- 再次审计生产源码、脚本和直接依赖，确认旧 `src/server/`、健康接口、Fastify、Chokidar、Node opener、服务端 TypeScript 配置和 HTTP/SSE 启动入口均已删除。
- 删除忽略目录中残留的 `dist/server/`、`dist/shared/`、`tsconfig.server.tsbuildinfo` 及其他 TypeScript 增量缓存，只保留当前 `dist/web/` 前端构建产物。
- 删除无引用且与当前 Rust Core 架构冲突的旧 `docs/planning/session-handoff.md`；明确标记为迁移前历史基线的 PRD、实施记录和阶段六报告继续保留。
- `package.json` 新增 `build:mac:arm64`、`build:mac:x64` 和 `build:windows:x64`，分别固定 DMG/NSIS 类型与目标架构。
- `README.md` 和 `README_CN.md` 已写入依赖安装、Rust target、按平台打包命令、CI 模式和产物目录；Windows 命令明确限定在 Windows x64 原生环境执行。
- 使用 `CI=true pnpm build:mac:arm64` 和 `CI=true pnpm build:mac:x64` 完成真实复验，两个命令均成功生成 DMG，且均通过 `hdiutil verify`。
- 本次 arm64 DMG 为 3,752,851 字节，SHA-256 为 `e4645940e1cda0c7360a1996cd2a42333871fb4b7dec9daf17beca97426ef3e5`；x64 DMG 为 3,840,156 字节，SHA-256 为 `57d4e0269f476fb6cfef9e1a629a06fd877ba55a56ed7442955794c4273eddc0`。
- DMG 包含文件系统布局时间等构建元数据，每次重建的 SHA-256 不保证一致；交付时必须以实际交付文件重新计算并记录摘要。
