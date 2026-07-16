# 焦点项目实时更新可执行合同

## 场景：焦点项目生命周期、受限监听和轻量失效事件

### 1. 范围与触发条件

修改项目聚焦/取消聚焦、已登记项目重新索引、文件监听、事件批处理、轮询降级、启动恢复或服务退出清理时，必须遵守本合同。源项目始终只读，历史项目必须保持零监听。

### 2. 签名

- 注册表读取：`ProjectCatalog#listProjects()`
- 已登记项目刷新：`ProjectCatalog#refreshProject(projectId)`
- 状态迁移：`ProjectCatalog#updateProjectState(projectId, "focus" | "history")`
- 启动恢复：`ProjectRealtimeManager#restoreFocusProjects()`
- 聚焦：`ProjectRealtimeManager#focusProject(projectId)`
- 取消聚焦：`ProjectRealtimeManager#unfocusProject(projectId)`
- 手动刷新：`ProjectRealtimeManager#refreshProject(projectId)`
- 运行时状态：`getRuntimeStatus(projectId)`、`listRuntimeStatuses()`
- 退出清理：`ProjectRealtimeManager#close()`
- 文件监听接口：`ProjectFileWatcher#start()`、`ProjectFileWatcher#close()`
- 事件入口：`ProjectEventHub#publish(input)`、`subscribe(listener)`
- 共享合同：`ProjectRealtimeEvent`、`ProjectRuntimeStatus`、`isProjectRealtimeEvent(value)`

### 3. 合同

持久状态：

```typescript
type ProjectDisplayState = "history" | "focus" | "unavailable";
```

运行时监听状态：

```typescript
type ProjectRuntimeWatchMode = "stopped" | "native" | "polling";
```

- `history` 和 `unavailable` 在应用启动时不访问项目文件系统，也不创建监听器。
- 聚焦顺序固定为：校验与完整索引 → 保存快照 → 启动原生监听或轮询降级 → 保存 `focus`。
- 取消聚焦顺序固定为：保存 `history` → 清理防抖任务 → 关闭监听器；最后成功快照不删除。
- 项目结构失效时保存 `unavailable` 和错误摘要，只更新注册表，旧快照原样保留。
- `unavailable` 项目显式刷新成功后必须恢复为 `history`，清除不可用错误并保存新快照；不得直接恢复为 `focus`，因为成功刷新本身没有建立监听器。需要重新聚焦时必须再走完整聚焦顺序。
- 监听路径只能是 `.trellis/spec/`、`.trellis/tasks/`、`.trellis/config.yaml` 和 `.trellis/workflow.md`，`followSymlinks` 必须为 `false`。
- 原生监听默认使用 Chokidar 的操作系统事件；启动或运行失败后切换 `usePolling`，生产轮询间隔为 10 秒，并标记 `realtime=false`。
- 单项目文件事件先转为项目内 POSIX 相对路径，再使用 `Set` 去重和默认 300ms 防抖；一批事件只执行一次完整索引。
- `ProjectCatalog` 必须用同一串行队列保护注册表和快照的完整读改写，保存顺序仍为快照优先、注册表随后。
- 同一项目的聚焦、取消聚焦、重索引和降级必须进入同一项目队列。
- Fastify `onClose` 必须调用 `ProjectRealtimeManager#close()`；系统信号继续通过 `server.close()` 进入统一清理链路。

事件合同：

