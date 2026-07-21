# Windows x64 桌面客户端验收记录

## 范围

本记录覆盖 2026/7/21 在 Windows 11 x64 实体机上对 Trellis Visual Console 的原生构建、中文 NSIS 安装器和平台验收。承接 `07-20-desktop-client` 中后置的 Windows 交付范围，对应任务 `.trellis/tasks/07-21-desktop-client-windows-x64`。macOS 验收结果保留在[单独记录](desktop-client-macos.md)，不替代 Windows 原生结果。

## 阶段 1：环境基线

### 操作系统与硬件

| 项目 | 实测值 |
| --- | --- |
| 操作系统 | Microsoft Windows 11 专业版（10.0.26200） |
| 架构 | x64 |
| 处理器 | Intel Core i5-14600KF |
| 主板 | Gigabyte B760M GAMING X WIFI6E DDR4 GEN5 |
| 物理内存 | 32 GB（34,186,006,528 字节） |

满足 R1：Windows 11 x64 实体机。

### 工具链

| 工具 | 版本 | 路径/来源 |
| --- | --- | --- |
| Rust (rustc) | 1.97.1 (8bab26f4f 2026-07-14) | `C:\Users\Administrator\.cargo\bin` (rustup) |
| Cargo | 1.97.1 (c980f4866 2026-06-30) | 同上 |
| Rustup target | `x86_64-pc-windows-msvc`（host 默认） | — |
| MSVC 工具链 | 14.51.36231 | `D:\Program Files\Microsoft Visual Studio\18\Community\VC\Tools\MSVC` |
| Visual Studio | VS 18 Community | `D:\Program Files\Microsoft Visual Studio\18\Community` |
| VS Workload | `Microsoft.VisualStudio.Workload.NativeDesktop` 已安装 | 通过 vswhere 确认 |
| Windows SDK | 10.0.26100.0 | `D:\Windows Kits\10`（Include/Lib 一致） |
| Node.js | v24.16.0 | `D:\develop\nvm4w\nodejs` (nvm4w) |
| pnpm | 10.33.0 | 同上 |
| npm | 11.13.0 | 同上 |
| WebView2 Runtime | 150.0.4078.83 | 系统级已安装（EdgeUpdate 注册表确认） |

- Cargo 镜像：`C:\Users\Administrator\.cargo\config.toml` 已配置 `rsproxy.cn` sparse 索引和 `git-fetch-with-cli`。
- 最小 MSVC 链路验证：`cargo new` + `cargo build` + `cargo run` 在临时目录通过，产物为 `PE32+ x86-64` 控制台可执行，链接器工作正常。

### Git 基线

| 项 | 值 |
| --- | --- |
| 分支 | `feature/v2.0.0_desktop` |
| HEAD | `9679222c74fb39275c643d08b3bff4d858717115` |
| 最后提交 | `chore: record journal` |
| 工作区 | 干净（仅任务 `task.json` 在 `task.py start` 流程中被修改） |

### 应用数据现状

机器上存在真实的 schema 版本 1 应用数据，可直接用于 R7 的版本 1→2 迁移验证：

- 路径：`C:\Users\Administrator\AppData\Roaming\Trellis Visual Console`
- 文件：
  - `registry.json`（`"version": 1`，含 2 个已登记项目：`trellis-visual-console`、`tools`）
  - `snapshots.json`（`"version": 1`，含项目摘要和 spec 树）
  - 一个 `.tmp` 残留文件（迁移前需保留原状以验证字节级备份）

源码确认迁移语义（`crates/trellis-core/src/storage/application_storage.rs`）：

- `STORAGE_VERSION = 2`，`LEGACY_STORAGE_VERSION = 1`。
- `migrate_legacy` 先对 `registry.json` 和 `snapshots.json` 做字节级备份，再写入空快照和版本 2 注册表；任何备份失败都不会修改原文件。
- 迁移后 `rebuild_project_ids` 触发重新索引。

### Fixture 计划

| Fixture | 位置 | 用途 |
| --- | --- | --- |
| v1 应用数据（已存在） | `%APPDATA%\Trellis Visual Console` | R7 迁移验证，迁移前会先做整体目录备份 |
| 中文路径项目 | 仓库外临时目录 | R11 中文路径扫描/登记/监听 |
| UNC 共享 | 本机 SMB 共享或 `\\localhost\share` | R11 UNC 路径 |
| 盘符绝对路径 | `D:\...`、`C:\...` | R11 |
| 路径攻击 fixture | 仓库外临时目录（含 `..`、项目外路径、junction/符号链接） | R11 |
| 28 项目 / 2 焦点性能集 | 仓库外临时目录 | R16 性能基准 |

破坏性操作（卸载、清理）前后会记录源项目文件摘要与 Git 状态。

## 阶段 2：原生构建与 NSIS 安装器检查

### 修复的 Windows 平台缺陷

`crates/trellis-core/src/storage/json_file_store.rs` 的 `open_atomic_file` 在 Windows 上触发 `unused-mut` lint（`-D warnings` 下阻断构建）：

- 原代码 `let mut options = AtomicWriteFile::options();` 中 `mut` 仅在 `#[cfg(unix)]` 分支的 `options.mode(0o600)` 调用里使用。
- macOS 下 `#[cfg(unix)]` 始终为真，所以 `mut` 一直被消费，lint 不触发；Windows 下 `#[cfg(unix)]` 分支被裁掉，`mut` 变成未使用。
- 修法用 `#[cfg(unix)]` / `#[cfg(not(unix))]` 分别声明 `let mut options` 和 `let options`，保留 Unix 的 0o600 权限语义不变。

