# Trellis Visual Console

Trellis Visual Console 是面向个人本机使用的 Trellis 只读桌面客户端。它把多个本地项目中的 Spec、Task、Workflow 和诊断信息集中到一个 macOS/Windows 应用中，不依赖用户预装 Node.js 或 pnpm，也不会修改被查看项目的 `.trellis/`。

## 核心能力

- 扫描用户明确选择的目录，发现并登记 Trellis 项目。
- 浏览项目概览、monorepo 包、Spec、Task、Workflow 和诊断。
- 集中搜索和筛选多个项目的活动、归档任务。
- 安全渲染 Markdown、GFM 与 JSONL，并保留源路径追溯。
- 使用 `focus`、`history`、`unavailable` 三态管理项目。
- 只监听焦点项目；原生事件失败时降级为 10 秒低频轮询。
- 将项目注册表、可重建快照和受控日志存放在应用数据目录。
- 提供系统目录选择、受控外部打开、日志目录和本地数据清理入口。
- 通过已签名的 Gitee Release 发现、下载和安装桌面内测更新。

## 架构

```text
React / Vite WebView
  ├─ Tauri invoke：查询、扫描、登记、正文和系统操作
  └─ Tauri listen：trellis://project-realtime 失效事件
                         │
                         ▼
Tauri 桌面适配层
  ├─ Command / Event、窗口、单实例和关闭生命周期
  └─ 原生目录选择、受控打开、日志、应用数据清理与签名更新
                         │
                         ▼
trellis-core（不依赖 Tauri 或 HTTP 框架）
  ├─ 应用服务、存储版本 2 与版本 1 迁移
  ├─ 项目扫描、索引、正文读取和路径安全
  └─ 原生监听、轮询降级、300ms 防抖与事件端口
                         │
                         ▼
              已登记项目的本地 .trellis/
```

生产应用不启动 Node/Fastify、本地 HTTP 服务或 sidecar。受控在线更新是唯一运行期联网例外：仅访问配置的 Gitee HTTPS 清单和用户确认后的 Release 更新包。源项目 `.trellis/` 始终是唯一事实来源；应用只写自己的 `registry.json`、`snapshots.json`、`updater-state.json` 和日志。

## 项目状态

- **焦点项目**：加入焦点时重新索引，持续监听允许的 Trellis 路径，文件变化通过进程内事件触发界面刷新。
- **历史项目**：零监听，只展示最后快照；显式刷新成功后，本次应用进程可读取正文。
- **不可用项目**：路径、权限或 Trellis 结构失效；保留登记信息和最后快照用于诊断。

## 开发要求

- Node.js 22.12 或更高版本，仅用于前端和 Tauri 构建工具。
- pnpm 10 或更高版本。
- Rust stable、Cargo，以及目标平台的 Tauri 2 系统构建依赖。

## 开发运行

```bash
pnpm install
pnpm dev
```

`pnpm dev` 启动 Tauri 开发应用；Vite 只提供 WebView 开发资源，不代理 API。隔离应用数据时使用：

```bash
TRELLIS_VISUAL_CONSOLE_DATA_DIR=/tmp/trellis-visual-console pnpm dev
```

## 构建

先安装依赖和目标平台 Rust target：

```bash
pnpm install --frozen-lockfile

# macOS 构建机
rustup target add aarch64-apple-darwin x86_64-apple-darwin

# Windows x64 构建机
rustup target add x86_64-pc-windows-msvc
```

`pnpm build` 生成当前平台的默认桌面安装包。需要明确架构和安装包类型时使用：

```bash
# macOS Apple Silicon，生成 arm64 DMG
pnpm build:mac:arm64

# macOS Intel，生成 x64 DMG；可在 Apple Silicon 上通过 Rust x64 target 构建
pnpm build:mac:x64

# Windows x64，生成 NSIS setup.exe；必须在 Windows x64 原生环境执行
pnpm build:windows:x64
```

macOS 的 DMG 脚本默认使用 Finder 设置镜像窗口布局。如果构建终端没有 Finder Apple Events 权限，可使用 CI 模式跳过窗口布局步骤，安装包内容不受影响：

```bash
CI=true pnpm build:mac:arm64
CI=true pnpm build:mac:x64
```

产物目录：

| 命令 | 产物目录 |
| --- | --- |
| `pnpm build:mac:arm64` | DMG 位于 `target/aarch64-apple-darwin/release/bundle/dmg/`，`.app.tar.gz` 与 `.sig` 位于相同 target 的 `bundle/macos/` |
| `pnpm build:mac:x64` | DMG 位于 `target/x86_64-apple-darwin/release/bundle/dmg/`，`.app.tar.gz` 与 `.sig` 位于相同 target 的 `bundle/macos/` |
| `pnpm build:windows:x64` | `target/x86_64-pc-windows-msvc/release/bundle/nsis/`，以及 NSIS 更新包与 `.sig` |

前端单独检查可执行 `pnpm build:web`，Rust 工作区检查可执行 `pnpm check:rust`。

当前支持目标：

| 平台 | 目标 | 交付形式 |
| --- | --- | --- |
| macOS 13+ | arm64、x64 | 分架构 DMG |
| Windows 10 22H2 / 11 | x64 | 当前用户 NSIS，WebView2 在线引导 |

