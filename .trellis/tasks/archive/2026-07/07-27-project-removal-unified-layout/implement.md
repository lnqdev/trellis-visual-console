# 项目移除与 macOS 一体化窗口实施计划

## 1. 合同与 Core 存储

- [x] 在 `crates/trellis-core/src/contracts/mod.rs` 增加严格的 `ProjectRemoveResponse`。
- [x] 在 `ProjectCatalog` 增加串行项目移除：校验项目、保存过滤后的注册表与快照、处理失败补偿、清理迁移待重建 ID。
- [x] 在 `ProjectRealtimeManager` 增加项目级锁保护的移除流程，移除成功后释放活动 watcher 并让迟到事件失效。
- [x] 在 `ApplicationService` 增加 `remove_project`，清理正文读取授权并返回稳定响应；沿用现有错误映射。

## 2. Tauri 与共享 IPC

- [x] 在 `src-tauri/src/commands/mod.rs` 增加薄 `remove_project` Command，并在 `src-tauri/src/lib.rs` 注册。
- [x] 在 `src/shared/api.ts` 增加严格 Zod Schema 与 TypeScript 类型。
- [x] 在 `src/web/api-client.ts` 增加集中 `removeProject(projectId)` 调用，不让组件直接调用 `invoke`。
- [x] 使用 `rg` 核对 Command 名、请求字段和响应字段在 Rust、Tauri、Zod、客户端四层完全一致。

## 3. Hook 与侧边栏交互

- [x] 在 `useProjectConsole` 增加带确认的移除动作；当前项目在调用前失效选择和旧详情代次。
- [x] 移除完成或失败后重新读取项目列表；成功时刷新任务中心代次并展示中文成功提示。
- [x] 向 `ProjectSidebar` 传入忙碌状态和 `onRemoveProject`，所有状态分组复用同一入口。
- [x] 把项目选择按钮与垃圾桶按钮改为同级结构，补齐图标按钮的 `aria-label`、`title`、禁用态、悬停态和键盘聚焦态。
- [x] 调整侧边栏 CSS，确保长项目名、状态时间、诊断数量与固定尺寸移除按钮不重叠。

## 4. macOS 一体化窗口

- [x] 在 Tauri 主窗口配置中设置 `titleBarStyle: "Overlay"`、`hiddenTitle: true`，保留原生 decorations。
- [x] 在 `App` 中仅对 Tauri macOS 增加布局修饰类和专用 `data-tauri-drag-region`。
- [x] 在 `styles.css` 增加 macOS 顶部安全区域、拖动区域和响应式规则；Windows与普通浏览器保持现有布局。
- [x] 在真实 macOS Tauri 窗口验证红黄绿按钮、拖动、双击拖动区、全屏/还原和最小尺寸布局。

## 5. 规范同步

- [x] 更新后端本机存储合同：单项目移除、注册表权威、快照清理和源项目只读边界。
- [x] 更新桌面 Command 合同：`remove_project` 请求/响应及错误语义。
- [x] 更新实时合同：移除焦点项目时的项目锁、watcher 释放和迟到事件处理。
- [x] 更新前端只读控制台/状态或 Hook 合同：确认、当前选择失效、任务中心刷新和最后项目空状态。
- [x] 更新桌面运行合同：macOS 覆盖式标题栏、原生窗口按钮、拖动区和 Windows 保持原样。

## 6. 验证门禁

按顺序执行：

```bash
cargo fmt --check
cargo check --workspace --all-targets --all-features
pnpm lint
pnpm typecheck
pnpm build:web
git diff --check
```

使用 `mktemp -d` 创建隔离应用数据目录和临时 Trellis 项目，不修改仓库或用户真实项目：

- [x] 登记焦点、历史和不可用项目，分别确认侧边栏均可移除。
- [x] 取消确认，断言注册表、快照、watcher 数量和界面选择不变。
- [x] 移除焦点项目，断言 watcher 释放、注册表和快照均无该 ID、源项目字节不变。
- [x] 移除当前项目，断言直接选择剩余第一项且迟到详情不能覆盖；移除最后项目后进入添加项目界面。
- [x] 重新添加同一路径，断言正常登记为历史项目并生成新快照。
- [x] 使用真实 Tauri macOS 窗口在 1280x800 和 800x600 截图检查顶部深色连续、标题隐藏、红黄绿按钮无重叠。
- [x] 实测拖动、双击拖动区、关闭、最小化、最大化/还原；检查 Windows 配置未引入自定义标题栏或新 capability。

## 7. 风险点与回滚点

- `ProjectCatalog` 两个 JSON 文件的保存顺序和失败补偿是最高风险点；任何失败路径不得留下可见的“项目存在但快照被删”状态。
- `ProjectRealtimeManager` 必须持有项目锁完成持久化与运行时移除，不能让 watcher 批次在删除后重新写回快照。
- Hook 必须在移除当前项目时先失效详情代次，不能只依赖最终列表刷新。
- macOS 顶部尺寸以真实 Tauri 窗口为准；如 Overlay 存在平台遮挡，优先调整安全边距和拖动区，不改为跨平台 `decorations: false`。
- 回滚窗口外观时仅撤销 Overlay、隐藏标题和 macOS 专属布局；不得回退或恢复用户已经确认移除的应用内项目数据。
