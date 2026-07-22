# 版本更新说明

每个托管发布版本必须在版本提交中包含 `v<SemVer>.md`，例如 `v0.2.0-beta.5.md`。

- 文件名版本必须与 `package.json`、工作区 `Cargo.toml`、`src-tauri/tauri.conf.json` 和 Git 标签一致。
- 内容必须非空并包含中文，使用 Markdown 编写。
- Gitee Release 描述和 `latest.json.notes` 只能读取该文件，不接受 CI 临时输入覆盖。
- 文件不得包含签名私钥、密码、Gitee 令牌或其他敏感信息。

使用 `pnpm release:prepare -- <版本> <中文说明...>` 同步三个版本来源并生成说明文件；命令不会提交、创建标签、推送或构建平台安装包。
