# 只读控制台页面可执行合同

## 1. 范围与触发条件

修改项目侧栏、发现登记、项目详情、Spec/Task/Workflow/诊断页面、URL 查询参数、API 客户端或 SSE 同步时，必须遵守本合同。

## 2. 签名

- 数据入口：`useProjectConsole()`。
- 网络边界：`src/web/api-client.ts` 中的 `fetchProjects`、`fetchTaskCenter`、`fetchProject`、`scanProjects`、`registerProjects`、`selectDirectory`、`setProjectFocus`、`refreshProject`、`fetchSpecDocument`、`fetchTaskDetail`、`fetchTaskDocument`、`openProjectPath`。
- 顶层模式：`project | tasks`。
- 项目 URL 状态：`project`、`view`、`spec`、`task`、`document`。
- 任务中心 URL 状态：`mode=tasks`、`scope`、`collection`、`q`、`taskProject`、`status`、`phase`、`assignee`、`package`、`sort`。
- 主视图：`overview | spec | tasks | workflow | diagnostics`。
- 实时入口：同源 `EventSource("/api/events")`。
- 任务中心性能常量：搜索延迟约 `200ms`，首批及每批追加 `100` 条结果。

## 3. 合同

- 所有 JSON 先按 `unknown` 接收，再用 `src/shared/api.ts` 的 Schema 校验。
- `App` 只组合页面和功能域组件；服务端状态、URL 状态、操作状态和 SSE 失效处理集中在 `useProjectConsole`。
- 全局任务中心通过侧栏独立入口进入，不加入单项目主视图标签；选择任意项目时切回 `project` 模式。
- 任务中心只在激活时调用一次 `fetchTaskCenter`，搜索、组合筛选、汇总和排序全部基于已校验 DTO 在内存中完成，不为输入变化重复请求服务端。
- `useTaskCenter` 使用 `refreshGeneration + retryGeneration` 作为成功响应缓存键；任务中心重新激活且缓存键未变化时必须复用内存响应，不重复请求 `/api/tasks`。SSE 增加刷新代次或用户显式重试后必须重新请求。
- 关键词输入和 URL 状态即时更新，实际搜索与排序使用约 200ms 延迟值；`results` 计算依赖不得包含原始 `selection.query`，避免延迟期间仍按每个按键重算。
- 任务中心汇总、筛选选项和结果总数基于全部匹配任务，DOM 默认只渲染排序结果前 100 条，“加载更多”每次追加 100 条。筛选、排序或响应变化后可见数量恢复为首批。
- 项目范围默认 `focus`、任务集合默认 `active`、排序默认 `updated_desc`；全部范围中焦点项目必须优先于历史项目，缺少更新时间的任务始终排在有时间任务之后。
- 状态筛选将 `done` 规范化为 `completed`，汇总固定为 `planning / in_progress / review / completed / other` 五组，五组数量之和必须等于当前结果总数；未知状态保留原始筛选值并计入“其他”。
- 关键词只匹配项目名称、任务标题、任务 ID、状态原始值和中文展示值、阶段、负责人和包，不读取或索引 PRD、设计、实施计划和 JSONL 正文。
- `mode=tasks` URL 与项目阅读 URL 互斥；非法 `scope/collection/sort` 立即回退默认值，响应到达后清理不存在的项目、状态、阶段、负责人和包，并使用 `replaceState` 写回有效参数。
- 任务中心使用扁平列表；子任务显示 `parentTitle`，完整父子树和文档阅读继续复用单项目 Task 页面。
- 点击焦点项目任务直接进入现有 Task 页面；点击历史项目任务必须先显式刷新，使用最新详情判断任务是否仍存在并选择最新文档清单中的首个文档。任务消失时进入 Task 页面并清空选择，项目不可用时进入诊断视图。
- 应用只维护一条 `/api/events` 连接；连续项目事件在约 150ms 尾随窗口内合并，每批只刷新一次项目列表和任务中心，当前项目命中该批时只刷新一次详情。
- 添加项目页的扫描根路径和项目根路径都提供系统目录选择入口；扫描根目录选择成功只回填并等待主动扫描，单项目根目录选择成功立即复用现有登记动作并刷新项目列表。
- 用户取消目录选择时保留输入框原值和当前提示；选择失败或平台不支持时显示中文反馈，并继续允许手工输入。
- 目录选择进行中禁用两个选择入口，防止重复打开；窄屏下路径输入与图标按钮保持同一行且不产生页面级水平滚动。
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
| 目录选择取消 | 保留目标输入框原值，不新增错误提示 |
| 目录选择不支持或启动失败 | 展示服务端中文消息，保留手工输入和重试能力 |
| 无效手动路径 | 展示服务端中文诊断，表单保留可重试状态 |
| URL 项目不存在 | 回退到已登记项目；项目内资源选择清空 |
| 非法任务中心枚举参数 | 回退默认值并替换写回 URL，不新增历史记录 |
| 过期任务中心属性筛选 | 响应到达后清空该值并替换写回 URL |
| 任务中心聚合接口失败 | 只在任务中心展示中文错误和重试，侧栏及已有项目详情保持可用 |
| 离开后重新进入任务中心且无 SSE 失效 | 立即展示缓存结果，不新增 `/api/tasks` 请求 |
| SSE 失效或用户点击重试 | 保留当前结果作为后台内容并重新请求 `/api/tasks` |
| 匹配结果超过 100 条 | 汇总显示完整总数，DOM 只包含首批 100 行并提供“加载更多” |
| 搜索关键词快速连续变化 | 输入和 URL 即时变化，约 200ms 后只按最后稳定值更新结果 |
| 焦点范围没有焦点项目 | 保留范围选择，提示切换到全部项目 |
| 历史任务刷新后不存在 | 进入对应项目 Task 页面，清空 Task/文档选择并提示快照已更新 |
| 历史任务刷新后项目不可用 | 进入项目诊断视图，不继续请求 Task 详情 |
| URL Spec/Task/文档不存在 | 不发起越界文档请求，清理并选择可用资源 |
| 历史项目尚未显式刷新 | Spec/Task 正文浏览器替换为摘要限制提示，不发起内容请求 |
| 历史项目显式刷新成功 | 保持 `history/stopped`，但恢复当前进程内的正文入口 |
| SSE 断开 | 状态显示“实时通道重连中”，浏览仍可使用 HTTP |
| 文档读取失败 | 当前阅读区 `role="alert"`，侧栏与其他视图保持可用 |
| 项目不可用 | 诊断页展示原因和重新校验入口 |

