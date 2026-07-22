# Tauri 2 Updater 调研

## 官方依据

- 文档：<https://v2.tauri.app/plugin/updater/>
- 调研日期：2026-07-22

## 结论

- Updater 必须验证 Tauri 更新签名，该校验不能关闭。
- 公钥内容写入 `tauri.conf.json`，可以公开；不能配置为本机公钥文件路径。
- 私钥通过 `TAURI_SIGNING_PRIVATE_KEY` 注入，密码通过 `TAURI_SIGNING_PRIVATE_KEY_PASSWORD` 注入，二者均不得公开。
- 私钥丢失后，已安装客户端无法接受使用新信任根签名的在线更新，只能重新手工安装过渡版本，因此必须保留离线加密备份。
- `bundle.createUpdaterArtifacts=true` 时，macOS 生成 `.app.tar.gz` 及 `.sig`，Windows NSIS 生成安装器及 `.sig`。
- 静态更新清单要求 `version` 以及各平台的 `url`、`signature`；`notes` 和 `pub_date` 可选，但本任务产品需求将非空中文 `notes` 设为必填。
- 生产端点默认强制 TLS；本任务不得开启非 HTTPS 例外。
- Rust API 支持分开下载与安装，也支持一次性 `download_and_install`；安装完成后不要求立即重启。
- Windows 安装器限制导致执行安装步骤时应用自动退出；macOS 可以在安装完成后选择立即重启或稍后正常重启。

## 仓库现状

- `src-tauri/Cargo.toml` 尚未依赖 updater 插件。
- `src-tauri/tauri.conf.json` 尚未配置更新公钥、端点或 `createUpdaterArtifacts`。
- 项目公开远端为 `https://gitee.com/wanglinqiao/trellis-visual-console.git`，没有现成 CI/发布流水线。
- `https://gitee.com/wanglinqiao/trellis-visual-console/raw/main/README.md` 可匿名访问并跳转到 Gitee 原始内容域，证明公开 raw 地址可作为清单入口；正式发布前仍须验证实际 `releases/latest.json` 和 Release 附件匿名下载。

## 设计影响

- 在线更新保留在 Tauri adapter，不进入 `trellis-core`。
- 清单是最终发布开关，必须最后更新；三个目标产物不完整时禁止发布清单。
- 免费内测只免除 Apple/Windows 商业代码签名费用，不免除 Tauri 更新签名。
- macOS 的“稍后重启”无需自行持久化下载包：安装已完成，只延迟进程切换。
