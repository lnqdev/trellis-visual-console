# 跨平台托管自动发布技术设计

## 1. 设计目标

在保留 Gitee `main` 作为唯一源码主线、Gitee Release 作为客户端更新源的前提下，引入公开 GitHub 镜像和 GitHub Actions 标准托管 Runner。发布者只需提交版本变更与中文更新说明并推送一个 `v<SemVer>` 标签，即可自动完成 macOS arm64、macOS x64、Windows x64 的原生构建、Tauri 签名、产物汇总、Gitee 上传和匿名校验；公开 `latest.json` 前保留一次人工批准。

本任务不修改客户端更新状态机、Tauri 公钥、Gitee 更新端点、应用数据合同或现有免费内测代码签名边界。

## 2. 仓库与信任边界

### 2.1 源码主线

- Gitee `main` 是唯一源码主线，版本提交与版本标签先存在于 Gitee。
- GitHub 仓库是公开只读镜像和 CI 控制面，不承载独立开发提交。
- 优先使用 Gitee 提供的推送镜像能力同步 `main` 与标签；如果当前账号不支持，则提供单命令双远端推送脚本。无论采用哪种同步方式，发布工作流都必须校验 GitHub 标签提交与 Gitee 同名标签、Gitee `main` 的提交关系。
- GitHub 与 Gitee 同名标签指向不同提交、标签提交不属于 Gitee `main`、或任一远端缺少标签时，发布在构建前失败。

### 2.2 密钥与权限

- `TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 和 Gitee 发布令牌只保存在 GitHub Actions Secret 或受保护 Environment 中。
- 普通提交检查和外部 Pull Request 不注入发布 Secret。
- 构建任务只获得读取源码与上传短期 Artifact 的权限；汇总与发布任务才获得 Gitee 访问能力。
- 工作流禁止打印 Secret、将 Secret 写入缓存或 Artifact；必要的临时密钥文件在任务结束时删除。
- `release-production` Environment 配置人工审核者，只有通过审核的发布任务可以修改公开 `latest.json`。

## 3. 发布输入合同

版本提交必须同时包含：

1. `package.json`、工作区 `Cargo.toml`、`src-tauri/tauri.conf.json` 中一致的 SemVer。
2. `releases/notes/v<版本>.md`，内容为非空中文更新说明。
3. 指向该提交的 `v<版本>` 标签。

发布工作流只响应 `v*` 标签，不接受临时版本号或更新说明输入。校验阶段从标签解析版本，复用现有版本一致性检查，并验证说明文件名、内容和标签版本。Gitee Release 描述与 `latest.json.notes` 均读取同一说明文件。

## 4. 工作流架构

```text
Gitee main
  -> 版本提交 + releases/notes/v<版本>.md + v<版本> 标签
  -> 同步同一提交和标签到公开 GitHub 镜像
  -> validate-release
       -> build-macos (aarch64-apple-darwin)
       -> build-macos (x86_64-apple-darwin)
       -> build-windows (x86_64-pc-windows-msvc)
  -> aggregate-release
       -> 校验产物、签名、大小和 SHA-256
       -> 上传 Gitee Release
       -> 匿名下载复验
       -> 生成三平台候选 latest.json
  -> release-production（人工批准）
       -> 重新校验 Gitee 附件与候选清单
       -> 只更新 Gitee main/releases/latest.json
