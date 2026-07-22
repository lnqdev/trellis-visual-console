# 桌面端在线更新实施计划

## 1. 配置与信任根

- [x] 将 workspace、前端包和 Tauri 配置版本统一升级为 `0.2.0-beta.1`，增加版本一致性检查。
- [x] 接入 `tauri-plugin-updater` 及重启所需的 Tauri 能力，配置 HTTPS `latest.json` 端点、内置公钥和 `createUpdaterArtifacts=true`。
- [x] 生成开发/内测更新密钥对；仅提交公钥，确认私钥和密码未进入 Git，并记录离线加密备份操作说明。
- [x] 更新 capability，保持前端没有任意网络、文件系统或 opener 权限。

## 2. Rust 桌面适配

- [x] 在 `src-tauri/src/system/` 实现更新检查时间的版本化原子存储，独立于 `trellis-core` 存储。
- [x] 在 `AppState` 增加更新会话、并发保护和检查时间存储，不改变 Core 生命周期。
- [x] 新增检查、下载安装和重启 Command，提供中文注释、稳定 DTO、Channel 进度与错误映射。
- [x] 处理 24 小时自动检查、手动绕过、并发检查、无待更新、网络失败、清单失败、签名失败、平台不匹配、安装失败和关闭竞态。
- [x] 扩展受控日志事件，确保不记录下载地址、签名、密钥或插件错误原文。

## 3. 共享合同与前端

- [x] 在 `src/shared/api.ts` 增加检查结果、更新元数据、进度与重启响应 Schema。
- [x] 在 `src/web/api-client.ts` 增加对应 Command 客户端，所有成功值和错误值继续经过 Zod 校验。
- [x] 新增 `useApplicationUpdater` 管理自动检查、手动检查、待更新、进度、失败和重启状态，不并入项目业务状态。
- [x] 在应用可操作后触发 `automatic` 检查；诊断页增加当前版本、内测标识和手动检查入口。
- [x] 在全局侧边栏持续显示构建版本，保证无项目、任务中心及更新断网时仍可核对重启后版本。
- [x] 实现更新提示与确认界面，展示目标版本、非空中文说明、下载进度及平台对应重启文案；macOS 支持立即/稍后重启，Windows 安装前明确退出提示。
- [x] 完成 375/768/1024/1440 响应式、键盘、`aria-live` 和无横向滚动检查。

## 4. 发布材料

- [x] 新增不启用发布开关的 `releases/latest.example.json` 模板与发布清单校验脚本，要求三个标准平台键、同一 SemVer、HTTPS URL、非空签名和中文说明。
- [x] 编写手动发布指南：统一版本、环境变量、三平台原生构建、签名文件、SHA-256、Gitee Release 上传、匿名下载验证和最后发布清单。
- [x] 记录 `0.1.0 -> 0.2.0-beta.1` 一次性手工安装说明、Gatekeeper/SmartScreen 提示、私钥恢复限制及 Gitee 故障处理。
- [x] 更新 README、桌面运行时/Command/存储/日志/前端合同，使受控联网与在线更新成为明确例外。

## 5. 验证命令

```bash
pnpm lint
pnpm typecheck
pnpm build:web
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo check --workspace --all-targets --all-features
cargo check -p trellis-core
git diff --check
```

另执行发布清单校验脚本、仓库外 Playwright IPC mock 和三平台真实升级矩阵。

- [x] 本机执行全部静态门禁、版本一致性检查和示例清单校验。
- [x] 仓库外临时 IPC mock 完成 375/768/1024/1440 更新 UI、焦点、Escape 和零横向滚动验收，mock 已从源码删除。
- [ ] 三平台真实升级矩阵须在发布 `latest.json` 前完成。

## 6. 真实升级矩阵

- [ ] macOS arm64：手工安装 `0.2.0-beta.1`，升级到更高测试版，覆盖立即重启、稍后重启且不重复下载、错误签名、断网恢复、唯一安装副本和挂载清理。
- [ ] macOS x64：在 Rosetta 下完成相同核心升级流程，明确保留 Intel 实机缺口（如仍无 Intel Mac）。
- [ ] Windows x64：在实体机完成当前用户 NSIS 升级、安装时退出、重启新版本、SmartScreen 说明和应用数据保留。
- [ ] 三平台均验证相同/较低版本不更新、错误架构不更新、24 小时限频、手动检查、中文说明和主业务可继续浏览。
- [ ] 演练缺少任一平台时清单拒绝发布、冻结问题版本、发布更高修复版本和匿名下载。

## 7. 风险与回滚点

- 私钥丢失是不可在线恢复的最高风险；完成加密备份前不得发布 `0.2.0-beta.1`。
- `latest.json` 是最终发布开关；三个平台验证完成前不修改公开清单。
- 更新依赖或 Command 合同出现回归时，回退本任务代码和配置，不修改 `trellis-core` 业务数据格式。
- 已发布问题版本只冻结清单并向前修复，不执行自动降级。
- 真实安装验收使用隔离应用数据和明确目标安装路径，清理前区分既有用户副本与本轮测试副本。

## 8. 启动实现前检查

- [x] 用户已审阅 `prd.md`、`design.md` 和 `implement.md`。
- [ ] 已确认公开 Gitee Release 和 `raw/main/releases/latest.json` 均允许匿名访问。
- [ ] 已确定可用的 macOS arm64/x64 与 Windows x64 原生构建、签名和验收环境。
- [x] 已准备 Tauri 更新私钥的安全生成与离线备份位置。
