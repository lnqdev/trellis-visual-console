# 只读控制台页面可执行合同

## 1. 范围与触发条件

修改项目侧栏、发现登记、项目详情、Spec/Task/Workflow/诊断页面、URL 查询参数、API 客户端或 SSE 同步时，必须遵守本合同。

## 2. 签名

- 数据入口：`useProjectConsole()`。
- 网络边界：`src/web/api-client.ts` 中的 `fetchProjects`、`fetchProject`、`scanProjects`、`registerProjects`、`setProjectFocus`、`refreshProject`、`fetchSpecDocument`、`fetchTaskDetail`、`fetchTaskDocument`、`openProjectPath`。
- URL 状态：`project`、`view`、`spec`、`task`、`document`。
- 主视图：`overview | spec | tasks | workflow | diagnostics`。
- 实时入口：同源 `EventSource("/api/events")`。

## 3. 合同

- 所有 JSON 先按 `unknown` 接收，再用 `src/shared/api.ts` 的 Schema 校验。
- `App` 只组合页面和功能域组件；服务端状态、URL 状态、操作状态和 SSE 失效处理集中在 `useProjectConsole`。
- 项目切换必须同时重置视图、Spec、Task 和文档选择，禁止把上一项目的资源路径带到新项目。
- URL 参数只用于恢复候选选择；项目详情快照白名单就绪前不得请求 Spec/Task 文档。失效路径必须清理或回退到首个可用资源。
- 页面只在详情 `contentReadable=true` 时渲染 Spec/Task 正文浏览器并发起内容请求；历史项目初始显示摘要限制提示，显式刷新成功或加入焦点后恢复入口。
- SSE 只触发项目列表与详情重新查询；文档重读由同一套详情白名单校验驱动，禁止并行读取可能已经删除的旧路径。
- 非后台项目或文档切换先清空旧数据并显示加载态，不能在新选择下短暂展示上一份正文。
- 项目详情响应提交必须核对当前项目和请求代次，旧项目的后台响应不得覆盖用户最后选择。
- Markdown 使用 `react-markdown + remark-gfm`，不启用 `rehype-raw`；外部 HTTP(S) 链接使用新标签页和 `noreferrer`。
- 375、768、1024、1440 像素下禁止页面级水平滚动；JSONL、表格和长路径只允许在组件内部滚动。

## 4. 校验与错误矩阵

| 条件 | 页面行为 |
| --- | --- |
| API 响应不符合共享 Schema | 展示“接口返回格式不正确” |
| 无效手动路径 | 展示服务端中文诊断，表单保留可重试状态 |
| URL 项目不存在 | 回退到已登记项目；项目内资源选择清空 |
| URL Spec/Task/文档不存在 | 不发起越界文档请求，清理并选择可用资源 |
| 历史项目尚未显式刷新 | Spec/Task 正文浏览器替换为摘要限制提示，不发起内容请求 |
| 历史项目显式刷新成功 | 保持 `history/stopped`，但恢复当前进程内的正文入口 |
| SSE 断开 | 状态显示“实时通道重连中”，浏览仍可使用 HTTP |
| 文档读取失败 | 当前阅读区 `role="alert"`，侧栏与其他视图保持可用 |
| 项目不可用 | 诊断页展示原因和重新校验入口 |

## 5. 正常、基础与异常用例

- 正常：登记新项目后自动切换到该项目概览，URL 不保留旧 Spec/Task 参数。
- 正常：焦点项目 Spec 变化后当前文档自动更新，EventSource 不因文档标签切换反复重建。
- 基础：空项目列表直接打开项目发现面板。
- 基础：历史项目显示快照可能过期提示，仍可浏览最后快照。
- 正常：归档 Task URL 恢复后归档标签为选中状态；跨项目或程序化选择变化后标签继续与 Task 集合一致。
- 异常：延迟旧项目详情响应，在用户切换到新项目后返回，页面标题、URL 和资源选择仍保持新项目。
- 异常：Markdown 中的 `<script>` 不进入 DOM、不执行。
- 异常：失效文档参数自动回退，浏览器控制台和网络中不出现预期外 404。

## 6. 必需验证

```bash
pnpm lint
pnpm typecheck
pnpm build
```

Playwright 至少覆盖：扫描/登记、中文错误、项目切换 URL 清理、焦点进出、历史正文刷新前零请求与刷新后恢复、SSE 自动刷新、延迟详情竞态、归档 Task URL/跨项目标签同步、Spec/Task/JSONL、原始 HTML 安全、375/768/1024/1440 无水平滚动、控制台无错误和 API 无未知失败。

## 7. 错误与正确示例

错误：项目 ID 改变时只更新一个状态，旧文档路径继续请求新项目。

```typescript
setSelectedProjectId(project.id);
```

正确：统一经过项目选择入口，并在详情白名单就绪后读取资源。

```typescript
selectProject(project.id);

if (
  detail.project.id === selectedProjectId &&
  detail.contentReadable &&
  containsSpecFile(detail.snapshot?.specTree ?? [], path)
) {
  void loadSpecDocument(selectedProjectId, path);
}
```
