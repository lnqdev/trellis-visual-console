# 桌面客户端（macOS 交付与跨平台基础）

## Goal

将 Trellis Visual Console 从“启动本地服务后在浏览器中使用”升级为 Tauri 桌面客户端，完成共享跨平台运行时和 macOS arm64/x64 安装交付，让 macOS 用户无需准备 Node.js、pnpm 或手工启动服务即可使用。

## 范围变更（2026/7/21）

- 用户决定先完成并使用 macOS 版本；Windows 机器当前不可用。
- Windows x64 原生构建、NSIS 安装器、WebView2、Windows 路径/监听/性能/卸载和实机验收已拆分到独立任务 `.trellis/tasks/07-21-desktop-client-windows-x64`。
- 当前任务继续保留已经完成的 Windows 平台代码、图标和构建配置，但 Windows 原生结果不再阻塞当前任务完成。
- macOS 运行期零 TCP/UDP 连接审计已经通过；主动断网的完整离线流程按用户要求后置，不作为本轮 macOS 安装使用的阻塞项。

## Background

- 当前产品是个人本机使用的 Trellis 只读控制台，用于集中浏览多个项目的 Spec、Task、Workflow 和诊断信息，不替代 Trellis CLI，也不修改被查看项目。证据：`README_CN.md:5-15`、`README_CN.md:114-122`。
- 当前架构为 React Web UI + Fastify 本地服务，通过 HTTP 与 SSE 通信；生产模式由服务托管 Web 构建产物并自动打开浏览器。证据：`README_CN.md:30-48`、`README_CN.md:77-88`、`src/server/index.ts:51-65`、`src/server/index.ts:146-155`。
- 现有应用数据目录已经区分 macOS 与 Windows，注册表和摘要快照可以作为桌面客户端迁移来源。证据：`README_CN.md:96-112`、`src/server/storage/application-paths.ts:39-56`。
- 现有目录选择能力通过 Windows PowerShell/WinForms 与 macOS AppleScript 实现，桌面版将以 Tauri 原生能力替换。证据：`src/server/system/directory-picker.ts:4-28`、`src/server/system/directory-picker.ts:57-94`。
- 既有设计已把 Electron/Tauri 视为可复用 Web UI 与本地服务能力的后续方向，但尚未承担安装包、签名和跨平台发布成本。证据：`docs/planning/design.md:149-166`、`README_CN.md:156-164`。
- 当前 Web 形态已在 Apple Silicon macOS 实机验证；Windows 只有平台中立审查，原生文件事件、权限、外部打开和进程退出尚未实测。证据：`README_CN.md:134-145`。
- 本项目历史会话没有已确定的桌面框架决策；本次访谈已经完成技术、范围、兼容、性能、分发和隐私取舍。

## Requirements

### 产品与架构

- **R1**：共享桌面实现保持 macOS 与 Windows 的代码和构建边界；当前任务交付 macOS，安装后不依赖用户预装 Node.js 或 pnpm。
- **R2**：客户端必须保持项目发现、登记、只读浏览、文件监听、实时失效刷新和诊断能力；源项目 `.trellis/` 始终是唯一事实来源。
- **R3**：客户端继续保持本机、只读和最小权限边界，不开放局域网或公网访问，不新增对被查看项目的写操作。
- **R4**：保留现有 React、TypeScript、Vite 界面和前端业务逻辑，桌面迁移不重写组件体系。
- **R5**：当前交付范围包含桌面运行时、macOS arm64/x64 安装包、应用数据兼容、生命周期清理和 macOS 真实环境验证；Windows 原生验证由独立任务承担。
- **R6**：第一版只完成现有控制台的桌面迁移与跨平台分发，不借此新增其他业务能力。
- **R7**：第一版面向个人和小范围内测；正式公开分发所需的完整签名、公证和自动发布体系不是验收前置条件，但设计不得阻塞后续补齐。
- **R8**：桌面框架采用 Tauri 2，运行效率与常驻内存优先于最小改造量和最快套壳速度。
- **R9**：Node.js/Fastify 后端的文件读取、索引、监听和存储迁移到 Rust，系统集成迁移到桌面适配层；不捆绑 Node.js 或 Go sidecar，首版前后端改用 Tauri Command 与 Event 通信。
- **R10**：桌面客户端是首版唯一生产运行形态，不继续提供独立 Node/Fastify + 浏览器生产模式；开发环境仍使用 Tauri 开发流程与 Vite 热更新。
- **R30**：Rust 业务后端必须拆分为不依赖 Tauri、HTTP 框架或窗口 API 的独立 `trellis-core` crate；Tauri 只承担桌面适配。未来可以新增 Axum HTTP/SSE 适配层复用同一 Core，但首版不创建或交付 Web 服务。