```

### 4.1 普通提交检查

GitHub 镜像的普通提交运行不含发布 Secret 的质量工作流，至少执行：

- `pnpm lint`
- `pnpm typecheck`
- `pnpm check:version`
- `pnpm check:rust`
- 发布脚本和工作流静态检查

普通提交不得创建 Gitee Release、上传发布附件或修改公开清单。

### 4.2 标签预检

`validate-release` 在任何签名构建前完成：

- 解析并校验 `v<SemVer>` 标签。
- 获取 Gitee 同名标签与 `main`，核对提交 SHA 和可达关系。
- 校验三个版本来源与标签版本一致。
- 校验 `releases/notes/v<版本>.md` 存在、非空且包含中文。
- 校验目标 Gitee Release 中不存在同名异内容的既有候选发布。

预检输出只包含版本、提交 SHA、说明文件路径和公开非敏感元数据。

### 4.3 平台构建

- macOS 使用标准 GitHub 托管 macOS Runner，分别构建 `aarch64-apple-darwin` 与 `x86_64-apple-darwin`。
- Windows 使用标准 GitHub 托管 Windows Runner，构建 `x86_64-pc-windows-msvc` 当前用户 NSIS。
- 三个目标使用同一标签提交、同一 Tauri 更新私钥和相同的确定性产物命名规则。
- 每个构建任务执行平台所需质量检查、Tauri 签名构建、产物重命名、SHA-256 计算和元数据生成。
- GitHub Artifact 只包含安装包、更新包、`.sig` 和不敏感的校验元数据，设置最短可用保留期；不将缓存作为发布产物来源。

禁止使用收费 Larger Runner。如果标准 macOS Runner 无法完成某个目标，工作流必须失败并回到设计评审，不能静默切换付费 Runner。

### 4.4 汇总与候选发布

`aggregate-release` 使用标准 Ubuntu Runner 下载三个平台 Artifact，并执行：

1. 校验目标集合恰好为 `darwin-aarch64`、`darwin-x86_64`、`windows-x86_64`。
2. 校验三个目标版本、源码提交、说明摘要和产物命名一致。
3. 校验每个更新包具备非空 Tauri 签名、记录大小与 SHA-256。
4. 创建或复用 Gitee 同版本 Release，并上传全部规定附件。
5. 以匿名 HTTPS 请求重新下载每个附件，核对状态码、最终 URL、大小和 SHA-256。
6. 使用真实附件 URL 与 `.sig` 内容生成三平台候选 `latest.json`。
7. 使用 `scripts/validate-update-manifest.mjs` 的三平台模式校验候选清单。

同名远端附件只有在大小和 SHA-256 完全一致时才可复用；内容不同必须失败，禁止删除或覆盖。

### 4.5 公开门禁

候选清单通过校验后进入 `release-production` Environment 等待人工批准。批准前：

- Gitee Release 可以作为不可发现的候选版本存在。
- `releases/latest.json` 保持原内容，客户端不会发现候选版本。

批准后，发布任务重新匿名校验 Gitee 附件和候选清单，拉取最新 Gitee `main`，确认标签提交仍属于主线，然后只更新 `releases/latest.json`。推送采用快进保护；主线发生无法安全合并的变化时发布失败，不强推、不覆盖其他提交。

## 5. 失败与恢复

- 任一预检或平台构建失败时，不运行汇总和公开任务。
- 任一附件上传、匿名校验或候选清单校验失败时，不进入公开门禁。
- 人工拒绝或超时未批准时，候选 Release 可以保留，公开清单不变。
- 同一标签重试必须复用同一源码、说明和确定性产物；远端内容不一致时停止，不能通过重建覆盖。
- 已公开的错误版本通过冻结或撤下 `latest.json` 阻止继续扩散；已升级客户端只接受版本号更高的修复版本，不自动降级。
- GitHub Actions 不可用时，现有 macOS 本地脚本作为故障恢复工具；在 Windows 本地恢复能力补齐前，不允许用缺少 Windows 目标的清单替代三平台正式清单。

## 6. 验证设计

### 6.1 静态与脚本验证

- 工作流 YAML 语法和引用的 Action 版本有效。
- `pnpm lint`、`pnpm typecheck`、`pnpm check:version`、`pnpm check:rust` 通过。
- 清单校验 fixture 覆盖缺少平台、版本不一致、URL 非 HTTPS、中文说明缺失和签名缺失。
- 发布脚本覆盖同名同哈希重试与同名异哈希拒绝。

除非用户另行要求，不新增独立测试类；验证优先复用现有质量命令、临时 fixture 和真实发布演练。

### 6.2 CI 发布演练

- 使用测试 SemVer 标签完成三个标准 Runner 构建，确认未产生 Larger Runner 用量。
- 人工批准前验证公开清单不变；拒绝一次门禁后验证客户端仍看不到候选版本。
- 批准后验证 Gitee `latest.json` 与候选清单一致，三个附件均可匿名下载。
- 重跑同一标签，验证不会创建同名异内容附件或重复修改公开清单。

### 6.3 真实升级矩阵

- macOS arm64、macOS x64、Windows x64 分别从已安装的较低更新器版本发现并升级到目标版本。
- 核对版本、平台、架构、更新说明、签名验证、安装或重启行为。
- 核对应用数据、已登记项目、单实例和核心只读浏览能力保持正常。
- 覆盖网络中断、用户取消、错误签名、相同或较低版本、冻结公开清单等失败场景。

## 7. 成本与运维边界

- GitHub 镜像保持公开，只使用标准托管 Runner。
- GitHub Artifact 设置最短可用保留期，最终客户端下载完全依赖 Gitee。
- 发布文档只要求版本提交、标签触发和最终一次人工批准；不要求发布者登录两台构建机。
- 任何需要付费 Runner、长期自托管机器或新增托管服务的变化都必须重新评审，不作为自动降级方案。
