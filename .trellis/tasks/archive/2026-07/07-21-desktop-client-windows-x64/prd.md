# 桌面客户端 Windows x64 原生交付

## Goal

在 Windows x64 实体机完成 Trellis Visual Console 的原生构建、中文 NSIS 安装器和平台验收，承接 `07-20-desktop-client` 中因 Windows 机器暂不可用而后置的交付范围。

## Background

- `07-20-desktop-client` 已完成 Tauri 2、独立 Rust Core、React Command/Event 通信、版本 2 存储、原生监听、日志、清理和跨平台构建配置。
- macOS arm64/x64 构建与验收已经独立闭环；Windows 平台中立代码检查不能替代 Windows 原生行为验证。
- 当前没有可用的 Windows 实体机，本任务保持 `planning`，取得符合要求的机器后再激活。
- 本任务以现有桌面实现为基线，只处理 Windows 构建、平台缺陷修正和原生验收，不重新设计产品或恢复 Node/Fastify 后端。

## Requirements

### 环境与产物

- **R1**：必须在 Windows 10 22H2 或 Windows 11 的 x64 实体机执行，macOS 交叉构建、Wine 或静态审查不能替代原生结果。
- **R2**：使用 Rust stable、`x86_64-pc-windows-msvc`、MSVC Build Tools、Node.js 与 pnpm 构建；最终安装后的客户端不得依赖用户预装这些工具。
- **R3**：生成中文 x64 NSIS `setup.exe`，采用当前用户安装模式，不要求管理员权限，缺少 WebView2 时使用官方在线 bootstrapper。
- **R4**：安装包不超过 30 MiB；若 WebView2 固有开销导致预算需要调整，必须记录实测证据并重新获得用户批准。
- **R5**：应用名称、图标和 bundle identifier 与 macOS 交付保持一致；当前包允许未签名内测，但必须保留 SmartScreen 安全说明。

### 安装、数据与卸载

- **R6**：验证首次安装、正常启动、同版本覆盖安装和卸载，安装及运行不开放本地 HTTP 端口，也不启动 Node/Go sidecar。
- **R7**：验证 Windows 版本 1 应用数据向版本 2 迁移，保留原注册表和快照备份，迁移失败不得覆盖原字节。
- **R8**：NSIS 卸载器必须询问是否删除应用数据并默认保留；选择删除时只能删除 `%APPDATA%\Trellis Visual Console`，不得触碰已登记 Trellis 项目。
- **R9**：卸载时选择保留数据后，重新安装必须恢复原项目列表和焦点状态；选择删除后，重新安装必须进入空数据状态。

### 功能与平台边界

- **R10**：验证项目扫描、登记、焦点切换、项目概览、任务中心、Spec、Task、Workflow、诊断、目录选择、日志目录和受控外部打开。
- **R11**：验证中文本地路径、UNC 路径、盘符绝对路径、原始 `..`、项目外路径和可用条件下的 junction/符号链接边界；源项目始终只读。
- **R12**：验证 Windows 原生文件监听、300ms 防抖、事件刷新、监听失败后的 10 秒轮询降级、恢复和退出资源释放。
- **R13**：验证单实例；第二次启动只聚焦现有窗口，不增加 watcher、后台任务或数据写入者。
- **R14**：验证日志最多 5 个文件、每个不超过 2 MiB，且不包含项目绝对路径、正文、令牌、命令参数或底层错误原文。

### 隐私、离线与性能

- **R15**：除安装阶段按需下载 WebView2 外，客户端运行期不得主动联网；在 WebView2 已就绪后完成完整离线核心流程。
- **R16**：在 28 个登记项目、2 个焦点项目的基准场景下，冷启动到窗口可操作不超过 2 秒，稳定 RSS 不超过 250 MiB（Windows 调整：WebView2 Runtime 子进程固有开销约 140 MiB，macOS 的 180 MiB 预算对 Windows 偏紧，按 R4 先例调整并记录实测证据），连续 5 分钟空闲平均 CPU 低于 1%，关闭窗口后 1 秒内退出。
- **R17**：记录包大小、启动时间、应用进程树内存、5 分钟空闲 CPU、退出耗时和运行期网络审计证据。

## Acceptance Criteria

- [ ] **AC1（R1-R5）**：Windows x64 实体机原生构建成功，产出符合架构、安装模式、WebView2 和 30 MiB 预算的中文 NSIS 安装器。
- [ ] **AC2（R6）**：首次安装、启动、覆盖安装和卸载通过；生产进程无 Node/Go sidecar、本地 HTTP 监听或系统浏览器依赖。
- [ ] **AC3（R7-R9）**：版本 1→2 迁移、失败保护、卸载保留/删除选择和重装恢复均通过，默认选择为保留数据。
- [ ] **AC4（R10）**：完整业务流程和所有 Windows 原生系统入口可用，用户可正常浏览真实 Trellis 项目。
- [ ] **AC5（R11）**：中文路径、UNC 与路径逃逸矩阵通过，清理及卸载前后源项目内容和 Git 状态不变。
- [ ] **AC6（R12、R13）**：原生监听、轮询降级、事件刷新、单实例和退出资源释放通过。
- [ ] **AC7（R14）**：日志轮转和脱敏通过，诊断页可以打开日志目录。
- [ ] **AC8（R15）**：WebView2 已就绪后，断网不影响核心功能；运行期没有遥测、上传、更新检查或其他非用户发起请求。
- [ ] **AC9（R16、R17）**：启动、内存、CPU、退出和包大小满足预算，验证报告记录完整原始证据。
- [ ] **AC10**：Windows 验证报告明确记录系统版本、硬件、WebView2 状态、安装器 SHA-256、已通过项和任何保留缺口。

## Out of Scope

- Windows ARM64、Windows 7/8、Windows 10 22H2 之前版本。
- MSI、Microsoft Store、免安装压缩包和管理员级全局安装。
- Windows 商业代码签名和面向公众的自动发布流水线。
- macOS 回归、产品功能扩展、UI 重设计、自动更新和 Node/Fastify 生产模式。

## Related Task

- 来源任务：`.trellis/tasks/07-20-desktop-client`
- macOS 验收记录：`docs/validation/desktop-client-macos.md`
