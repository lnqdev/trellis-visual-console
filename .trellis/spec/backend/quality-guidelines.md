# 后端质量规范

## 必需规则

- Rust 使用 `cargo fmt`，Clippy 警告按错误处理。
- 公开方法和关键边界添加详略得当的中文注释。
- Core 与 Tauri adapter 保持单向依赖，不复制领域规则。
- 外部 YAML/JSON/JSONL/IPC 只在边界解析一次，消费者使用类型化结果。
- 源项目只读，所有应用写入限定在应用数据目录。
- 不引入第二套生产后端、本地 HTTP、遥测、前端直连更新器或 Node sidecar；在线更新只按 `desktop-updater-contract.md` 位于 Tauri adapter。

## 验证门禁

```bash
pnpm lint
pnpm typecheck
pnpm build:web
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo check --workspace --all-targets --all-features
cargo check -p trellis-core
cargo tree -p trellis-core
git diff --check
```

默认不生成测试类或仓库测试文件；高风险迁移和路径验证可使用仓库外临时 fixture/probe。