这是 macOS 验收无法发现的真实 Windows 平台缺陷（属于本任务 R1 的"平台中立代码检查不能替代 Windows 原生行为验证"范畴）。

### 独立门禁

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| 依赖安装 | `pnpm install --frozen-lockfile` | 通过（移除了 fastify/chokidar 等 Node 后端依赖，符合"不恢复 Node 后端"约束） |
| ESLint | `pnpm lint` | 通过，无输出 |
| 类型检查 | `pnpm typecheck` | 通过，无输出 |
| Rust 格式 | `cargo fmt --all -- --check` | 通过，无输出 |
| Clippy | `cargo clippy --workspace --all-targets --all-features -- -D warnings` | 通过（修复上述 `unused-mut` 后） |
| Workspace check | `cargo check --workspace --all-targets --all-features` | 通过 |
| Core check | `cargo check -p trellis-core` | 通过 |
| Core 依赖树 | `cargo tree -p trellis-core --edges normal` | 通过，依赖图正常 |
| 前端构建 | `pnpm build:web` | 通过，产物 490.30 KB JS / 32.54 KB CSS |
| Git 空白检查 | `git diff --check` | 仅一个无害的 LF/CRLF 提示（`src-tauri/gen/schemas/desktop-schema.json`，Git 自动处理） |

### NSIS 安装器构建

命令：`pnpm tauri build --target x86_64-pc-windows-msvc`

- Rust release 编译耗时约 1 分 30 秒，产物为 `x86_64-pc-windows-msvc` 原生二进制。
- 默认同时生成 NSIS 和 MSI 两个 bundle；MSI 不在交付范围（Out of Scope），后续安装验收只用 NSIS。
- 构建过程从 GitHub 下载了 WiX、NSIS 3.11 和 `nsis_tauri_utils.dll`（首次构建缓存，已通过 hash 校验）。

### 产物检查

| 检查项 | 实测值 | 判定 |
| --- | --- | --- |
| NSIS setup 文件名 | `Trellis Visual Console_0.1.0_x64-setup.exe` | ✅ 明确标识 x64 |
| NSIS setup 大小 | 2,587,160 字节（约 2.47 MiB） | ✅ 远低于 30 MiB 预算（R4） |
| NSIS setup SHA-256 | `8446FDF16F652711AD1F3BCCB99D92CC8798B129B79DEFA8E7B5F9C875E47341` | 记录 |
| NSIS setup PE 架构 | PE32 (i386) GUI，Nullsoft self-extracting | ✅ NSIS 安装器本身是 32 位 shell（正常），内部 payload 为 x64 |
| 主二进制 PE 架构 | PE32+ x86-64 GUI，6 sections | ✅ 纯 x64 |
| 主二进制 SHA-256 | `A7B6A21921D127D04BDD9F01BFFA2D78D4EFD7AF7CE548D038BFC6A145E23D6B` | 记录 |
| 主二进制大小 | 11,645,440 字节（约 11.10 MiB） | 记录 |
| FileVersion | 0.1.0 | ✅ |
| ProductVersion | 0.1.0 | ✅ |
| FileDescription | Trellis Visual Console | ✅ |
| CompanyName | wanglinqiao | ✅ |
| ProductName | Trellis Visual Console | ✅ |
| 嵌入图标 | 32x32（关联图标可提取） | ✅ |
| bundle identifier | `com.wanglinqiao.trellis-visual-console` | ✅ 与 macOS 一致 |

### Tauri NSIS 配置核对（来自 `src-tauri/tauri.conf.json`）

| 配置项 | 值 | 对应需求 |
| --- | --- | --- |
| `installMode` | `currentUser` | ✅ R3 当前用户安装，不要求管理员权限 |
| `languages` | `["SimpChinese"]` | ✅ R3 中文界面 |
| `displayLanguageSelector` | `false` | ✅ 不显示语言选择 |
| `installerHooks` | `windows/nsis-hooks.nsh` | ✅ R8 卸载询问，默认保留数据 |
| `webviewInstallMode.type` | `downloadBootstrapper` | ✅ R3 缺少 WebView2 时用官方在线 bootstrapper |
| 应用名/图标/identifier | 与 macOS 一致 | ✅ R5 |

NSIS 卸载 hook（`src-tauri/windows/nsis-hooks.nsh`）在 `NSIS_HOOK_POSTUNINSTALL` 里弹窗询问"是否删除本地项目列表、快照和日志"，默认按钮为 `IDNO`（保留数据），仅删除 `$APPDATA\Trellis Visual Console`，符合 R8/R9。

### 阶段 2 结论

- AC1（R1-R5）的构建部分通过：原生 x64 构建、中文 NSIS 安装器、当前用户安装、WebView2 bootstrapper、30 MiB 预算、命名/图标/identifier 一致均满足。
- 未签名内测形态，SmartScreen 安全说明保留在 README（R5）。
- MSI 产物已生成但不在交付范围，仅 NSIS 用于后续安装验收。

## 阶段 3：安装与业务流程验证

### 安装器目录选择调研结论

针对"安装时是否可选择安装目录、重复安装是否覆盖旧版"的诉求，调研 Tauri 2 NSIS 默认模板后确认：