Windows 安装包必须在 Windows x64 原生环境构建和验收，不能用 macOS 交叉构建代替。

### 未签名 macOS 内测包

当前内测 DMG 没有 Apple Developer ID 签名和公证。安装前先核对交付记录中的 SHA-256，再把应用拖入“应用程序”。如果 Gatekeeper 阻止首次启动，请在 Finder 中右键应用并选择“打开”，或在“系统设置 → 隐私与安全性”中确认本次打开；不要全局关闭 Gatekeeper。正式公开分发前仍需补齐签名与公证。

### 在线更新与一次性迁移

`0.1.0` 不包含更新器。请按当前平台从 Gitee Release 手工安装一次 `0.2.0-beta.1`，之后的更高版本可在应用内更新。更新器每天最多自动读取一次公开 Gitee HTTPS 清单，不会静默下载；诊断页可随时手动检查。

发现新版本后，客户端先展示版本与中文说明，只有用户确认才下载并验证 Tauri 签名。macOS 安装完成后可以立即重启或稍后重启；选择稍后重启时应用包已经替换，下次正常启动直接运行新版本，不会重复下载安装包。Windows 确认安装后应用会退出，由 NSIS 安装器完成替换。免费内测包仍可能出现 Gatekeeper 或 SmartScreen 提示。

当前免费内测清单要求同时提供 macOS arm64、macOS x64 的同版本产物、签名和中文说明；Windows x64 在线更新发布延后到具备原生构建与验收环境之后。完整发布、密钥备份和故障冻结步骤见[桌面端在线更新发布指南](docs/release/desktop-online-update.md)。

macOS 内测版本可使用本地三阶段发布脚本，产物固定整理到桌面目录，并通过 Gitee Open API 自动创建 Release、上传和匿名校验；脚本不会自动提交或推送公开清单：

```bash
pnpm release:mac:prepare -- 0.2.0-beta.3 "修复在线更新返回格式"
pnpm release:mac:upload -- "$HOME/Desktop/Trellis Visual Console Releases/v0.2.0-beta.3"
pnpm release:mac:publish -- "$HOME/Desktop/Trellis Visual Console Releases/v0.2.0-beta.3"
```

## 应用数据

| 平台 | 目录 |
| --- | --- |
| macOS | `~/Library/Application Support/Trellis Visual Console` |
| Windows | `%APPDATA%\Trellis Visual Console` |

存储格式当前版本为 2。首次读取合法版本 1 数据时会先备份注册表和快照，再保留原项目 ID 与元数据完成迁移；旧快照不作为可信运行数据，由 Rust 重新索引。

诊断区的“清除本地数据并退出”只删除固定应用数据目录，不删除或修改任何已登记 Trellis 项目。Windows 卸载器默认保留应用数据，用户明确选择后才删除。

## 只读与隐私边界

- Command 使用稳定项目 ID，正文路径必须来自快照或实时白名单。
- 路径检查同时拒绝绝对输入、原始 `..`、符号链接和 realpath 越界。
- Markdown 不启用原始 HTML；危险链接协议会被清理。
- 前端没有任意文件系统或任意 opener 权限，外部打开只经过 Rust 受控入口。
- 应用不提供编辑、命令执行、Agent 启动、远程访问或云同步能力。
- 不采集遥测、设备标识或崩溃上传；除受控在线更新外，运行期不访问网络。
- 日志最多 5 个文件、每个 2 MiB，只记录受控生命周期、稳定 ID 和错误类型。

## 项目结构

```text
crates/trellis-core/  传输无关的 Rust 业务 Core
src-tauri/            Tauri 桌面适配、系统集成与打包配置
src/shared/           前端 Zod IPC/Event 合同
src/web/              React 只读控制台
docs/                 架构与验证证据
.trellis/             工作流、规范、任务与开发记录
```

## 质量检查

```bash
pnpm lint
pnpm typecheck
pnpm build:web
pnpm check:version
pnpm check:update-manifest -- releases/latest.example.json
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo check --workspace --all-targets --all-features
cargo check -p trellis-core
git diff --check
```

## 文档

- [当前桌面架构](docs/planning/design.md)
- [macOS 桌面验收记录](docs/validation/desktop-client-macos.md)
- [迁移前 Web 阶段六报告](docs/validation/phase-6-report.md)
- [桌面客户端任务需求](.trellis/tasks/07-20-desktop-client/prd.md)
- [桌面客户端技术设计](.trellis/tasks/07-20-desktop-client/design.md)
- [桌面客户端实施计划](.trellis/tasks/07-20-desktop-client/implement.md)
- [Windows x64 原生交付任务](.trellis/tasks/07-21-desktop-client-windows-x64/prd.md)
- [桌面端在线更新发布指南](docs/release/desktop-online-update.md)

## 当前边界

当前不包含 Linux、Windows ARM64、macOS Universal、Windows x64 在线更新发布验收、Apple Developer ID、公证、Windows 商业代码签名、无人值守托管 CI 发布流水线、自动降级、托盘、多窗口、团队账号、远程访问、云同步和应用内编辑。在线更新仅面向免费受控内测；当前真实升级验收覆盖 macOS arm64/x64。