```typescript
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

事件不得包含 Markdown 正文、完整快照或绝对源路径。阶段五 SSE 路由必须直接复用该共享合同，不在路由或前端重复定义字段。

### 4. 校验与错误矩阵

| 条件 | 行为 |
| --- | --- |
| 项目 ID 不存在 | 生命周期方法返回或抛出明确的“未找到项目”错误，不创建监听器 |
| 聚焦前项目路径或 Trellis 结构失效 | 保存 `unavailable`，保留旧快照，发布 `project-unavailable` |
| 不可用项目修复后显式刷新成功 | 保存新快照并迁移为 `history`，清除不可用错误；页面重新允许加入焦点，但不自动创建监听器 |
| 原生监听启动失败 | 关闭失败实例，记录项目 ID 和错误类型，尝试 `polling` |
| 原生监听运行期错误 | 串行重新校验和索引；项目有效则切换 `polling`，无效则进入 `unavailable` |
| 轮询监听也启动失败 | 清除运行时监听状态并向调用链传播错误，不能伪装成功 |
| 单个订阅者抛错 | 隔离该异常，其他订阅者仍收到同一事件 |
| 多个快速文件事件 | 去重并合并为一个项目级刷新批次 |
| 文件事件超出允许路径 | 忽略，不触发索引或事件 |
| 注册表保存失败 | 不保留刚创建的活动监听器；错误向调用方传播 |
| 服务退出 | 停止接收新任务，清理定时器，等待队列并关闭全部监听器 |

### 5. 正常、基础与异常用例

- 正常：历史项目聚焦后先得到新快照，再创建一个原生监听器；Spec 保存触发一次 `spec-changed` 和一次 `project-reindexed`。
- 基础：注册表只有历史项目时，`restoreFocusProjects()` 返回空恢复集合，活动监听器数量为 `0`。
- 批量：编辑器连续创建三个 Spec 文件，只产生一个重索引批次。
- 降级：模拟原生监听启动失败后，项目保持 `focus`，运行时模式为 `polling`，`realtime=false`。
- 异常：删除焦点项目的 `config.yaml` 后，项目变为 `unavailable`、监听器释放、旧快照仍存在。
- 恢复：补回必需结构并显式刷新后，项目变为 `history`、错误清除、新快照可读、活动监听器仍为 `0`；随后显式聚焦才创建监听器。
- 隔离：修改历史项目文件不产生事件，也不更新该项目 `indexedAt`。

### 6. 必需验证

项目默认不生成测试文件。本合同变更至少执行：

```bash
pnpm lint
pnpm typecheck
pnpm build
```

临时 fixture 断言：

- 历史项目零监听且文件变化不刷新快照。
- 聚焦后监听器数量与焦点项目数量一致。
- 多个快速事件只触发一次批量重索引。
- 取消聚焦后监听器释放且快照保留。
- 应用重启只恢复持久化的焦点集合。
- 项目结构失效进入 `unavailable` 并发布事件。
- 不可用项目修复后刷新恢复为 `history`，页面可重新聚焦，且刷新本身不遗留监听器。
- 原生监听失败进入 `polling` 且不标记实时。
- `SIGINT`/`SIGTERM` 后服务端口释放。

### 7. 错误与正确示例

错误：先写入焦点状态，或监听整个项目目录。

```typescript
await catalog.updateProjectState(projectId, "focus");
watch(project.path);
await catalog.refreshProject(projectId);
```

正确：先刷新快照，只监听允许路径，监听成功后再持久化焦点状态。

```typescript
const refreshed = await catalog.refreshProject(projectId);
const watcher = await startAllowedTrellisWatcher(refreshed.project);
await catalog.updateProjectState(projectId, "focus");
```

错误：把完整快照放进 SSE 事件，或吞掉监听失败继续标记实时。

```typescript
publish({ projectId, snapshot });
watcher.on("error", () => undefined);
```

正确：只发布失效范围，原生失败后明确降级并暴露 `polling` 状态。

```typescript
publish({ projectId, resource: "spec", scope: "tree", watchMode: "polling" });
```

错误：成功刷新时无条件保留原状态，或在没有建立监听器时直接把不可用项目恢复为焦点。

```typescript
const refreshedProject = { ...existingProject, error: null };
// existingProject.state 仍可能是 unavailable，页面永远无法重新聚焦。
```

正确：普通状态保持不变，只有不可用项目在成功刷新后回到历史；重新聚焦继续复用完整生命周期入口。

```typescript
const refreshedProject = {
  ...existingProject,
  state: existingProject.state === "unavailable" ? "history" : existingProject.state,
  error: null,
};
```
