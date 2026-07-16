# 阶段三项目扫描与内容解析实施计划

## 实施清单

1. 添加 `yaml` 依赖。
2. 定义项目发现、校验、登记、Markdown 读取结果类型和 Trellis 配置/任务兼容 Schema。
3. 实现稳定 ID、项目相对路径和 realpath 包含关系工具。
4. 实现 Trellis 项目结构校验。
5. 实现忽略目录、跳过符号链接的递归项目扫描。
6. 实现配置包解析和 Spec 树生成。
7. 实现活动/归档 Task 摘要、活动 PRD 缺失诊断和 JSONL 逐行校验。
8. 实现 Workflow 名称、阶段标题和当前阶段推断。
9. 组装 `ProjectSnapshot`，保证单文件错误不会中断项目索引。
10. 实现项目扫描候选、单个登记和批量登记编排，接入注册表与快照存储。
11. 实现受 `.trellis` realpath 边界保护的 Markdown 按需读取。
12. 用临时 fixture 验证扫描、忽略目录、链接逃逸、单仓库、monorepo、坏文件、重复登记和 Markdown 安全。
13. 用当前项目和原 Trellis 仓库执行真实索引，检查任务数量、包信息和诊断容错。
14. 复核范围，确认没有新增路由、UI、监听、SSE 或 Core SDK。
15. 运行 `pnpm lint`、`pnpm typecheck`、`pnpm build`。

## 风险文件与回滚点

- `project-paths.ts`：任何路径边界缺陷都可能导致读取 `.trellis` 外文件。
- `project-scanner.ts`：必须跳过符号链接和大型构建目录，不能递归进入候选 `.trellis`。
- `trellis-indexer.ts`：单个坏文件只能产生诊断，不能丢失其他有效摘要。
- `project-catalog.ts`：快照和注册表保存顺序不可颠倒。
- `storage/models.ts`：若修改快照合同，必须同步 Zod Schema 和存储规范。

## 验证命令

```bash
pnpm lint
pnpm typecheck
pnpm build
```

复杂文件系统场景使用构建产物配合 Node 内联脚本在临时目录验证，不在仓库生成测试文件。

## 启动前复核

- 仅覆盖 `docs/planning/implement.md` 阶段三。
- 扫描不会自动持久化；只有显式登记才更新应用数据。
- Markdown 读取只接受项目内相对 `.md` 路径。
- 历史快照不保存 Markdown 正文。
