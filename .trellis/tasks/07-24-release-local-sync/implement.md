# 本地脚本同步 GitHub Release 到 Gitee 实施记录

## 改动清单

- [x] **`release.yml`**：`permissions.contents` 改为 `write`；aggregate job 删除 Gitee 上传步骤，新增 `gh release create` 上传到 GitHub Releases（含安装包、更新包、签名、校验文件、元数据）；整个 `publish` job 删除。
- [x] **`scripts/release-github.mjs`**（新增）：`pullGithubRelease(tag, outputRoot, proxy)` —— 通过 GitHub API 查询 Release 附件列表，逐个下载到本地，下载完成后按 `release-metadata.json` 中的 SHA-256 逐一校验完整性；支持 `--proxy` 参数为大文件下载加速。
- [x] **`scripts/release-local.mjs`**（新增）：本地发布入口，`upload-to-gitee --tag <版本> [--proxy <代理>]` 命令；内部串联四步：① 从 GitHub Release 下载产物 → ② 创建/复用 Gitee Release → ③ 上传附件并匿名校验 → ④ 生成并提交 `latest.json`；临时目录用后自动清理；复用全部现有 Gitee 业务逻辑。
- [x] **`package.json`**：新增 `release:local` 脚本入口。

## 提交

| Hash | Message |
|------|---------|
| `81ea757` | feat(release): 本地脚本同步 GitHub Release 到 Gitee |

## 使用方式

```bash
# 配置 Gitee Token（只需一次）
export GITEE_RELEASE_TOKEN=<your-token>

# CI 跑完后，本地执行（国内建议带 --proxy）
pnpm release:local -- upload-to-gitee --tag v0.2.0-beta.7 --proxy https://gh.lnqdev.top
```

## 待验证

- [ ] 推 tag 后 GitHub Actions aggregate job 正常创建 GitHub Release
- [ ] 本地 `pnpm release:local` 完整流程跑通
- [ ] Gitee Release 产物与 GitHub Release 一致
- [ ] 应用内更新检查读取新版 `latest.json` 正常
