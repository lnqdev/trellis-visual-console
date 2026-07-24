# 本地脚本将 GitHub Release 同步到 Gitee

## 目标与用户价值

解决跨平台发布流水线中 GitHub Actions（美国服务器）直接上传大文件到 Gitee 耗时过长的问题。改为 CI 只负责构建和上传到 GitHub Releases（留在 GitHub 内网，极快），由开发者在国内本地运行一条命令完成 Gitee 同步，彻底绕开跨境传输瓶颈。

## 已确认事实

- GitHub Actions 上传安装包到 Gitee 是当前流水线最慢的步骤，原因是 GitHub 服务器（美国）到 Gitee（中国）跨境网络延迟高、带宽受限。证据：用户实测反馈。
- 项目已有完整的 Gitee 上传脚本（`scripts/release-gitee.mjs`）和发布编排（`scripts/release-ci.mjs`），可直接复用。证据：`scripts/release-gitee.mjs`、`scripts/release-ci.mjs`。
- 已通过 Cloudflare Worker 自建代理 `gh.lnqdev.top`，国内可访问，可用于加速从 GitHub 下载文件。证据：用户测试 `https://gh.lnqdev.top/https://github.com/dwgx/WindsurfAPI/releases/download/v3.5.0/windsurfapi.exe` 返回 HTTP 200。
- GitHub Releases 对公开仓库完全免费，单文件上限 2 GB，不计带宽费用。
- `workers.dev` 默认域名在国内被墙，需绑定自定义域名才可正常访问。证据：用户测试反馈。
- Gitee Go 收费，不适合作为免费 CI 方案。证据：用户确认。

## 需求

- **R1**：CI（GitHub Actions）构建完成后将产物上传到 GitHub Releases，不再直接上传到 Gitee，消除跨境传输耗时。
- **R2**：提供本地命令 `pnpm release:local -- upload-to-gitee --tag <版本> [--proxy <代理>]`，开发者在国内环境执行后完成 Gitee 同步和 `latest.json` 发布。
- **R3**：本地脚本从 GitHub Release 下载产物时，支持通过代理加速；下载完成后用 `release-metadata.json` 中记录的 SHA-256 逐一校验文件完整性。
- **R4**：本地脚本复用现有 Gitee 上传和清单发布逻辑，不重复实现业务。
- **R5**：下载的临时文件使用系统临时目录，脚本结束后自动清理，不污染仓库目录。
- **R6**：人工批准门禁（原 GitHub Actions `environment: release-production`）改为本地手动决策——开发者确认构建无问题后再执行本地同步命令。

## 验收标准

- [ ] **AC1**：推 `v*` tag 后，GitHub Actions aggregate job 成功创建 GitHub Release 并上传全部产物（安装包、更新包、签名、校验文件、元数据），无 Gitee 上传步骤。
- [ ] **AC2**：`pnpm release:local -- upload-to-gitee --tag <版本> --proxy https://gh.lnqdev.top` 在国内可成功执行，流程包括下载 → SHA-256 校验 → 上传 Gitee → 发布 `latest.json`。
- [ ] **AC3**：执行完成后，Gitee Release 包含与 GitHub Release 一致的产物，`releases/latest.json` 更新为新版本。
- [ ] **AC4**：Tauri 应用内更新检查可从 Gitee 读取新版 `latest.json`，下载地址指向 Gitee Release 产物。
- [ ] **AC5**：本地脚本执行完成后系统临时目录中不残留产物文件。

## 范围外

- 自动化触发（定时、Webhook、Gitee Go 等）。
- Windows 或 Linux 的特殊适配（脚本使用 Node.js，跨平台通用）。
- 改变 Tauri 更新签名机制或 `latest.json` 的端点地址。