## 5. 正常、基础与异常用例

- 正常：登记新项目后自动切换到该项目概览，URL 不保留旧 Spec/Task 参数。
- 正常：进入任务中心默认显示焦点项目活动任务，可切换全部项目、归档和全部集合，并组合项目、状态、阶段、负责人和包筛选。
- 正常：搜索“已完成”同时命中 `completed` 与 `done`，未知状态单独筛选且汇总计入“其他”。
- 正常：任务中心全部参数刷新后恢复；非法枚举和过期筛选自动清理并写回 URL。
- 正常：焦点任务直接跳转，历史任务刷新后跳转，最终 URL 恢复 `project`、`view=tasks`、`task` 和存在时的 `document`。
- 基础：不可用和无快照项目不产生任务行，不可用项目仍提供诊断入口。
- 基础：2000 条匹配任务的首屏只渲染 100 行，加载一次后渲染 200 行，汇总总数始终为 2000。
- 正常：无失效事件时从项目页面返回任务中心复用缓存；收到一批 SSE 失效事件后只重新请求一次任务中心。
- 正常：快速扫描入口选择后只回填路径；手动添加入口选择有效项目后自动登记、刷新项目列表并切换到该项目。
- 基础：取消系统目录选择后输入框已有内容不变，页面不出现失败提示。
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

Playwright 至少覆盖：扫描/登记、中文错误、任务中心默认范围与集合、项目/状态/阶段/负责人/包组合筛选、元数据搜索、约 200ms 搜索延迟、`done/completed` 合并、未知状态汇总闭合、更新时间稳定排序、任务中心 URL 全量恢复与非法/过期值修复、焦点和历史任务跳转、任务消失/项目不可用/无文档分支、无失效事件时重复进入不新增 `/api/tasks`、稳定基线后模式或项目切换不新增 EventSource、连续失效事件只新增一次项目列表和任务中心请求、至少 2000 条任务时首屏 100 行与加载后 200 行、项目切换 URL 清理、焦点进出、历史正文刷新前零请求与刷新后恢复、延迟详情竞态、归档 Task URL/跨项目标签同步、Spec/Task/JSONL、原始 HTML 安全、375/768/1024/1440 无水平滚动、控制台无错误和 API 无未知失败。

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

错误：任务中心自行建立第二条 SSE，或把项目阅读参数和任务筛选参数混写到同一 URL。

```typescript
new EventSource("/api/events");
params.set("task", selectedTask);
params.set("scope", scope);
```

正确：`useProjectConsole` 统一拥有单连接和判别联合 URL，任务中心只消费刷新代次与已校验 DTO。

```typescript
if (mode === "tasks") {
  writeUrlSelection({ mode, taskCenter: selection });
} else {
  writeUrlSelection({ mode, projectId, view, specPath, taskSourcePath, taskDocumentPath });
}
```

错误：每次进入任务中心都重新拉取相同响应，并把全部匹配任务一次渲染到 DOM。

```typescript
useEffect(() => void fetchTaskCenter(), [active]);
return results.map(renderTaskRow);
```

正确：成功响应按刷新代次复用，完整结果只用于汇总和排序，页面分批渲染。

```typescript
if (response !== null && completedRequestKeyRef.current === requestKey) {
  return;
}

const visibleResults = results.slice(0, visibleCount);
```