### 数据与兼容

- **R11**：首次启动自动识别现有 `registry.json`，校验成功后无感继承项目 ID、路径、名称、状态和时间数据；迁移前保留备份，失败时保留原文件并明确提示，禁止静默清空。
- **R12**：旧 `snapshots.json` 不作为迁移后的可信运行数据；保留备份后由 Rust 根据已登记项目重新索引生成，源项目不被修改。
- **R19**：应用名称保持 `Trellis Visual Console`，项目标识为 `trellis-visual-console`，bundle identifier 为 `com.wanglinqiao.trellis-visual-console`，继续使用现有 `Trellis Visual Console` 应用数据目录。
- **R28**：卸载时允许用户选择保留或删除应用自有数据；任何清理只能处理程序安装文件和固定应用数据目录，不得读取、修改或删除已登记 Trellis 项目。
- **R29**：Windows NSIS 卸载器询问是否删除应用数据并默认保留；macOS 在应用菜单或诊断区提供“清除本地数据并退出”，明确删除范围并二次确认，不额外提供卸载脚本或卸载器。

### 平台与分发

- **R13**：当前任务构建 macOS arm64 与 macOS x64，不生成 Universal；Windows x64 产物由独立任务构建。
- **R14**：当前任务正式支持 macOS 13 Ventura 及以上；Windows 系统版本矩阵由独立任务验收。
- **R16**：macOS 单架构安装包不超过 30 MiB；Windows 包大小和 WebView2 预算由独立任务验证。
- **R17**：macOS 分别交付 arm64 DMG 与 x64 DMG，文件名明确标识架构。
- **R18**：在 Apple Silicon macOS 完成 arm64 实机验证，并通过 Rosetta 完成 x64 核心流程；Windows x64 原生交付后置到独立任务。
- **R20**：新增一套简洁的 Trellis 风格桌面图标，并生成 macOS/Windows 构建所需的全部尺寸和格式。
- **R25**：macOS x64 开发阶段允许在 Apple Silicon + Rosetta 下验证；没有 Intel Mac 时必须标明“已通过 Rosetta，未完成 Intel 实机验证”，且不得把 Apple Silicon 性能数据当作 Intel 结论。

### 性能、隐私与生命周期

- **R15**：在 28 个登记项目、2 个焦点项目的基准场景下，macOS 冷启动到窗口可操作不超过 2 秒；焦点恢复不得阻塞窗口；稳定空闲时整个应用进程树内存不超过 150 MiB；连续 5 分钟空闲平均 CPU 低于 1%；关闭窗口后 1 秒内释放资源并退出。
- **R21**：不采集遥测、分析数据或设备标识，不自动上传崩溃和日志，macOS 应用运行期不主动访问网络。
- **R22**：只在应用日志目录保存结构化诊断日志，最多 5 个文件、每个不超过 2 MiB；禁止记录项目绝对路径、源文件正文、密钥、命令参数或底层文件系统原始错误，只记录稳定项目 ID、错误类型、生命周期、恢复数量和监听降级状态。
- **R23**：提供“打开日志目录”入口，由用户主动决定是否提供日志。
- **R24**：客户端单实例运行；第二次启动只显示并聚焦已有主窗口。关闭主窗口即退出并释放监听器、后台任务和日志资源，不隐藏到后台，不提供托盘或多窗口。

### 功能与界面

