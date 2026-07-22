# Trellis Visual Console

Trellis Visual Console 是面向个人本机使用的 Trellis 只读桌面客户端，用于集中浏览多个本地项目的 Spec、Task、Workflow 和诊断信息。生产应用基于 Tauri 2 和独立 Rust Core，不启动 Node/Fastify、本地 HTTP 服务或 sidecar，也不会修改被查看项目的 `.trellis/`。

完整的架构、数据目录、安全边界和验收说明见[主 README](README.md)。

## 开发运行

开发环境需要 Node.js 22.12+、pnpm 10+、Rust stable、Cargo 和目标平台的 Tauri 2 系统构建依赖。

```bash
pnpm install
pnpm dev
```

`pnpm dev` 启动 Tauri 桌面开发应用，Vite 只提供 WebView 开发资源。

## 按平台打包

先安装锁定依赖和 Rust target：

```bash
pnpm install --frozen-lockfile

# macOS 构建机
rustup target add aarch64-apple-darwin x86_64-apple-darwin

# Windows x64 构建机
rustup target add x86_64-pc-windows-msvc
```

执行对应平台命令：

```bash
# macOS Apple Silicon DMG
pnpm build:mac:arm64

# macOS Intel x64 DMG
pnpm build:mac:x64

# Windows x64 NSIS 安装器，仅在 Windows x64 原生环境执行
pnpm build:windows:x64
```

macOS 构建终端没有 Finder Apple Events 权限时，使用 CI 模式跳过 DMG 窗口布局：

```bash
CI=true pnpm build:mac:arm64
CI=true pnpm build:mac:x64
```

| 平台 | 产物目录 |
| --- | --- |
| macOS arm64 | `target/aarch64-apple-darwin/release/bundle/dmg/` |
| macOS x64 | `target/x86_64-apple-darwin/release/bundle/dmg/` |
| Windows x64 | `target/x86_64-pc-windows-msvc/release/bundle/nsis/` |

`pnpm build` 可构建当前平台默认安装包；`pnpm build:web` 只构建前端资源，不生成桌面安装包。

## 在线更新

`0.1.0` 用户需要从 Gitee Release 手工安装一次 `0.2.0-beta.1`。之后客户端每天最多自动检查一次公开 Gitee HTTPS 清单，不会静默下载；诊断页可随时手动检查。发现更新后先展示中文说明，用户确认后才下载并验证 Tauri 签名。

macOS 安装完成后可立即或稍后重启；稍后重启不会重新下载更新包。Windows 确认安装后会退出应用并交由 NSIS 安装器完成替换。内测包未接入 Apple Developer ID、公证或 Windows 商业代码签名，系统仍可能显示 Gatekeeper 或 SmartScreen 提示。

发布必须同时包含 macOS arm64、macOS x64、Windows x64 的同版本产物和签名，详情见[在线更新发布指南](docs/release/desktop-online-update.md)。

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
git diff --check
```

## 当前交付状态

- macOS arm64 DMG 已在 Apple Silicon 实机完成安装、覆盖安装、功能、性能、单实例和清理退出验收。
- macOS x64 DMG 已通过 Rosetta 核心流程，Intel 实机和 Intel 性能仍未验证。
- Windows x64 原生 NSIS 构建与实机验收已拆分为独立 Trellis 任务，不能用 macOS 交叉构建代替。
- 当前内测包未接入 Developer ID 或 Windows 商业代码签名，正式公开分发前仍需完成签名和公证流程。

Windows 后续范围见 [Windows x64 原生交付任务](.trellis/tasks/07-21-desktop-client-windows-x64/prd.md)。
