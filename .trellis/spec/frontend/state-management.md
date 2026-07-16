# 前端状态管理

## 状态分类

| 类型 | 归属 | 示例 |
| --- | --- | --- |
| 服务端状态 | `useProjectConsole` | 项目列表、详情、文档、SSE 连接 |
| URL 状态 | `useProjectConsole` | `project`、`view`、`spec`、`task`、`document` |
| 操作状态 | `useProjectConsole` | `busyAction`、全局成功/失败提示 |
| 局部 UI 状态 | 组件 | 发现表单、候选勾选、Task 集合标签 |
| 派生状态 | 渲染期计算 | 焦点/历史/不可用分组、计数、当前监听文案 |

当前不使用 React Router、React Query、Redux、Zustand 或其他全局状态库。

## 选择状态合同

- `selectProject(projectId)` 是显式切换项目的统一入口：重置视图、Spec、Task、文档并关闭发现页。
- `selectTaskSourcePath` 切换 Task 时必须清空文档选择；Task 详情返回后选择仍存在的文档或首个文档。
- 项目详情刷新后重新校验当前 Spec 和 Task；不存在的选择清空。
- URL 写回只包含当前稳定选择，不能保留已失效的项目内资源。

## 服务端状态同步

- 首次加载从 URL 恢复候选状态，再以项目列表和详情白名单纠正。
- SSE 是失效通知，不是第二份数据源；HTTP 返回的共享 DTO 才是页面事实来源。
- 后台刷新与用户切换使用不同加载语义：后台可保留当前内容，用户切换必须清空旧内容。

## 禁止模式

```typescript
// 禁止：分散更新导致跨项目陈旧状态。
setSelectedProjectId(projectId);

// 正确：经过统一状态转换。
selectProject(projectId);
```

- 禁止把服务端快照复制到多个组件本地状态。
- 禁止从 URL 直接发起任意资源请求。
- 禁止把可以从 DTO 推导的分组和计数保存为独立状态。
