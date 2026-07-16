# 阶段六验证与交付实施计划

## 实施清单

1. [x] 记录当前环境、Git 状态、构建产物和阶段五基线，建立 `/tmp` 独立验证目录。
2. [x] 创建正常、历史、焦点、无效结构、坏内容、权限故障和多项目 benchmark fixture；记录故障注入前摘要。
3. [x] 通过 HTTP 验证扫描不持久化、手动/批量登记、无效路径、重复登记和统一错误响应。
4. [x] 验证 YAML、task JSON、JSONL、非法 UTF-8、符号链接和路径越界的隔离与诊断。
5. [x] 启动真实焦点监听，捕获 Spec、Task、配置变化的 SSE；修改历史项目并确认无实时事件。
6. [x] 验证加入/移出焦点、项目删除、移动、结构缺失、权限异常后的状态、最后快照和监听器释放。
7. [x] 使用临时 TypeScript 程序和受控 watcher factory 验证原生启动失败降级、运行期错误降级、轮询失败、队列串行和幂等关闭。
8. [x] 构造多个焦点/历史项目，重启生产服务，验证焦点恢复数量、监听模式和历史零监听。
9. [x] 使用 Playwright 回归不可用恢复、历史提示、焦点状态、Markdown 安全、失效 URL、中文错误和浏览器控制台/网络。
10. [x] 采集扫描/登记耗时、监听器数量、pendingChanges、SSE 数量/大小、数据文件大小、RSS 和退出耗时；未为单次验证增加长期 heap 指标接口。
11. [x] 执行生产模式首页、静态资源、健康接口、未知 API、SSE 清理、SIGTERM 和端口立即复用验证。
12. [x] 审查 Windows/Linux 的路径、应用数据目录、Chokidar 和外部打开合同，明确实机未覆盖项。
13. [x] 对发现的缺陷执行最小修复；每次修复后重跑对应场景并更新任务记录。
14. [x] 创建 `docs/validation/phase-6-report.md`，记录环境、场景、命令、结果、指标、缺陷和平台覆盖边界。
15. [x] 更新 `README.md` 与 `docs/planning/implement.md`，把阶段六状态和交付入口同步为已完成。
16. [x] 运行最终 `pnpm lint`、`pnpm typecheck`、`pnpm build`、`git diff --check` 和生产启动检查。
17. [x] 使用 `trellis-check` 做跨层全量复核，使用 `trellis-update-spec` 固化新发现的验证或交付合同。

## 验证原则

- 默认不在仓库生成测试类；临时验证程序和 fixture 位于 `/tmp`。
- 浏览器操作优先 Playwright MCP；HTTP/SSE/进程与文件权限使用本地命令。
- 每个异常场景必须同时检查用户可见结果、注册表状态、快照保留和监听资源。
- 修改 fixture 用于触发事件属于故障注入；只读摘要比较时排除明确的注入文件，并确认产品本身没有额外写入。
- 性能结果记录实际值和环境，不把单机结果包装成跨平台结论。

## 风险文件与回滚点

- `src/server/projects/project-paths.ts`：路径边界和跨平台绝对路径判断。
- `src/server/projects/project-catalog.ts`：不可用状态、最后快照和持久化顺序。
- `src/server/realtime/project-file-watcher.ts`：真实 Chokidar 启停与权限错误。
- `src/server/realtime/project-realtime-manager.ts`：降级、队列、恢复和资源释放。
- `src/server/api/project-events-route.ts`：SSE 连接和退出清理。
- `src/server/index.ts`：生产启动、浏览器打开与信号退出。

## 最终验证命令

```bash
pnpm lint
pnpm typecheck
pnpm build
git diff --check
```

生产和异常验证使用独立 `TRELLIS_VISUAL_CONSOLE_DATA_DIR` 与端口，避免污染用户应用数据。任务结束前恢复临时目录权限并清理残留服务进程。