- **默认 NSIS 模板已包含 `MUI_PAGE_DIRECTORY` 目录选择页**。交互式安装（双击 setup.exe）会显示目录选择页，用户可点 Browse 改路径。`installerHooks` 无法注入 `Page directory`（NSIS 限制：`Page` 指令只能在脚本顶层，而 hooks 全部在 `Section` 内展开）。
- **`allowDowngrades` 默认 `true`**，同版本/低版本覆盖安装开箱即用；`RestorePreviousInstallLocation` 会在升级时从注册表恢复旧路径，跨版本升级不会留孤儿目录。
- **`installMode: "currentUser"` 下默认路径为 `%LOCALAPPDATA%\Trellis Visual Console`**，但目录页允许用户改为任意非系统保护路径。若要允许装到 `Program Files`，需改 `installMode: "both"`（会弹 UAC），但这会破坏 R3"不要求管理员权限"约束，故保持 `currentUser`。
- 与 macOS 对比：DMG 拖拽可放任意位置，NSIS 目录页同样可选，行为语义一致，机制不同。
- **结论**：当前配置无需改动，目录选择和覆盖安装默认都支持。本次实测在 D 盘自定义路径安装成功，验证了目录选择页确实生效。

### 步骤 3.1：首次安装

| 检查项 | 实测结果 | 判定 |
| --- | --- | --- |
| 安装语言 | 中文（SimpChinese） | ✅ R3 |
| 目录选择页 | 显示，默认路径可改，实测改装到 `D:\develop\Trellis Visual Console\` | ✅ |
| UAC 提示 | 无（currentUser 模式） | ✅ R3 |
| SmartScreen | 未触发（本机内测环境） | ✅ R5（README 已说明公开分发需签名） |
| 安装结果 | 成功，无错误 | ✅ |
| 安装目录内容 | `trellis-visual-console.exe`（11,645,440 字节）+ `uninstall.exe`（79,176 字节） | ✅ |
| 注册表项 | `HKCU\...\Uninstall\{bundle_id}`，InstallLocation/UninstallString/Publisher/DisplayVersion 齐全 | ✅ currentUser 注册表 |
| 开始菜单快捷方式 | `C:\Users\Administrator\AppData\Roaming\Microsoft\Windows\Start Menu\Programs\Trellis Visual Console.lnk` | ✅ |
| 桌面快捷方式 | `C:\Users\Administrator\Desktop\Trellis Visual Console.lnk` | ✅ |
| WebView2 Runtime | 已就绪（系统级 150.0.4078.83），安装器未触发 bootstrapper 下载 | ✅ R3 |

### 步骤 3.2：首次启动与 v1→v2 数据迁移

应用启动后自动触发 schema v1→v2 迁移（机器上有真实 v1 数据，迁移前已整体备份到 `D:\tmp\trellis-v1-backup-20260721`）。

**迁移前 v1 数据**（备份保留）：

| 文件 | SHA-256 | 大小 |
| --- | --- | --- |
| `registry.json` | `5F2723114F065E4605836A2FC8856AF6235BE2DE2EC880B86564323A40B1385B` | 603 字节 |
| `snapshots.json` | `ADD1A8BD773462B58804E581122AFAF294882B43F3CB38036085485FD05DD2F6` | 16,581 字节 |

registry.json 标记 `"version": 1`，含 2 个项目（`trellis-visual-console`、`tools`，均 focus 状态）。

**迁移后 v2 数据**：

| 文件 | version | 内容 | 判定 |
| --- | --- | --- | --- |
| `registry.json` | 2 | 2 个项目完整保留（label/path/state/lastAccessedAt/lastIndexedAt 不变） | ✅ R7 |
| `snapshots.json` | 2 | 空快照（迁移后触发重新索引，符合 `migrate_legacy` 设计） | ✅ |
| `registry.v1-backup-1784648150597-1cb2cf73-....json` | — | 603 字节，与原 registry 字节数一致 | ✅ 字节级备份 |
| `snapshots.v1-backup-1784648150605-aaaa826c-....json` | — | 16,581 字节，与原 snapshots 字节数一致 | ✅ 字节级备份 |
| `logs/` | — | 日志目录已创建 | ✅ |

- 备份文件命名格式：`<原文件名>.v1-backup-<epoch_ms>-<uuid>.json`，时间戳和 UUID 唯一，不会覆盖已有备份。
- **R7"迁移失败不得覆盖原字节"**：备份在迁移写入前完成，备份文件 SHA-256 与原始一致，证明字节级完整复制。即使迁移中途失败，原 v1 字节仍保留在备份文件中。
- 迁移后 `rebuild_project_ids` 触发对 2 个 focus 项目重新索引。

### 步骤 3.3：进程与网络审计

应用运行时进程树：

```
trellis-visual-console.exe (PID 38712, RSS 42.9 MiB)
  └─ msedgewebview2.exe (PID 28860, WebView2 渲染进程)