- **R26**：首版完整迁移当前 Web 版本全部业务能力与信息架构，包括项目发现与登记、三态项目管理、项目概览、跨项目任务中心、Spec/Task/Workflow/诊断、父子任务关系、筛选搜索、选择状态同步、文件监听与轮询降级、实时刷新和安全外部打开，不允许未经批准的功能删减。
- **R27**：首版不进行整体 UI 重设计，保留现有响应式布局、中文错误、只读交互和信息结构；只增加或调整桌面运行必需的初始化状态、应用图标、日志入口、数据清理与通信状态。

## Acceptance Criteria

- [x] **AC1（R1、R8-R10）**：macOS 安装包可独立启动；生产运行没有 Node/Go sidecar、本地 HTTP 监听或系统浏览器依赖，全部前后端调用通过 Tauri Command/Event 完成。
- [x] **AC2（R2、R4、R6、R26、R27）**：使用同一组 Trellis fixture 对照旧 Web 基线，项目、任务中心、Spec/Task/Workflow/诊断、状态转换、筛选、实时刷新、响应式布局和中文错误均功能对等，没有未经批准的功能缺口。
- [x] **AC3（R3）**：扫描、索引、正文读取、外部打开和数据清理覆盖绝对路径、原始 `..`、符号链接与 realpath 逃逸；所有越界请求被拒绝，验证前后真实项目内容与 Git 状态不变。
- [x] **AC4（R11、R12、R19）**：现有版本 1 数据迁移后保留原 ID、项目列表和焦点状态；原注册表与快照存在可追溯备份，新快照由 Rust 重建，迁移失败不覆盖原字节。
- [x] **AC5（R13、R14、R17、R19、R20）**：产出并验证 macOS arm64/x64 DMG；名称、图标、架构标识、系统版本、首次安装和覆盖安装符合要求。
- [x] **AC6（R5、R18）**：macOS arm64 实机完成安装、启动、目录选择、项目读取、文件更新、数据迁移、外部打开、清理和退出验收；x64 通过 Rosetta 核心流程。
- [x] **AC7（R15、R16）**：macOS 已记录启动时间、应用进程树内存、5 分钟空闲 CPU、包大小和退出耗时，并满足全部预算。
- [x] **AC8（R21）**：运行期网络审计确认没有 TCP/UDP 连接或监听；主动断网的完整离线流程按用户要求后置。
- [x] **AC9（R22、R23）**：日志轮转上限生效，抽查不含绝对项目路径、正文、令牌、命令参数或底层错误原文；界面可以打开日志目录。
- [x] **AC10（R24）**：已有实例运行时再次启动只聚焦原窗口，不增加 watcher、后台任务或数据写入者；关闭主窗口后在 1 秒内完全退出。
- [x] **AC11（R25）**：macOS x64 DMG 完成 Rosetta 安装与核心流程验证，交付材料明确保留 Intel 实机和性能缺口。
- [x] **AC12（R28、R29）**：macOS 可在确认后清除固定应用数据目录并退出，真实清理前后源 Trellis 项目和 Git 状态不变。
- [x] **AC13（R7）**：未签名内测包文档明确说明 Gatekeeper 安全打开方式，构建配置不阻塞后续正式签名与公证。
- [x] **AC14（R30）**：`trellis-core` 可以独立编译，其正常依赖树和公开接口不包含 Tauri、Axum、Actix、窗口或插件类型；Tauri Command/Event 只通过 Core 应用服务和事件端口适配。

## Out of Scope

- 当前任务不执行 Windows x64 原生构建、NSIS 安装器和实机验收；这些内容由 `.trellis/tasks/07-21-desktop-client-windows-x64` 管理。
- Linux、Windows ARM64、macOS Universal 安装包。
- macOS 12 及更早版本、Windows 10 22H2 之前版本、Windows 7/8。
- Windows MSI、Microsoft Store 包、免安装压缩包。
- 团队账号、远程访问、云同步和跨机器共享。
- 托盘常驻、开机启动、自动更新、多窗口、多实例和应用内编辑。
- Apple Developer ID 公证、Windows 商业代码签名和面向公众的自动发布流水线。
- 长期维护功能等价的 Node 与 Rust 两套生产后端。
- 首版 Rust HTTP/SSE 服务、浏览器生产入口、远程 Web 访问、登录、TLS、CORS 和跨机器路径模型。
