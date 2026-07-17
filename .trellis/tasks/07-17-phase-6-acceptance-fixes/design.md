# 修复阶段六验收问题技术设计

## 边界与状态合同

本次沿用现有 `history | focus | unavailable` 持久化状态模型，不增加新的存储字段：

- `history`：初始只允许项目列表、项目详情和摘要快照读取；显式刷新成功后在当前服务进程内临时开放完整正文，但不启动监听。
- `focus`：允许在快照白名单和 realpath 边界内按需读取 Spec、Task 详情及 Task 文档。
- `unavailable`：只保留最后快照和诊断，不允许访问源文件正文。

`ProjectApiService` 使用进程内 `Set<projectId>` 记录已经显式刷新成功的历史项目，项目移出焦点或刷新失败时清除；服务重启后自然恢复为摘要模式。`ProjectDetailResponse.contentReadable` 把统一判定结果暴露给页面，不把临时资格写入注册表或快照。

## 服务端统一校验

在 `ProjectApiService` 增加单一私有入口，例如 `requireReadableProjectData(projectId)`：

1. 复用 `requireProjectData` 查询注册表和快照，不访问源文件。
2. 校验项目处于 `focus`，或历史项目已在当前进程中显式刷新成功。
3. 正文资格不满足时抛出专用领域错误，路由统一映射为 `409 project-content-unavailable` 和稳定中文提示。
4. 三个正文方法先通过该入口，再执行现有快照白名单和 realpath 校验。

校验必须位于服务层，确保浏览器之外的直接 HTTP 调用也不能绕过；前端限制只用于避免无意义请求和改善用户反馈。

## 前端正文入口

`useProjectConsole` 在读取 Spec、Task 详情和 Task 文档的 Effect 中同时要求当前详情属于所选项目且 `contentReadable=true`。正文不可读时立即清空相关异步状态和资源选择，不产生内容接口请求。

`App` 在 `contentReadable=false` 的项目进入 Spec 或 Task 视图时展示摘要限制说明和“刷新摘要 / 加入焦点”的既有操作指引，不渲染会自动选中文档的 `SpecBrowser` / `TaskBrowser`。显式刷新成功后详情响应切为可读，浏览器入口恢复；概览、Workflow 和诊断始终消费快照摘要。

## 项目详情竞态

`useProjectConsole` 使用两个 ref：

- `selectedProjectIdRef`：同步记录当前选择，供异步回调在提交状态前校验。
- `detailRequestGenerationRef`：每次 `loadDetail` 启动时递增，只有最新代次且响应项目仍等于当前选择时才允许写入详情和修正资源选择。

项目切换时先更新 ref、递增代次并清空详情；AbortController 继续保留，用于主动取消普通 Effect 请求。代次校验覆盖无法可靠取消或没有 signal 的后台请求，二者共同防止陈旧响应。

焦点切换和显式刷新返回详情后也要在写入前校验操作对应项目仍是当前选择，避免用户在操作进行中切走后被旧操作结果覆盖。

## Task 集合同步

`TaskBrowser` 保留局部 `collection` 状态以支持用户手动切换，但增加同步 Effect：

- 当前选中 Task 位于归档集合时切到 `archived`。
- 当前选中 Task 位于活动集合时切到 `active`。
- 当前没有选择且当前集合为空、另一集合非空时切到有内容的集合。

随后原有首项选择 Effect 只在当前集合稳定后执行，保证 URL 恢复和跨项目切换不会先选错集合的任务。

## 验证策略

- 使用 `/tmp` fixture 和独立应用数据目录启动生产服务。
- 用 HTTP 对未刷新历史项目的三个正文接口发起请求，确认服务在读取前即返回状态错误；再验证显式刷新后临时恢复、服务重启后清除，以及焦点项目正常读取。
- 用 Playwright 拦截并延迟项目详情请求，快速切换项目，确认旧响应不会覆盖新选择。
- 用包含活动/归档 Task 的两个项目验证归档 URL 恢复、跨项目切换和归档 Task 选择。
- 最后执行 lint、类型检查、生产构建和 diff 检查，并更新报告与 PRD 验收项。

## 回滚点

- `src/server/api/project-api-service.ts`、`project-routes.ts`：回滚专用错误、临时刷新资格和状态校验可恢复原行为。
- `src/web/hooks/useProjectConsole.ts`：请求代次和正文资格门禁必须整体回滚，避免只保留部分状态逻辑。
- `src/web/components/TaskBrowser.tsx`、`src/web/App.tsx`：集合同步和历史项目提示可独立回滚。
- 不修改注册表/快照版本，回滚不需要迁移应用数据。
