# 跨平台托管自动发布

## 目标与用户价值

建立免费的跨平台托管发布流水线，让发布者只需发起一次发布，不再手工切换 macOS、Windows 两台电脑，即可构建 macOS arm64、macOS x64、Windows x64 更新产物，并继续通过 Gitee Release 向现有客户端提供在线更新。

## 已确认事实

- 当前公开主仓库位于 Gitee，仓库尚无 `.github/workflows/`，也没有 GitHub 远端；已确认 Gitee `main` 继续作为唯一源码主线，GitHub 仅作为公开镜像和 CI 控制面。
- macOS 已具备本地三阶段发布脚本，可完成双架构签名构建、Gitee Release 上传、匿名下载校验和候选清单生成；该流程依赖发布者操作 macOS 构建机。
- Windows 客户端已配置 Tauri Updater、当前用户 NSIS、安装前关闭回调和 `windows-x86_64` 清单校验入口，但尚无托管构建、自动上传和真实在线升级发布流程。
- Tauri 的 macOS、Windows 原生产物仍须分别在对应操作系统环境构建；本任务消除的是人工维护与切换构建机，而不是将两个平台强行交叉编译到同一系统。
- 用户已同意新增公开 GitHub 镜像并使用 GitHub Actions。公开仓库使用标准 GitHub 托管 Runner 免费；收费 Larger Runner 不作为本任务依赖。
- Gitee Release 与公开 `releases/latest.json` 继续作为客户端更新源，GitHub 只承担公开代码镜像、跨平台构建和发布编排。

## 需求

- **R1**：建立公开 GitHub 镜像，并保证发布工作流开始前校验 GitHub 提交与 Gitee `main` 中待发布源码一致；Gitee `main` 是唯一源码主线，GitHub 不得产生未同步的发布源码。
- **R2**：单次发布触发后，使用免费标准 GitHub 托管 macOS、Windows Runner 完成 macOS arm64、macOS x64、Windows x64 的质量检查、Tauri 签名构建和产物归档，不依赖收费 Larger Runner 或发布者自有构建机。
- **R3**：三个目标必须使用同一 SemVer、同一源码提交和非空中文更新说明；任一目标失败或缺失时，整次发布停止，不得生成可公开发现的不完整更新。
- **R4**：Tauri 签名私钥、私钥密码和 Gitee 发布令牌只保存在 GitHub Actions Secret 或受保护发布环境中，不进入公开仓库、日志、缓存、Artifact、Release 附件或客户端安装包。
- **R5**：各构建任务只上传后续汇总所需的安装包、更新包、签名和校验元数据；GitHub Artifact 使用最短可用保留期，最终交付产物转存到 Gitee Release。
- **R6**：汇总阶段必须校验版本、目标平台、文件名、签名、大小和 SHA-256，通过 Gitee Open API 创建或复用同版本 Release，上传后再以匿名请求逐个验证下载结果。
- **R7**：三平台候选 `latest.json` 只能依据匿名校验通过的真实 Gitee 附件生成；公开清单仍是唯一客户端发布开关。候选清单生成后必须进入受保护的 GitHub Environment 等待发布者人工批准，批准前不得修改 Gitee `main` 中的公开清单。
- **R8**：现有 macOS 本地发布脚本保留为 CI 故障恢复手段；日常发布不得要求发布者登录或操作独立 macOS、Windows 构建机。
- **R9**：不改变现有客户端更新状态机、Tauri 公钥、Gitee 更新端点和免费内测签名边界；Windows 商业代码签名与 Apple Developer ID、公证仍不作为本任务前置条件。
- **R10**：日常发布由 Gitee `main` 上的版本标签 `v<SemVer>` 唯一触发；工作流必须校验标签提交中的 `package.json`、工作区 `Cargo.toml` 和 `src-tauri/tauri.conf.json` 版本一致，禁止构建未标记或标签与源码版本不一致的提交。
- **R11**：标签提交必须包含 `releases/notes/v<版本>.md`，文件内容为非空中文更新说明；构建、Gitee Release 描述和候选 `latest.json` 的 `notes` 字段统一读取该文件，禁止使用工作流临时输入覆盖。

## 验收标准

- [ ] **AC1（R1）**：GitHub 发布运行记录可追溯到与 Gitee 待发布源码一致的唯一提交，版本标签不会指向不同源码。
- [ ] **AC2（R2）**：一次触发即可在免费标准托管 Runner 上生成 macOS arm64、macOS x64、Windows x64 产物，发布者全程不操作自有跨平台构建机，账单不产生 Larger Runner 用量。
- [ ] **AC3（R3）**：三个目标的版本、源码提交和中文说明一致；模拟任一平台失败后，汇总、上传或公开清单阶段不会产生不完整发布。
- [ ] **AC4（R4）**：工作流日志、缓存、Artifact、Gitee Release 和仓库扫描均不包含签名私钥、密码或 Gitee 令牌；来自不受信任分支或外部 PR 的运行无法读取发布 Secret。
- [ ] **AC5（R5）**：GitHub Artifact 仅包含规定产物且采用最短可用保留期；Gitee 匿名下载校验完成后无需依赖 GitHub Artifact 为客户端提供更新。
- [ ] **AC6（R6）**：Gitee Release 中三个目标的附件均通过匿名状态码、文件大小和 SHA-256 校验，重试不会静默覆盖同名异内容附件。
- [ ] **AC7（R7）**：候选清单包含 `darwin-aarch64`、`darwin-x86_64`、`windows-x86_64`，且 URL 与签名来自已验证附件；工作流在受保护的 GitHub Environment 暂停并等待发布者批准，未批准或拒绝时现有公开清单保持不变。
- [ ] **AC8（R8）**：日常发布文档只要求一次发布触发与最终门禁操作；本地脚本被明确标记为故障恢复流程。
- [ ] **AC9（R9）**：现有 macOS 客户端更新继续有效，Windows x64 安装客户端可从三平台清单发现、下载并安装更高版本，失败不会修改应用数据或已登记项目。
- [ ] **AC10（R10）**：推送 `v<SemVer>` 标签后只构建该标签指向的提交；标签版本与三个版本来源不一致、标签格式错误或标签不是目标提交时，工作流在构建前失败。
- [ ] **AC11（R11）**：缺少 `releases/notes/v<版本>.md`、说明为空或不含中文时，工作流在构建前失败；Gitee Release 和 `latest.json` 使用同一份已审查说明。

## 范围外

- Linux、Windows ARM64、macOS Universal、移动端和应用商店发布。
- Apple Developer ID、公证、Windows 商业代码签名和面向陌生公众的无系统拦截安装体验。
- 收费 Larger Runner、长期自托管 Runner 和要求发布者常开两台构建机的方案。
- 修改客户端在线更新 UI、状态机、签名信任根或 Gitee 下载端点。
- 灰度通道、自动降级、自动回退和静默下载安装。
