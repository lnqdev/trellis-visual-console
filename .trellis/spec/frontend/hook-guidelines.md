# 前端 Hook 规范

## 主数据 Hook

`useProjectConsole` 集中管理：

- 项目列表、当前项目详情、Spec/Task 文档异步状态。
- 当前项目、视图和资源选择，以及 URL 查询参数同步。
- 扫描、登记、刷新、焦点和外部打开操作状态。
- SSE 连接状态和轻量失效事件处理。

组件不得重复实现这些跨域数据流。

## 请求与取消

- 初始加载、项目切换和文档切换使用 `AbortController`，Effect 清理时取消请求。
- 非后台切换先把对应数据置空并进入加载态，避免新选择下展示旧数据。
- 后台 SSE 刷新可以保留当前详情；新详情到达后，再由白名单校验驱动 Spec/Task 文档读取。
- 读取文档前必须确认详情属于当前项目、`contentReadable=true`，且路径存在于当前快照或 Task 文档清单。
- `loadDetail` 的每次请求使用单调递增代次，并在提交响应时同时核对当前项目 ref、请求代次和响应项目 ID。AbortController 负责主动取消，代次校验负责丢弃 SSE 后台刷新、重试或其他无法及时取消的过期响应。
- 项目切换入口必须同步更新当前项目 ref、使旧代次失效并清空旧详情，不能只等待下一次 Effect 执行。

```typescript
if (
  detail.project.id === projectId &&
  detail.contentReadable &&
  containsSpecFile(detail.snapshot?.specTree ?? [], path)
) {
  void loadSpecDocument(projectId, path, controller.signal);
}
```

## SSE

- `EventSource` 订阅同源 `/api/events`，事件先通过 `isProjectRealtimeEvent` 校验。
- 任意事件刷新项目列表；只有当前项目事件刷新详情。
- 不在事件处理器中并行读取旧 Spec/Task 路径，防止资源删除后产生瞬时 404。
- 视图和文档标签切换不得重建 SSE；当前实现只在所选项目变化时更新订阅闭包。

## 常见错误

- 只修改 `selectedProjectId` 而不重置资源选择，会把旧路径请求到新项目。
- URL 参数不是可信白名单；必须等待项目详情后再确认资源存在。
- 异步响应若可能跨项目返回，必须通过取消或当前项目校验阻止陈旧状态覆盖。
- 仅依赖 Effect 清理中的 `abort()` 不足以保护没有 signal 的后台刷新；必须保留响应提交时的项目/代次校验。
