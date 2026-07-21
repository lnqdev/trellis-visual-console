# Windows x64 原生交付实施计划

## 1. 启动条件

- Windows 10 22H2 或 Windows 11 x64 实体机可用。
- 用户审阅本任务 PRD、设计和实施计划后，才运行 `task.py start`。
- 不创建 worktree，不默认生成测试类；临时 fixture 和测量输出放在仓库外。
- 从 `07-20-desktop-client` 已通过 macOS 验收的代码基线开始，不恢复 Node/Fastify 后端。

## 2. 有序实施清单

### 阶段 1：记录环境并建立基线

- 记录 Windows 版本、硬件、WebView2、Rust、MSVC、Node.js 和 pnpm 版本。
- 记录开始前 Git 状态，准备中文路径、UNC、版本 1 数据、路径攻击和 28 项目/2 焦点 fixture。
- 在不修改源项目的前提下保存 fixture 文件摘要与预期功能结果。

### 阶段 2：原生构建与安装器检查

- 安装依赖并执行前端、Rust workspace 和 Core 独立门禁。
- 构建 `x86_64-pc-windows-msvc` release NSIS 安装器。
- 检查文件名、PE 架构、应用图标、当前用户安装、中文界面、WebView2 bootstrapper、大小和 SHA-256。

### 阶段 3：安装与业务流程

- 验证首次安装、WebView2 已存在/缺失路径、首次启动和同版本覆盖安装。
- 验证扫描、登记、焦点、任务中心、Spec/Task/Workflow/诊断、正文、目录选择和受控外部打开。
- 验证版本 1→2 数据迁移、备份、失败保护和焦点恢复。

### 阶段 4：Windows 路径与实时行为

- 验证中文本地路径、UNC、盘符绝对路径、原始 `..`、项目外路径和可用条件下的 junction/符号链接。
- 验证原生文件监听、300ms 防抖、事件刷新、10 秒轮询降级、恢复和退出释放。
- 验证单实例不会增加 watcher、后台任务或数据写入者。

### 阶段 5：隐私、离线和性能

- WebView2 就绪后断网执行完整核心流程，并审计运行期 TCP/UDP 连接。
- 使用 28 项目/2 焦点 fixture 采集启动、RSS、5 分钟 CPU 和退出耗时。
- 压测日志轮转并抽查脱敏字段，确认没有绝对项目路径、正文、令牌、命令参数或底层错误原文。

### 阶段 6：卸载与重装

- 首轮采用默认“保留数据”卸载，确认应用数据保留且重装后恢复项目列表和焦点状态。
- 次轮明确选择“删除数据”，确认只删除固定应用数据目录，重装后为空状态。
- 两轮操作后比对源项目摘要和 Git 状态，确认项目未被修改或删除。

### 阶段 7：修复、回归与交付

- 修复发现的 Windows 平台缺陷，并按影响范围回归共享 Core、Tauri adapter 和前端行为。
- 写入 `docs/validation/desktop-client-windows-x64.md`，记录安装器、环境、功能、边界、网络、性能和卸载证据。
- 所有阻断项通过后执行完整质量检查，再进入 Trellis 收尾流程。

## 3. 验证命令

```powershell
pnpm install --frozen-lockfile
pnpm lint
pnpm typecheck
pnpm build:web
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo check --workspace --all-targets --all-features
cargo check -p trellis-core
cargo tree -p trellis-core --edges normal
pnpm tauri build --target x86_64-pc-windows-msvc
git diff --check
```

## 4. 完成门禁

- [ ] Windows x64 实体机和系统版本符合范围。
- [ ] NSIS 构建、安装、覆盖安装和两种卸载路径通过。
- [ ] WebView2、中文路径、UNC、监听、轮询、单实例和迁移通过。
- [ ] 运行期网络、离线、日志、性能和退出预算通过。
- [ ] 源项目摘要与 Git 状态在破坏性操作前后不变。
- [ ] Windows 验收报告完整，阻断问题已修复并回归。
