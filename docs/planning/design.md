# Trellis Visual Console 当前桌面架构

## 1. 运行形态

Trellis Visual Console 使用 Tauri 2 承载现有 React/Vite 界面。生产应用没有 Node.js、Fastify、本地 HTTP 端口、浏览器入口或 sidecar；前端通过 Tauri Command 查询数据，通过固定 Tauri Event 接收轻量失效通知。

```text
React WebView
  │ invoke / listen
  ▼
Tauri adapter
  │ ApplicationService / EventSink
  ▼
trellis-core
  │ 只读文件访问
  ▼
已登记项目 .trellis/
```

## 2. 分层边界

### React WebView

- `src/web/api-client.ts` 是唯一 Command 调用入口，组件不得直接导入 Tauri API。
- 所有成功响应和结构化错误在 IPC 边界使用 `src/shared/api.ts` 的 Zod Schema 校验。
- `useProjectConsole` 只建立一个 `trellis://project-realtime` 监听，150ms 合并后重新查询。
- IPC 没有网络取消语义；详情提交同时校验项目 ref、请求代次和响应项目 ID。

### Tauri adapter

- `src-tauri/src/commands/` 只做参数反序列化、线程调度和 Core 调用。
- `src-tauri/src/realtime.rs` 将 Core `EventSink` 映射为主窗口事件。
- `src-tauri/src/system/` 负责应用数据路径、原生目录选择、受控 opener、日志和清理。
- single-instance 插件最先注册；主窗口关闭时先关闭 Core，再退出进程。

### trellis-core

- `crates/trellis-core` 不依赖 Tauri、Axum、Actix、窗口或插件类型。
- `application` 组合 Catalog、正文资格、任务中心和实时生命周期。
- `storage` 管理版本 2 注册表/快照、版本 1 迁移、备份和原子写。
- `projects` 管理扫描、校验、索引、Task 关系、正文读取和路径边界。
- `realtime` 管理允许路径 watcher、轮询降级、项目队列、防抖和事件端口。

依赖方向固定为 `src-tauri -> trellis-core`。未来若新增 Web adapter，只能作为新的 Core 消费者，不能让 Core 反向依赖传输层。

## 3. 数据流

### 查询

```text
组件 -> api-client -> invoke -> Tauri Command -> ApplicationService
     -> Catalog / reader -> DTO -> Zod -> React 状态
```

### 实时失效

```text
notify / polling -> RealtimeManager -> 重索引并保存快照
  -> EventSink -> Tauri Event -> 150ms 前端合并 -> 重新查询
```

事件不携带正文、完整快照或绝对路径。HTTP/SSE 不属于首版生产架构。

## 4. 项目与正文安全

- 源项目只读，应用数据与源项目目录完全分离。
- 扫描不跟随符号链接，忽略 `.git`、`node_modules` 和构建缓存。
- 正文读取先校验进程内读取资格，再校验快照/实时白名单，最后校验原始路径、文件类型、符号链接与 canonical 边界。
- 历史项目默认零源读取；显式刷新成功后只在当前进程获得正文资格。
- 受控 opener 只接受项目根或 `.trellis` 内合法相对源路径。

## 5. 存储与迁移

应用数据目录中固定包含：

```text
registry.json
snapshots.json
logs/
```

注册表和快照当前版本为 2。完整读改写由单一互斥锁串行保护；保存使用同目录临时文件、文件同步和原子替换。合法版本 1 数据迁移时先做双文件字节级备份，版本 2 注册表最后提交；旧快照只备份，不作为新运行数据。

## 6. 实时与生命周期

- 只有焦点项目创建 watcher，监听范围固定为 Spec、Task、config 和 workflow。
- 原生 watcher 启动或运行失败时切换 10 秒轮询；轮询失败进入 `stopped`。
- Core 使用 300ms 防抖把一批文件事件合并为一次完整重索引。
- 项目失效时进入 `unavailable`、释放 watcher、保留旧快照。
- 不可用项目修复后显式刷新回到 `history`，不会在没有 watcher 时伪装为焦点。
- 关闭窗口后拒绝新任务、等待项目队列并释放 watcher/线程。

## 7. 系统集成与隐私

- 目录选择使用 Tauri Dialog Rust API，前端没有通用文件系统权限。
- 项目路径与日志目录使用 Rust 侧 Opener API。
- 日志单文件 2 MiB、最多 5 个，只接受受控字段，不记录绝对项目路径、正文、命令参数或底层错误原文。
- 应用不采集遥测、不上传崩溃、不自动更新，运行期不主动联网。
- macOS 清理入口和 Windows 卸载 hook 只允许删除固定应用数据目录。

## 8. 分发

- macOS 13+：分别构建 arm64 与 x64 DMG。
- Windows 10 22H2 / 11：在 x64 原生环境构建当前用户 NSIS，缺少 WebView2 时在线引导。
- 首版内测包可未签名，但交付文档必须说明 Gatekeeper/SmartScreen 提示；正式发布再接入签名与公证。

## 9. 验收门禁

代码门禁包括前端 lint/typecheck/build、Rust fmt/clippy/check、Core 独立依赖树和 `git diff --check`。行为门禁包括 IPC Schema、竞态、事件合并、2000 行任务中心、Markdown 安全、四档响应式、真实目录选择、外部打开、原生监听和隔离数据清理。

Windows x64 原生安装、监听、卸载数据选项与性能结果未通过前，任务保持进行中。
