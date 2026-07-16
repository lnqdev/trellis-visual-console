# 阶段二本机注册表与摘要快照实施计划

## 实施清单

1. 添加 `zod` 依赖。
2. 实现跨平台应用数据目录解析和开发验证覆盖变量。
3. 使用 Zod 定义注册表、项目快照、Spec 树、Task 摘要、Workflow 摘要和诊断结构。
4. 实现通用版本化 JSON 文件存储：缺失初始化、读取校验、版本拒绝、损坏隔离、原子写入和写队列。
5. 实现 `ApplicationStorage`，固定管理 `registry.json` 和 `snapshots.json`。
6. 在本地服务监听前初始化存储，并记录恢复事件。
7. 使用临时应用目录执行手工验证：默认创建、往返保存、损坏恢复、版本拒绝和并发保存。
8. 使用独立临时源项目验证删除应用数据不影响源文件。
9. 复核依赖和代码，确认没有扫描、解析、监听、SSE、API 或 UI 扩展。
10. 运行 `pnpm lint`、`pnpm typecheck`、`pnpm build`，再验证生产服务健康接口。

## 风险文件与回滚点

- `json-file-store.ts`：任何失败都不能把不兼容版本误判为损坏并覆盖。
- `models.ts`：Schema 是存储合同唯一来源，禁止另写一套平行接口。
- `application-paths.ts`：默认路径必须在应用数据目录，不能根据项目路径拼接。
- `src/server/index.ts`：存储初始化失败应阻止服务启动，但不能改变监听主机和既有路由。

## 验证命令

```bash
pnpm lint
pnpm typecheck
pnpm build
TRELLIS_VISUAL_CONSOLE_DATA_DIR=<临时目录> pnpm start
curl http://127.0.0.1:3100/api/health
```

复杂存储场景使用构建产物配合 Node 内联脚本在临时目录验证，不在仓库生成测试文件。

## 启动前复核

- 需求只覆盖 `docs/planning/implement.md` 阶段二。
- 没有注册表 CRUD API、扫描器、解析器、监听器或页面实现。
- 注册表与快照只写应用数据目录。
- 损坏恢复和不兼容版本行为已经明确区分。