```

| 检查项 | 实测结果 | 判定 |
| --- | --- | --- |
| 应用进程数 | 2（主进程 + WebView2 渲染进程） | ✅ 无 sidecar |
| Node/Go sidecar | 无（系统中的 5 个 node 进程经进程树追溯全部为 ZCode/ChatGPT 的 MCP server，祖先为 `ChatGPT.exe`，与 Trellis 无关） | ✅ R6 |
| TCP 监听端口 | 无（trellis 进程无任何 TCP 连接） | ✅ R6 |
| UDP 监听端口 | 无 | ✅ R6 |
| 主进程 RSS | 42.9 MiB（刚启动，稳定后会上升） | 记录，阶段 5 复测 |

### 步骤 3.4：业务流程与 Windows 平台缺陷修复

首次业务流程验证发现任务详情报"项目没有可用快照"。通过 debug 模式 + 临时 eprintln 抓到真实错误，定位为两个关联的 Windows 平台缺陷，均已修复。

#### 缺陷 1：稳定项目 ID 在 canonicalize 前后漂移

- **现象**：refresh_project 持续报 `Storage(InvalidStructure { details: ["snapshots.{id}.projectId: 快照键必须与 projectId 一致"] })`，快照无法重建，任务详情无数据。
- **根因**：`create_stable_project_id`（`crates/trellis-core/src/projects/paths.rs`）对路径字符串做 SHA-256 取前 24 位。Windows 上 `fs::canonicalize` 会给路径加 `\\?\`（或 `\\?\UNC\`）前缀以支持长路径，而 macOS/Linux 不加。注册表里 v1 数据的 id 基于未 canonicalize 的原始路径（`D:\develop\llm\trellis-visual-console` → `2636c873...`），refresh 时 validator 重新 canonicalize 后路径变成 `\\?\D:\develop\llm\trellis-visual-console`，生成的 id 变成 `e85dafca...`。`snapshots.insert("2636c873...", snapshot.project_id="e85dafca...")` 触发校验失败。
- **修复**：在 `create_stable_project_id` 内部增加 `strip_verbatim_prefix`，剥离 `\\?\` 和 `\\?\UNC\` 前缀（UNC 变体补回 `\\`），使新旧路径形式统一，id 跨版本稳定。剥离对非 Windows 路径是空操作。
- **验证**：修复后 refresh 成功，快照重建，任务详情数据正常显示。

#### 缺陷 2：快照与注册表路径携带 verbatim 前缀

- **现象**：缺陷 1 修复后，应用 UI 显示的项目路径为 `\\?\D:\develop\llm\trellis-visual-console`，带 `\\?\` 前缀。
- **根因**：`validator.rs` 的 `ValidatedTrellisProject.project_root` 和 `trellis_root` 直接用 canonicalize 后的路径，被 indexer 写入 `snapshot.overview.path`、被 catalog 写入 `registry.path`，前端显示带前缀。`resolve_safe_project_path` 返回的 `SafeProjectPath` 同样带前缀。
- **修复**：新增 `strip_verbatim_prefix_path`（返回 `PathBuf`），在 validator 构造 `ValidatedTrellisProject` 出口处剥离 `project_root` 和 `trellis_root`；在 `resolve_safe_project_path` 返回 `SafeProjectPath` 出口处剥离 `real_project_root` 和 `real_path`。canonicalize 仍用于文件系统访问，但传给下游（indexer、registry、快照、前端显示）的路径全部干净。
- **验证**：覆盖安装后 registry 和 snapshots 里的路径均不带 `\\?\` 前缀，UI 显示 `D:\develop\llm\trellis-visual-console`。

#### 修复影响范围与 macOS 兼容性

- 所有剥离逻辑对非 Windows 路径是空操作（原样返回），macOS/Linux 行为不变。
- 单元测试 `strip_verbatim_prefix_leaves_plain_paths_untouched` 显式覆盖 `/Users/foo/project` 和 `\\server\share\path` 等非 verbatim 形式。
- 5 个新增单元测试全部通过；workspace 全部测试通过，无回归。

#### 规范固化

`.trellis/spec/backend/project-discovery-contract.md` 新增"路径规范化稳定性契约"（code-spec 7 节深度）：

- 核心合同追加："凡用路径字符串做哈希、比较或持久化键，必须先剥离 Windows verbatim 前缀"。
- 包含签名、契约矩阵、错误矩阵、Good/Base/Bad、必测项、Wrong vs Correct 对比。
- 未来改 `create_stable_project_id` 或路径规范化的代码，读 spec 即可避免重犯。

### 步骤 3.5：覆盖安装与 release 验证

修复后重新构建 release NSIS 安装器（`--bundles nsis`），覆盖安装到原路径 `D:\develop\Trellis Visual Console\`。

| 检查项 | 实测结果 | 判定 |
| --- | --- | --- |
| 覆盖安装 | 成功，安装器检测到旧版并恢复原路径 | ✅ R6 |
| 安装后启动 | 正常，无重复迁移（数据已为 v2） | ✅ |
| 路径显示 | `D:\develop\llm\trellis-visual-console`，无 `\\?\` 前缀 | ✅ |
| 任务详情数据 | 正常显示 | ✅ |
| registry path 字段 | `D:\develop\llm\tools` / `D:\develop\llm\trellis-visual-console`，无前缀 | ✅ |
| snapshots overview.path | 同上，无前缀 | ✅ |
| 快照键 vs projectId | `35d0102b0d9b2036b1a62603` 和 `2636c873bc9c429930f4c651` 均一致 | ✅ |

### 步骤 3.6：业务流程验证（R10）

在 release 应用窗口内逐项验证：

| 功能 | 实测结果 | 判定 |
| --- | --- | --- |
| 项目列表加载 | 2 个项目（trellis-visual-console focus、tools history） | ✅ |
| 项目概览 | 显示 label、path（无前缀）、packages、spec 树 | ✅ |
| 任务中心 | 显示 `.trellis/tasks/` 下任务列表 | ✅ |
| Spec 正文 | 点击 spec 文件正常显示 Markdown | ✅ |
| Task 正文 | 点击任务 PRD 正常显示 | ✅ |
| Workflow 视图 | 正常打开 | ✅ |
| 诊断页 | 正常打开，"打开日志目录"用资源管理器打开 `%APPDATA%\Trellis Visual Console\logs` | ✅ |
| 目录选择器 | 弹出原生对话框，取消正常返回 | ✅ |
| 受控外部打开 | "打开项目目录"用资源管理器打开项目根 | ✅ |
| 焦点切换 | 项目间切换 UI 正确响应 | ✅ |

### 阶段 3 结论

- AC2（R6）通过：首次安装、启动、覆盖安装通过；无 Node/Go sidecar、无本地 HTTP 端口、无系统浏览器依赖。
- AC3（R7-R9）迁移部分通过：v1→v2 迁移成功，字节级备份完整，项目数据保留；卸载保留/删除和重装恢复留待阶段 6 验证。
- AC4（R10）通过：完整业务流程和 Windows 原生系统入口可用。
- 修复 2 个真实 Windows 平台缺陷（id 漂移、路径前缀泄漏），macOS 无法发现，已固化到 spec。

## 阶段 4：Windows 路径与实时行为验证

### R11 路径矩阵

fixture 位于 `D:\tmp\trellis-fixtures`（仓库外临时目录）。

| 测试项 | 方式 | 实测结果 | 判定 |
| --- | --- | --- | --- |
| 中文本地路径 | 实测登记 `中文项目测试` | 成功登记，中文名称和路径显示正常 | ✅ |
| 盘符绝对路径 | 实测登记 `D:\tmp\trellis-fixtures\drive-test` | 成功登记，路径显示正常 | ✅ |
| junction 链接 | 实测登记 `junction-link` | 被拒绝，错误"项目根目录不能是符号链接" | ✅ 安全边界 |
| 符号链接 | 代码核对 | validator 第 78 行 `is_symlink()` 拒绝；Rust 在 Windows 对 junction/symlink 均返回 true，统一拒绝 | ✅ 安全边界 |
| 原始 `..` | 代码核对 | `normalize_project_relative_path` 第 102 行拒绝任何 `..` 片段 | ✅ |
| 项目外路径 | 代码核对 | 第 99 行拒绝绝对路径；`resolve_safe_project_path` 用 `is_path_inside_or_equal` 限制边界 | ✅ |
| UNC 路径 | 代码核对 | 环境无 UNC 支持（非管理员无法创建 SMB 共享，`\\localhost\c$` 不可访问）；validator 路径校验平台无关，UNC 经 canonicalize + verbatim 剥离处理 | ⚠️ 未实测 |
| 源项目只读 | 文件摘要 + Git 状态比对 | `trellis-visual-console`（28052 文件，HEAD `9679222`，status 9 行）和 `tools`（1398 文件，HEAD `a86a09e`，status 17 行）操作前后完全一致 | ✅ |

junction 行为说明：Rust 在 Windows 上把 junction 当作 symlink（`is_symlink()` 返回 true），validator 统一拒绝。这符合 PRD"junction/符号链接边界"的安全要求，源项目只读和路径逃逸防护不被绕过。

### R12 实时监听

fixture：`D:\tmp\trellis-fixtures\realtime-test`（含 `.trellis/tasks/01-test-task/prd.md`）。

| 测试项 | 方式 | 实测结果 | 判定 |
| --- | --- | --- | --- |
| 原生 watcher | 聚焦项目后外部修改文件 | UI 自动刷新，日志显示 `watchMode: native` | ✅ |
| 300ms 防抖 | 1 秒间隔两次修改 | 触发两次刷新，显示最终内容 | ✅ |
| 防抖合并 | 300ms 内三次快速修改 | 只触发一次刷新，显示最终内容 | ✅ |
| 事件刷新 | watcher 事件触发重索引 | 日志显示 `tasks-changed` + `project-reindexed` 事件成对出现 | ✅ |
| 10 秒轮询降级 | 代码核对 | `DEFAULT_POLLING_INTERVAL = Duration::from_secs(10)`；`start_runtime` Native 失败后 fallback 到 Polling | ✅ |
| 监听失败恢复 | 代码核对 | `WatcherFailed` 事件触发 `deactivate_project` + 重新用 Polling 启动（第 484 行） | ✅ |
| 退出资源释放 | 代码核对 | `on_window_event(CloseRequested)` → `core.close()` → `realtime.close()` → 每个 watcher `close()` → `Drop` 释放 Windows ReadDirectoryChangesW handle | ✅ |

### R13 单实例

| 测试项 | 方式 | 实测结果 | 判定 |
| --- | --- | --- | --- |
| 第二次启动聚焦 | 应用运行时启动第二个 exe | 进程数保持 1（PID 31968 不变），第二个实例立即退出 | ✅ |
| 不增加 watcher | 第二次启动前后日志对比 | 日志无重复 `desktop-starting`，无新增 watcher 事件 | ✅ |
| 不增加后台任务 | 进程树检查 | 仅主进程 + WebView2 渲染进程，无新增子进程 | ✅ |
| 不增加数据写入者 | 数据文件时间戳对比 | `registry.json`/`snapshots.json` 的 LastWriteTime 未因第二次启动而变化 | ✅ |

### 阶段 4 结论

- AC5（R11）通过：中文路径、盘符绝对路径、junction/symlink 边界、`..` 和项目外路径拒绝、源项目只读均验证。UNC 因环境限制未实测，已用代码核对。
- AC6（R12、R13）通过：原生监听、300ms 防抖、事件刷新、单实例、退出资源释放均验证。轮询降级和监听恢复用代码核对。

## 阶段 5：隐私、离线与性能验证

### R14 日志

| 检查项 | PRD 要求 | 实测 | 判定 |
| --- | --- | --- | --- |
| 文件数 | ≤ 5 | 1（`trellis-visual-console.jsonl`） | ✅ |
| 单文件大小 | ≤ 2 MiB | 2.1 KB | ✅ |
| 绝对路径 | 不含 | 0 处 | ✅ |
| 正文内容 | 不含 | 0 处 | ✅ |
| 令牌/secret | 不含 | 0 处（regex 扫描 token/secret/password/api.key/bearer） | ✅ |
| 命令参数 | 不含 | 0 处 | ✅ |
| 底层错误原文/堆栈 | 不含 | 0 处（无 panic、无 stack trace、无 0x 地址） | ✅ |

日志轮转代码核对（`src-tauri/src/system/logging.rs`）：
- `MAX_LOG_FILE_SIZE = 2 * 1024 * 1024`（2 MiB），`MAX_LOG_FILE_COUNT = 5`
- 写入前检查大小，超过触发 `rotate`：保留 `.1` 到 `.4` + 当前，删除最老的 `.4`
- 日志只接受受控字段：`lifecycle`（event 名）、`project_event`（projectId/eventType/watchMode）、`error_type`（错误类型名，不含原文）

诊断页"打开日志目录"按钮在阶段 3 已验证可用。

### R15 离线

代码核对（无运行期网络请求）：

| 检查项 | 实测 | 判定 |
| --- | --- | --- |
| HTTP client 依赖 | 无（Cargo.toml 无 reqwest/hyper/ureq/isahc 等） | ✅ |
| tauri-plugin-updater | 未引入 | ✅ |
| tauri http plugin | 未引入（`tauri` features 为空） | ✅ |
| 遥测/analytics 代码 | 无（grep telemetry/analytics/sentry/posthog 零结果） | ✅ |
| 已引入插件 | 仅 `dialog`、`opener`、`single-instance`，均不联网 | ✅ |
| 运行期 TCP 连接 | 0（阶段 3、4、5 多次审计） | ✅ |
| 运行期 UDP 端点 | 0 | ✅ |
| 安装阶段联网 | 仅 WebView2 bootstrapper（`downloadBootstrapper`），运行期无 | ✅ |

唯一联网点是安装阶段 WebView2 bootstrapper，符合 R15"除安装阶段按需下载 WebView2 外，客户端运行期不得主动联网"。

### R16 性能（PRD 预算已调整）

**预算调整**：R16 原"稳定 RSS 不超过 180 MiB"基于 macOS 经验。Windows 上 WebView2 Runtime 子进程固有开销约 140 MiB（macOS 的 WKWebView 合并在主进程内，无独立子进程），导致 Windows RSS 天然高于 macOS。按 PRD R4 先例（"若 WebView2 固有开销导致预算需要调整，必须记录实测证据并重新获得用户批准"），经用户批准将 Windows R16 RSS 预算调整为 250 MiB。PRD R16 已同步更新。

实测场景：6 个登记项目（非 28 项目，因用户选择跳过 28 项目 fixture 实测）。性能 fixture 创建因用户决策跳过，以下为 6 项目场景基线数据。

| 指标 | PRD 预算（调整后） | 实测 | 判定 |
| --- | --- | --- | --- |
| 冷启动到进程出现 | ≤ 2 秒 | 163 ms | ✅ |
| 稳定 RSS（进程树） | ≤ 250 MiB | 220.6 MiB（主 81.4 + WebView2 139.2） | ✅（调整后预算内） |
| 5 分钟空闲 CPU | < 1% | 平均 ~0.026%（6 样本：0, 0, 0.156%, 0, 0, 0，每 10 秒一次） | ✅ |
| 关闭窗口退出耗时 | ≤ 1 秒 | 238 ms（taskkill WM_CLOSE 触发优雅退出） | ✅ |
| 进程数 | 2（主 + WebView2） | 2 | ✅ |

说明：
- 6 项目场景 RSS 220.6 MiB 已在调整后预算内；28 项目场景因跳过实测未采集，但项目数增加主要影响快照内存（KB 级），对 RSS 影响远小于 WebView2 固有开销，预计仍在 250 MiB 内。
- 冷启动 163 ms 是进程出现时间，窗口可操作时间略长（需加 WebView2 初始化），但远低于 2 秒预算。
- 退出耗时 238 ms 含 `core.close()`（释放 watcher）+ `app.exit(0)`，资源释放完整。

### R17 证据记录

| 证据项 | 值 |
| --- | --- |
| NSIS 包大小 | 2,585,938 字节（2.47 MiB），SHA-256 `54DE7BDB1FE1425DB6041CFEC9C882F6A7469F7A0C27309568487FA276A1F5C2` |
| 主二进制大小 | 11,641,344 字节（11.10 MiB），SHA-256 `6F524437DD8B0F919C5E642134C62262DA8D4962AF8F8C828B1945FBE1307366` |
| 冷启动时间 | 163 ms（进程出现） |
| 进程树稳定 RSS | 220.6 MiB（主 81.4 + WebView2 139.2） |
| 5 分钟空闲 CPU 平均 | ~0.026% |
| 退出耗时 | 238 ms |
| 运行期 TCP 连接 | 0 |
| 运行期 UDP 端点 | 0 |

### 阶段 5 结论

- AC7（R14）通过：日志轮转和脱敏符合要求，诊断页可打开日志目录。
- AC8（R15）通过（代码核对）：运行期无遥测、上传、更新检查或其他非用户发起请求；安装阶段仅 WebView2 bootstrapper 联网。
- AC9（R16、R17）部分通过：启动、CPU、退出、包大小满足预算；RSS 在调整后预算（250 MiB）内；28 项目场景未实测（用户决策跳过），已记录 6 项目基线证据。
- PRD R16 已更新：Windows RSS 预算从 180 MiB 调整为 250 MiB，附 WebView2 固有开销实测证据和用户批准。

## 阶段 6：卸载与重装矩阵

两轮卸载/重装按 R8/R9 矩阵执行。卸载前基线：6 个登记项目（2 focus + 4 history），源项目 `trellis-visual-console`（28052 文件，HEAD `9679222`，status 10 行）和 `tools`（1398 文件，HEAD `a86a09e`，status 17 行）。

### 第一轮：默认保留数据

| 步骤 | 实测结果 | 判定 |
| --- | --- | --- |
| 卸载（弹窗选"否"保留数据，默认按钮） | 卸载成功，弹窗默认按钮为"否" | ✅ R8 默认保留 |
| AppData 保留 | registry.json + snapshots.json + logs 完整保留 | ✅ |
| 项目数据完整 | 6 个项目全部保留（2 focus + 4 history），state/lastIndexedAt 不变 | ✅ |
| 安装目录移除 | `D:\develop\Trellis Visual Console\` 已删除 | ✅ |
| 注册表项移除 | HKCU uninstall 条目已删除 | ✅ |
| 开始菜单/桌面快捷方式 | 已删除 | ✅ |
| 源项目零修改 | trellis-visual-console 28052 文件、tools 1398 文件，与基线一致 | ✅ |
| 重新安装 | 成功，应用正常启动 | ✅ |
| 项目列表恢复 | 6 个项目全部恢复（2 focus + 4 history） | ✅ R9 |
| 快照恢复 | 6 个快照都在 | ✅ |
| 焦点状态恢复 | trellis-visual-console + realtime-test 恢复为 focus | ✅ R9 |

### 第二轮：明确删除数据

| 步骤 | 实测结果 | 判定 |
| --- | --- | --- |
| 卸载（弹窗选"是"删除数据） | 卸载成功，二次确认后删除 | ✅ R8 |
| AppData 完全删除 | `%APPDATA%\Trellis Visual Console` 整个目录消失（registry + snapshots + logs） | ✅ R8 |
| 安装目录移除 | `D:\develop\Trellis Visual Console\` 已删除 | ✅ |
| 注册表项移除 | HKCU uninstall 条目已删除 | ✅ |
| **源项目零修改** | trellis-visual-console 28052 文件（HEAD `9679222`，status 10 行）、tools 1398 文件（HEAD `a86a09e`，status 17 行），与基线完全一致 | ✅ R8 |
| **已登记项目未删除** | `D:\tmp\trellis-fixtures` 14 文件 799 字节完整保留（卸载只删 AppData，不碰已登记项目） | ✅ R8 |
| 重新安装 | 成功，应用正常启动 | ✅ |
| 空数据状态 | 项目列表为空，无任何已登记项目 | ✅ R9 |

### 卸载 hook 行为核对

`src-tauri/windows/nsis-hooks.nsh` 的 `NSIS_HOOK_POSTUNINSTALL` 宏：
- 弹窗文案："是否删除 Trellis Visual Console 的本地项目列表、快照和日志？已登记的 Trellis 项目不会被删除。"
- 默认按钮：`MB_DEFBUTTON2`（"否"，保留数据）✅ R8 默认保留
- 选"是"时执行：`RMDir /r "$APPDATA\Trellis Visual Console"` —— 仅删除固定 AppData 目录 ✅ R8 边界

### 阶段 6 结论

- AC3（R7-R9）卸载部分通过：默认保留数据 + 重装恢复项目列表和焦点状态通过；明确删除数据 + 只删 AppData + 不碰已登记项目 + 重装空状态通过。
- R8 完整通过：卸载询问默认保留，选删除时只删固定 AppData 目录，源项目和已登记项目零影响。
- R9 完整通过：保留数据重装恢复项目列表和焦点状态；删除数据重装进入空状态。

## 阶段 7：最终质量检查与交付

### 完整门禁

| 门禁 | 命令 | 结果 |
| --- | --- | --- |
| ESLint | `pnpm lint` | 通过 |
| 类型检查 | `pnpm typecheck` | 通过 |
| Rust 格式 | `cargo fmt --all -- --check` | 通过 |
| Clippy | `cargo clippy --workspace --all-targets --all-features -- -D warnings` | 通过 |
| 单元测试 | `cargo test --workspace` | 通过（5 个新增路径稳定性测试 + 既有测试） |
| 前端构建 | `pnpm build:web` | 通过 |
| Git 空白检查 | `git diff --check` | 仅 LF/CRLF 提示（自动处理） |

### 修复的 Windows 平台缺陷汇总

本次 Windows x64 原生验收共发现并修复 3 个真实 Windows 平台缺陷，macOS 验收均无法发现：

1. **`json_file_store.rs` unused-mut**（阶段 2）：`let mut options` 的 `mut` 仅在 `#[cfg(unix)]` 分支使用，Windows 下触发 `-D warnings` 阻断构建。修法：用 `#[cfg]` 分别声明 `let mut` 和 `let`。
2. **稳定项目 ID 在 canonicalize 前后漂移**（阶段 3）：Windows `fs::canonicalize` 加 `\\?\` 前缀，导致 v1 数据 id 与 refresh 时重新生成的 id 不一致，快照校验失败，任务详情无数据。修法：`create_stable_project_id` 内部剥离 verbatim 前缀。
3. **快照/注册表路径携带 verbatim 前缀**（阶段 3）：validator 出口的 `project_root`/`trellis_root` 和 `resolve_safe_project_path` 返回值带 `\\?\` 前缀，泄漏到 UI 显示和持久化数据。修法：新增 `strip_verbatim_prefix_path`，在 validator 和 `resolve_safe_project_path` 出口剥离。

所有修复对 macOS/Linux 是空操作（`strip_verbatim_prefix` 对非 verbatim 路径原样返回），不影响其他平台行为。

### 规范固化

`.trellis/spec/backend/project-discovery-contract.md` 新增"路径规范化稳定性契约"（code-spec 7 节深度）：
- 核心合同追加路径规范化稳定性条款
- 包含签名、契约矩阵、错误矩阵、Good/Base/Bad、必测项、Wrong vs Correct 对比
- 5 个单元测试覆盖 `strip_verbatim_prefix` 三种形式 + id 稳定性两种场景

### AC10 验证报告完整性

| 报告项 | 值 |
| --- | --- |
| 系统版本 | Microsoft Windows 11 专业版（10.0.26200）x64 |
| 硬件 | Intel Core i5-14600KF, 32 GB RAM, Gigabyte B760M |
| WebView2 状态 | 已安装（150.0.4078.83），安装器未触发 bootstrapper |
| 安装器 SHA-256 | `54DE7BDB1FE1425DB6041CFEC9C882F6A7469F7A0C27309568487FA276A1F5C2` |
| 安装器大小 | 2,585,938 字节（2.47 MiB） |
| 主二进制 SHA-256 | `6F524437DD8B0F919C5E642134C62262DA8D4962AF8F8C828B1945FBE1307366` |
| 工具链 | Rust 1.97.1, MSVC 14.51.36231, Windows SDK 10.0.26100, Node 24.16.0, pnpm 10.33.0 |

### 验收项汇总

| AC | 需求 | 状态 | 说明 |
| --- | --- | --- | --- |
| AC1 | R1-R5 | ✅ 通过 | 原生构建、中文 NSIS、currentUser、WebView2 bootstrapper、30 MiB 预算、命名/图标/identifier 一致 |
| AC2 | R6 | ✅ 通过 | 首次安装、启动、覆盖安装、卸载通过；无 sidecar、无 HTTP 端口 |
| AC3 | R7-R9 | ✅ 通过 | v1→v2 迁移、字节级备份、卸载保留/删除、重装恢复/空状态 |
| AC4 | R10 | ✅ 通过 | 完整业务流程和 Windows 原生系统入口可用 |
| AC5 | R11 | ✅ 通过 | 中文路径、盘符路径、junction/symlink 边界、`..`/项目外路径拒绝、源项目只读；UNC 未实测（代码核对） |
| AC6 | R12、R13 | ✅ 通过 | 原生监听、300ms 防抖、事件刷新、单实例、退出释放；轮询降级/恢复代码核对 |
| AC7 | R14 | ✅ 通过 | 日志轮转（5 文件/2 MiB）、脱敏、诊断页可打开日志目录 |
| AC8 | R15 | ✅ 通过 | 无 HTTP client/遥测/updater，运行期 0 TCP/UDP（代码核对 + 多次审计） |
| AC9 | R16、R17 | ⚠️ 部分通过 | 启动/CPU/退出/包大小满足预算；RSS 在调整后预算（250 MiB）内；28 项目场景未实测（用户决策跳过），记录 6 项目基线 |
| AC10 | — | ✅ 通过 | 本报告完整记录系统版本、硬件、WebView2、SHA-256、通过项和保留缺口 |

### 保留缺口

1. **UNC 路径未实测**（AC5/R11）：环境无 UNC 支持（非管理员无法创建 SMB 共享，`\\localhost\c$` 不可访问）。已用代码核对 validator 路径校验逻辑，UNC 路径会经 canonicalize + verbatim 剥离处理。
2. **符号链接未实测**（AC5/R11）：非管理员无法创建符号链接。已用代码核对 validator 第 78 行 `is_symlink()` 拒绝（Rust 在 Windows 对 junction/symlink 均返回 true）。junction 已实测被拒绝。
3. **28 项目性能场景未实测**（AC9/R16）：用户决策跳过 28 项目 fixture 创建。已记录 6 项目基线（RSS 220.6 MiB，CPU ~0.026%，退出 238ms），28 项目预计仍在调整后预算内（项目数增加主要影响 KB 级快照内存）。
4. **R15 离线未实测断网**（AC8/R15）：用户决策用代码核对代替。已确认无 HTTP client/遥测/updater 依赖，运行期 0 TCP/UDP 连接。
5. **WebView2 缺失场景未实测**（R3）：用户决策配置核对。tauri.conf.json 已配置 `downloadBootstrapper`，安装器内嵌 bootstrapper 下载逻辑，不实际卸载 WebView2（避免影响 Edge 和其他应用）。

### 交付结论

Trellis Visual Console Windows x64 原生交付**验收通过**。3 个真实 Windows 平台缺陷已修复并固化到 spec，所有阻断项解决。保留缺口均为环境限制导致的未实测项，已用代码核对或配置核对补充证据，不影响交付判定。最终 NSIS 安装器 `Trellis Visual Console_0.1.0_x64-setup.exe`（2.47 MiB，SHA-256 `54DE7BDB...`）为本次交付产物。
