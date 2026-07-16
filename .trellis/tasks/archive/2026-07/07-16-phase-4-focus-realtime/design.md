# 阶段四焦点项目与实时更新技术设计

## 模块边界

```text
src/server/realtime/
├── project-event-hub.ts        # 轻量事件发布、订阅与取消订阅
├── project-file-watcher.ts     # Chokidar 原生/轮询监听适配器
└── project-realtime-manager.ts # 焦点生命周期、批处理、刷新和降级编排

src/shared/
└── project-events.ts           # 阶段五 SSE 路由可直接复用的事件合同
```

现有 `ProjectCatalog` 扩展为已登记项目生命周期的数据入口，负责在统一串行队列中完成注册表与快照的读改写；监听器不直接写存储，也不直接读取任意项目路径。

## 生命周期状态

持久状态继续复用注册表中的三态：

- `history`：保留路径和最后快照，没有运行时监听器。
- `focus`：最近一次聚焦成功，应用运行期间应存在原生或轮询监听器。
- `unavailable`：路径、权限或 Trellis 结构失效，没有监听器，保留最后成功快照。

运行时额外维护监听模式，不写入持久化 Schema：

- `stopped`：没有监听器。
- `native`：Chokidar 使用操作系统文件事件，属于实时模式。
- `polling`：Chokidar 使用低频轮询，属于非实时降级模式。

运行时模式是进程事实，跨重启保存会产生陈旧状态，因此只由 `ProjectRealtimeManager` 内存维护并提供查询。

## 聚焦数据流

```text
focus(projectId)
  → 从注册表按 ID 取得项目
  → 校验项目路径和 Trellis 结构
  → 完整索引并先保存新快照
  → 启动 native 监听器
      └─ 启动失败则关闭并改用 polling
  → 持久化 state=focus
  → 发布 project-focused
```

如果状态持久化失败，立即关闭刚启动的监听器，避免内存状态与注册表长期分叉。索引或结构校验失败时不启动监听，项目转为 `unavailable` 并保留旧快照。

## 移出焦点与不可用

`unfocus(projectId)` 先持久化 `history`，再关闭监听器和待处理防抖任务，最后从运行时 Map 移除。这样进程异常退出时也不会在下次启动错误恢复该项目。

文件批次重新索引失败且确认项目已不可用时，管理器关闭监听器、持久化 `unavailable` 和错误摘要、保留旧快照，并发布 `project-unavailable`。普通单文件解析错误仍由现有索引器记录到新快照诊断，不把整个项目错误升级为不可用。

## 启动恢复与退出清理

服务启动阶段读取一次注册表，只对 `focus` 项目顺序执行恢复：重新索引、重建监听器并更新运行时状态。`history` 和 `unavailable` 不触发文件访问。

Fastify `onClose` 钩子调用管理器 `close()`：先阻止新任务进入，再清理防抖定时器，最后并行关闭所有项目监听器。系统信号仍通过现有 `server.close()` 进入同一清理链路。

## 监听适配器

使用 Chokidar 5，原因是：

- Node.js 版本合同兼容；
- 普通模式复用操作系统原生事件；
- 同一 API 可切换 `usePolling`，无需引入原生二进制安装链；
- 支持 `ignoreInitial`、`followSymlinks: false` 和统一 `close()` 生命周期。

每个焦点项目只创建一个 Chokidar 实例，目标固定为：

- `<project>/.trellis/spec`
- `<project>/.trellis/tasks`
- `<project>/.trellis/config.yaml`
- `<project>/.trellis/workflow.md`

原生模式关闭轮询；降级模式使用可注入的低频轮询间隔，生产默认 10 秒。监听启动以 `ready` 为成功边界，`ready` 前错误使启动失败；运行期错误交给管理器切换轮询或重新校验项目。

## 防抖、路径和批量失效

监听适配器只上报原始文件事件，管理器负责：

1. 将路径解析为项目根目录下的 POSIX 风格相对路径；
2. 再次确认路径位于允许监听的 Trellis 路径内；
3. 使用 `Set` 去重；
4. 按项目使用默认 300ms 防抖窗口合并；
5. 在项目串行队列中执行一次完整索引；
6. 根据相对路径集合发布 Spec、Task 或项目级失效事件；
7. 发布一次 `project-reindexed`。

事件只表达“哪些资源失效”，不复制索引数据。阶段五的页面收到事件后重新查询对应资源。

## 事件合同

共享事件字段：

```ts
interface ProjectRealtimeEvent {
  id: string;
  type:
    | "project-focused"
    | "project-invalidated"
    | "spec-changed"
    | "tasks-changed"
    | "project-unavailable"
    | "project-reindexed";
  projectId: string;
  resource: "project" | "spec" | "tasks";
  scope: "all" | "summary" | "tree";
  timestamp: string;
  watchMode: "stopped" | "native" | "polling";
}
```

`ProjectEventHub` 使用内存 `Set` 保存订阅者，发布时对订阅者快照迭代；单个订阅者异常不能阻塞其他订阅者。事件 ID 使用 `randomUUID()`，方便阶段五映射为 SSE `id`。

## 串行化与一致性

- `ProjectCatalog` 使用全局数据变更队列保护“读取注册表/快照 → 计算新值 → 两文件保存”的完整临界区，避免不同项目并发更新造成丢失。
- `ProjectRealtimeManager` 使用项目级操作队列，保证同一项目不会同时执行聚焦、取消聚焦、重索引和降级切换。
- 快照仍先保存、注册表后保存；新快照失败不会更新注册表索引时间。
- 历史快照是缓存，源项目 `.trellis/` 始终是唯一事实来源。

## 兼容性与回滚

- 本阶段不修改存储版本；监听模式是运行时状态，避免引入迁移。
- 如果 Chokidar 原生模式在目标文件系统不可用，自动降级到轮询，不改变事件合同。
- 如果阶段五发现 SSE 载荷需要扩展，只能增加小型失效元数据，不把 Markdown 或完整快照放入事件。
- 回滚时删除 `src/server/realtime/`、共享事件合同和 Chokidar 依赖，并恢复 `ProjectCatalog`/服务启动接线即可；注册表和快照格式保持兼容。
