# 阶段四焦点项目与实时更新实施计划

## 实施清单

1. 添加 Chokidar 5 运行依赖，保持现有 Node.js 版本合同。
2. 定义共享的项目实时事件、资源范围、监听模式和运行时状态类型。
3. 实现进程内 `ProjectEventHub`，支持订阅、取消订阅和隔离订阅者异常。
4. 实现 `ProjectFileWatcher` 接口与 Chokidar 适配器，限制监听路径、关闭符号链接跟随并支持原生/轮询模式。
5. 扩展 `ProjectCatalog`：按 ID 读取已登记项目、刷新已登记项目、保存状态迁移、标记不可用，并使用全局队列保护跨文件读改写。
6. 实现 `ProjectRealtimeManager` 的项目级串行队列和运行时监听状态 Map。
7. 实现聚焦流程：索引并保存快照、启动原生监听、失败时轮询降级、持久化 `focus`、发布事件；中途失败释放已创建资源。
8. 实现移出焦点流程：持久化 `history`、取消防抖、关闭监听器并保留快照。
9. 实现文件路径归一化、允许范围校验、Set 去重、300ms 防抖和批量资源分类。
10. 实现文件批次后的项目级重新索引、Spec/Task/项目失效事件和 `project-reindexed` 事件。
11. 实现项目移动、删除、权限或结构失效后的 `unavailable` 迁移、旧快照保留、监听释放和事件发布。
12. 实现原生监听运行期错误后的单次轮询降级，避免重复创建监听器或降级循环。
13. 实现应用启动恢复：只恢复持久化 `focus` 项目；单项目失败不阻塞其他焦点项目。
14. 将管理器接入服务启动和 Fastify `onClose`，保证系统信号统一释放实时资源。
15. 使用临时 fixture 验证历史零监听、聚焦顺序、事件批处理、取消聚焦、不可用、启动恢复和轮询降级，不新增测试文件。
16. 复核只读与范围边界，确认没有新增查询 API、SSE HTTP 路由、UI 或 Core SDK。
17. 运行 `pnpm lint`、`pnpm typecheck`、`pnpm build`。

## 风险文件与回滚点

- `src/server/projects/project-catalog.ts`：跨注册表和快照的读改写必须整体串行，不能破坏既有“快照先保存”顺序。
- `src/server/realtime/project-realtime-manager.ts`：聚焦、取消聚焦、重索引和降级存在竞态，所有项目级操作必须进入同一队列。
- `src/server/realtime/project-file-watcher.ts`：监听路径必须固定在 Trellis 展示范围，不能跟随符号链接或监听项目源码。
- `src/server/index.ts`：恢复焦点失败不能阻止其他项目恢复；服务退出必须进入统一关闭钩子。
- `src/shared/project-events.ts`：事件合同会被阶段五 SSE 和前端复用，字段必须保持轻量、稳定且不暴露绝对路径。

## 验证方式

使用构建产物配合 Node 内联脚本创建临时 Trellis fixture，并注入较短的防抖/轮询参数验证生命周期。验证结束后删除临时目录，不在仓库保留测试类或 fixture 文件。

```bash
pnpm lint
pnpm typecheck
pnpm build
```

## 启动前复核

- 仅覆盖 `docs/planning/implement.md` 阶段四。
- 阶段四实现事件合同和订阅中心，正式 SSE HTTP 路由仍留到阶段五。
- 历史项目不访问文件系统，焦点项目只监听 Trellis 展示路径。
- 原生监听失败时必须明确进入 `polling`，不能继续标记为实时。
- 任何刷新、监听和降级流程都不写入被查看项目。
