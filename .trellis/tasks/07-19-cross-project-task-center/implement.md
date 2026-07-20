# 跨项目任务中心与搜索筛选实施计划

> **执行说明：** 实施时必须使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans` 按任务逐项执行，并在每个检查点更新下方复选框。项目约定默认不新增测试类或仓库内测试文件，验证使用临时多项目 fixture、HTTP 断言和 Playwright。

**目标：** 新增一个聚合本机已登记 Trellis 项目任务的全局任务中心，支持焦点/全部范围、活动/归档集合、元数据搜索、组合筛选、状态汇总、稳定排序、URL 恢复和跳转到现有 Task 详情。

**架构：** 服务端通过一次 `ProjectCatalog.listProjectData()` 调用投影现有注册表与快照，新增 `GET /api/tasks` 返回项目元数据和扁平任务项；前端 `useTaskCenter` 一次获取响应后在本地完成搜索、筛选、汇总和排序。`useProjectConsole` 继续拥有顶层模式、URL、任务跳转和唯一 SSE 连接，连续实时事件在约 150ms 内合并。

**技术栈：** TypeScript 6、Node.js 22、Fastify 5、Zod 4、React 19、Lucide React、Vite、Playwright。

---

## 文件结构

- Modify: `src/shared/api.ts`：任务中心共享 Schema 与推导类型。
- Modify: `src/server/api/project-api-service.ts`：从注册表和快照聚合任务中心响应。
- Modify: `src/server/api/project-routes.ts`：注册 `GET /api/tasks`。
- Modify: `src/web/api-client.ts`：新增任务中心请求函数。
- Create: `src/web/hooks/useTaskCenter.ts`：任务中心请求、筛选状态、选项、汇总和排序。
- Modify: `src/web/hooks/useProjectConsole.ts`：顶层模式、URL 协调、SSE 合并和跨项目任务跳转。
- Create: `src/web/components/TaskCenter.tsx`：任务中心完整页面。
- Modify: `src/web/components/ProjectSidebar.tsx`：全局任务中心入口和激活状态。
- Modify: `src/web/App.tsx`：组合任务中心页面并保留现有目录选择流程。
- Modify: `src/web/formatters.ts`：统一任务状态展示值和状态分组。
- Modify: `src/web/components/TaskBrowser.tsx`：复用统一状态分组，保持现有任务树职责不变。
- Modify: `src/web/styles.css`：任务中心、侧栏入口和四档响应式布局。
- Modify: `.trellis/spec/backend/readonly-api-contract.md`：记录聚合接口与只读边界。
- Modify: `.trellis/spec/frontend/readonly-console-contract.md`：记录顶层模式、URL、筛选、跳转和 SSE 合同。

### 任务 0：建立实施基线并激活 Trellis 任务

- [x] **步骤 1：确认目录选择功能基线和工作区内容**

执行：

```powershell
git status --short --branch
git log -3 --oneline --decorate
```

预期：当前提交包含 `d96dc58 feat: 添加本机目录选择功能`；除 `.trellis/tasks/07-19-cross-project-task-center/` 外没有需要本任务处理的未提交源码。若并行任务新增了提交，先重新读取本计划列出的冲突文件，在最新代码上增量实施。

- [x] **步骤 2：创建任务分支，不创建 worktree**

执行：

```powershell
git switch -c codex/cross-project-task-center
```

预期：新分支基于已完成的目录选择代码，未跟踪的任务规划文件继续保留。

- [x] **步骤 3：加载开发规范并激活任务**

先使用 `trellis-before-dev` 完整读取 backend、frontend 和跨层规范，再执行：

```powershell
python ./.trellis/scripts/task.py start 07-19-cross-project-task-center
```

预期：`task.json.status` 由 `planning` 变为 `in_progress`，当前任务指针仍指向本任务。

### 任务 1：定义共享合同并新增聚合 API

- [x] **步骤 1：在 `src/shared/api.ts` 定义任务中心合同**

在 `TaskSummaryApiSchema` 后增加任务集合和任务项，在 `ProjectListItemSchema` 后增加响应 Schema：

```typescript
/** Task 所属集合。 */
export const TaskCollectionApiSchema = z.enum(["active", "archived"]);

/** 跨项目任务中心单项。 */
export const TaskCenterItemApiSchema = z
  .object({
    projectId: NonEmptyStringSchema,
    collection: TaskCollectionApiSchema,
    task: TaskSummaryApiSchema,
    parentTitle: NonEmptyStringSchema.nullable(),
  })
  .strict();

/** 跨项目任务中心响应。 */
export const TaskCenterResponseSchema = z
  .object({
    projects: z.array(ProjectListItemSchema),
    tasks: z.array(TaskCenterItemApiSchema),
  })
  .strict();
```

在文件底部导出 `TaskCollectionApi`、`TaskCenterItemApi` 和 `TaskCenterResponse` 推导类型。包装字段不进入 `src/server/storage/models.ts`，不修改持久化版本。

- [x] **步骤 2：在 `ProjectApiService` 聚合一次性任务响应**

导入 `TaskCenterResponseSchema`、`TaskCenterResponse`、`TaskCenterItemApi` 和 `TaskCollectionApi`，在 `listProjects()` 附近增加：

```typescript
/** 返回全部项目元数据和可聚合的扁平 Task 摘要。 */
async listTaskCenter(): Promise<TaskCenterResponse> {
  const projectData = await this.catalog.listProjectData();
  return TaskCenterResponseSchema.parse({
    projects: projectData.map((data) => this.createProjectListItem(data)),
    tasks: projectData.flatMap((data) => this.createTaskCenterItems(data)),
  });
}

/** 将一个可用项目快照投影为任务中心单项。 */
private createTaskCenterItems(data: ProjectCatalogData): TaskCenterItemApi[] {
  if (data.project.state === "unavailable" || data.snapshot === null) {
    return [];
  }

  const allTasks = [...data.snapshot.tasks.active, ...data.snapshot.tasks.archived];
  const titleBySourcePath = new Map(allTasks.map((task) => [task.sourcePath, task.title]));
  const createItem = (
    collection: TaskCollectionApi,
    task: (typeof allTasks)[number],
  ): TaskCenterItemApi => ({
    projectId: data.project.id,
    collection,
    task,
    parentTitle: task.parentSourcePath === null
      ? null
      : (titleBySourcePath.get(task.parentSourcePath) ?? null),
  });

  return [
    ...data.snapshot.tasks.active.map((task) => createItem("active", task)),
    ...data.snapshot.tasks.archived.map((task) => createItem("archived", task)),
  ];
}
```

必须保留全部 `projects` 项供前端统计不可用和无快照项目；`tasks` 只排除 `unavailable` 和无快照项目。不能调用 `task-reader.ts`、不能逐项目调用 `getProjectData()`，也不能重新读取源目录正文。

- [x] **步骤 3：在 `project-routes.ts` 注册无输入聚合路由**

紧邻 `GET /api/projects` 增加：

```typescript
server.get("/api/tasks", async (_request, reply) => {
  return reply.send(await service.listTaskCenter());
});
```

不修改 `src/server/index.ts`；现有 `registerProjectRoutes(server, projectApiService)` 会自动注册新路由。

- [x] **步骤 4：执行后端静态检查**

执行：

```powershell
pnpm lint
pnpm typecheck
```

预期：两条命令退出码均为 `0`，共享 Schema、服务投影和路由无 lint 或类型错误。

### 任务 2：实现任务中心数据模型、搜索筛选和汇总

- [x] **步骤 1：扩展 `src/web/api-client.ts`**

导入 `TaskCenterResponseSchema` 和 `TaskCenterResponse`，新增：

```typescript
/** 读取跨项目任务中心元数据。 */
export function fetchTaskCenter(signal?: AbortSignal): Promise<TaskCenterResponse> {
  return requestJson("/api/tasks", TaskCenterResponseSchema, createSignalOptions(signal));
}
```

继续复用 `requestJson`，不得绕过共享 Schema 或覆盖现有 `selectDirectory()`。

- [x] **步骤 2：统一任务状态格式化与分组**

在 `src/web/formatters.ts` 增加有限状态分组：

```typescript
export type TaskStatusGroup = "planning" | "in_progress" | "review" | "completed" | "other";

/** 将原始 Task 状态归入任务中心标准分组。 */
export function readTaskStatusGroup(status: string): TaskStatusGroup {
  switch (status) {
    case "planning":
    case "in_progress":
    case "review":
      return status;
    case "completed":
    case "done":
      return "completed";
    default:
      return "other";
  }
}

/** 将 Task 原始状态格式化为中文或可读回退值。 */
export function formatTaskStatusValue(status: string): string {
  switch (readTaskStatusGroup(status)) {
    case "planning":
      return "规划中";
    case "in_progress":
      return "实施中";
    case "review":
      return "评审中";
    case "completed":
      return "已完成";
    case "other":
      return status;
  }
}
```

让现有 `formatTaskStatus(task)` 委托 `formatTaskStatusValue(task.status)`；`TaskBrowser.tsx` 的状态色调判断复用 `readTaskStatusGroup()`，将 `in_progress` 映射到既有 `progress` 色调、`other` 映射到 `unknown`，不改变任务树交互。

- [x] **步骤 3：创建 `src/web/hooks/useTaskCenter.ts` 的公开状态合同**

定义并导出：

```typescript
export type TaskCenterScope = "focus" | "all";
export type TaskCenterCollection = "active" | "archived" | "all";
export type TaskCenterSort = "updated_desc" | "updated_asc";

export interface TaskCenterSelection {
  scope: TaskCenterScope;
  collection: TaskCenterCollection;
  query: string;
  projectId: string | null;
  status: string | null;
  phase: string | null;
  assignee: string | null;
  packageName: string | null;
  sort: TaskCenterSort;
}

export const DEFAULT_TASK_CENTER_SELECTION: TaskCenterSelection = {
  scope: "focus",
  collection: "active",
  query: "",
  projectId: null,
  status: null,
  phase: null,
  assignee: null,
  packageName: null,
  sort: "updated_desc",
};
```

Hook 接收 `active`、`initialSelection` 和 `refreshGeneration`。仅在 `active=true` 时请求 `fetchTaskCenter()`；进入任务中心、重试或刷新代次变化时使用 `AbortController` 发起一次新请求，旧请求不得覆盖新代次。

- [x] **步骤 4：实现固定过滤、选项和 URL 失效值修复语义**

过滤顺序固定为：范围 → 集合 → 项目 → 状态 → 阶段 → 负责人 → 包 → 关键词。实现以下纯函数并在 Hook 内复用：

```typescript
function normalizeStatusFilter(status: string): string {
  return status === "done" ? "completed" : status;
}

function matchesStatusFilter(item: TaskCenterItemApi, selectedStatus: string): boolean {
  const normalized = normalizeStatusFilter(selectedStatus);
  return normalized === "completed"
    ? readTaskStatusGroup(item.task.status) === "completed"
    : item.task.status === normalized;
}
```

项目选项来自当前范围；状态、阶段、负责人和包选项来自当前范围与集合内的任务，不受关键词和同级属性筛选影响。状态选项对 `done/completed` 只产生一个 canonical `completed`，未知状态保留原始值。

响应到达或范围/集合变化后，校验 `projectId/status/phase/assignee/packageName` 是否仍在对应选项中；过期值置为 `null`。只有状态真正变化时才更新选择对象，避免重复渲染和 URL 写入循环。

- [x] **步骤 5：实现元数据搜索、汇总和确定性排序**

关键词使用 `trim().toLocaleLowerCase()`，搜索语料按以下顺序拼接：项目名称、任务标题、任务 ID、原始状态、`formatTaskStatusValue()`、阶段、负责人、包。只使用响应 DTO，不请求 Task 正文。

汇总结构固定为：

```typescript
interface TaskCenterSummary {
  total: number;
  active: number;
  archived: number;
  planning: number;
  inProgress: number;
  review: number;
  completed: number;
  other: number;
}
```

五个状态分组数量之和必须等于 `total`。排序比较器先在 `scope=all` 时按项目状态 `focus` 优先于 `history`，再按 `updatedAt` 升降序；空时间始终排在有时间之后；最终依次使用项目名称、任务标题、任务 ID、`sourcePath` 做 `localeCompare("zh-CN")` 回退。

Hook 返回原始异步状态、当前选择、更新选择函数、清除条件函数、筛选选项、结果列表、汇总、不可用项目、无快照项目和 `retry()`。

- [x] **步骤 6：执行数据层静态检查**

执行：

```powershell
pnpm lint
pnpm typecheck
```

预期：状态工具、API 客户端和新 Hook 全部通过；没有第二条 `EventSource`。

### 任务 3：接入顶层模式、URL、SSE 合并和跨项目跳转

- [x] **步骤 1：在 `useProjectConsole.ts` 增加顶层模式并组合 `useTaskCenter`**

保留现有 `ProjectView` 中的 `"tasks"`，另增：

```typescript
export type ConsoleMode = "project" | "tasks";
```

初始化 `mode`、`taskCenterRefreshGeneration` 和 `useTaskCenter({ active: mode === "tasks", ... })`。`openTaskCenter()` 只切换顶层模式并关闭发现面板，保留最近项目内选择；`selectProject()` 切回 `project` 模式并继续复用 `applyProjectSelection(projectId, true)`。

- [x] **步骤 2：把 URL 状态改为判别联合并自动写回修复值**

`readUrlSelection()` 在 `mode=tasks` 时解析任务中心参数；非法 `scope/collection/sort` 立即回退默认值，`status=done` 规范化为 `completed`。项目模式继续解析现有 `project/view/spec/task/document`。

`writeUrlSelection()` 遵守以下互斥规则：

- 任务中心模式写 `mode=tasks` 和非默认任务中心参数，不写 `view/spec/task/document`。
- 项目模式写现有项目阅读参数，不写任务中心筛选参数。
- 所有写入继续使用 `window.history.replaceState`；Hook 清除过期筛选后，同一 URL Effect 自动写回修复后的状态。

- [x] **步骤 3：将 SSE 改为稳定单连接和约 150ms 尾随防抖**

新增 `pendingEventProjectIdsRef` 和 `eventRefreshTimerRef`。`EventSource` Effect 不依赖 `selectedProjectId` 或 `mode`，回调读取 `selectedProjectIdRef.current`：

```typescript
eventSource.onmessage = (message) => {
  const payload = parseProjectRealtimeEvent(message.data);
  if (payload === null) {
    return;
  }

  pendingEventProjectIdsRef.current.add(payload.projectId);
  if (eventRefreshTimerRef.current !== null) {
    clearTimeout(eventRefreshTimerRef.current);
  }
  eventRefreshTimerRef.current = window.setTimeout(() => {
    const projectIds = new Set(pendingEventProjectIdsRef.current);
    pendingEventProjectIdsRef.current.clear();
    eventRefreshTimerRef.current = null;
    void loadProjects(true);
    setTaskCenterRefreshGeneration((current) => current + 1);
    const currentProjectId = selectedProjectIdRef.current;
    if (currentProjectId !== null && projectIds.has(currentProjectId)) {
      void loadDetail(currentProjectId, true);
    }
  }, 150);
};
```

清理函数同时清除计时器、清空集合并关闭 EventSource。解析函数捕获非法 JSON 并使用 `isProjectRealtimeEvent` 校验。开发环境 React StrictMode 会产生初始化挂载重放，验收连接数使用生产构建或以稳定基线后的模式/项目切换增量为准。

- [x] **步骤 4：实现任务中心条目跳转**

新增 `openTaskCenterItem(item: TaskCenterItemApi)`：

- 焦点项目：切换项目模式，选择项目，设置 `view="tasks"`、任务 `sourcePath`，并清空文档选择。
- 历史项目：先调用 `refreshProject(projectId)`；成功后再提交最新详情并选择任务，不从聚合快照猜正文或文档。
- 刷新后任务不存在：进入该项目 Task 页面，任务和文档置空，显示“任务快照已更新，原任务已不存在”。
- 刷新后项目不可用：提交返回详情并进入 `view="diagnostics"`，不尝试读取 Task 详情。
- 历史刷新和跳转纳入 `busyAction`，完成后调用 `loadProjects(true)` 更新侧栏和任务中心项目状态。

现有 `task-reader.ts` 已按 `prd.md`、`design.md`、`implement.md`、其余 `relativePath` 排序；`loadTaskDetail()` 保留有效 URL 文档，否则选择最新响应的 `documents[0]`。从任务中心跳转时先将文档设为 `null`，因此最终选择来自最新任务详情；无文档时保持 `null`，URL 不写 `document`。

- [x] **步骤 5：实现不可用项目诊断跳转和 Hook 返回合同**

新增 `openProjectDiagnostics(projectId)`，切回项目模式、选择项目并设置 `view="diagnostics"`。Hook 返回 `mode`、`taskCenter`、`openTaskCenter`、`openTaskCenterItem` 和 `openProjectDiagnostics`，保留目录选择的 `chooseDirectory`、项目发现和现有 Task/Spec API。

- [x] **步骤 6：执行控制层静态检查**

执行：

```powershell
pnpm lint
pnpm typecheck
```

预期：URL 判别联合、SSE 计时器和跨项目跳转无 Hook 依赖或类型错误。

### 任务 4：构建任务中心页面与响应式工作列表

- [x] **步骤 1：在 `ProjectSidebar.tsx` 增加全局入口**

Props 增加 `mode: ConsoleMode` 和 `onOpenTaskCenter()`。在连接状态与“添加项目”按钮之间增加带 Lucide `ListChecks` 图标的任务中心按钮；`mode="tasks"` 时设置激活样式和 `aria-current="page"`，此时项目行不得同时设置 `aria-current`。

- [x] **步骤 2：创建 `src/web/components/TaskCenter.tsx`**

页面按以下顺序渲染，不使用嵌套卡片：

1. 标题、结果数、焦点/历史/不可用项目摘要。
2. 焦点/全部与活动/归档/全部分段控件。
3. 带 `Search` 图标的搜索框，项目、状态、阶段、负责人、包和排序原生菜单，以及带 `RotateCcw` 图标和 tooltip 的清除命令。
4. 总数、活动、归档、规划中、实施中、评审中、已完成、其他的紧凑汇总行。
5. 可点击不可用项目诊断入口；多项目使用 `details/summary` 展开项目按钮列表。
6. 扁平任务工作列表。

每行展示项目、任务标题、集合、状态、阶段、负责人、包和更新时间；子任务标题下展示 `父任务：{parentTitle}`。历史行显示“历史快照”和 `lastIndexedAt`。点击行调用 `onOpenTask(item)`；加载中、接口失败、无登记项目、无焦点项目、无结果分别使用独立空状态，接口失败提供重试，无结果保留条件并提供清除按钮。

- [x] **步骤 3：在 `App.tsx` 组合页面**

保留 `ProjectDiscovery` 的 `onSelectDirectory={consoleState.chooseDirectory}`。主内容分支顺序调整为：发现页 → `mode === "tasks"` → 无项目 → 项目详情加载/错误 → `ProjectWorkspace`。向 `TaskCenter` 传入 Hook 数据、项目诊断跳转、任务跳转、打开发现页和忙碌状态。

- [x] **步骤 4：在 `styles.css` 增加稳定布局**

新增 `.sidebar-mode-button` 与 `.task-center-*` 样式。桌面任务行使用明确网格轨道和 `minmax(0, 1fr)`；筛选栏使用 `repeat(auto-fit, minmax(150px, 1fr))`；按钮、分段控件和汇总项定义稳定最小高度，长项目名、标题和路径允许换行或省略，不改变行高基线。

在现有 1180、820、560 三档媒体查询中分别实现：减少次要列宽、任务行改为两行元数据、筛选控件单列或双列。375px、768px、1024px、1440px 下 `document.documentElement.scrollWidth` 必须等于 `window.innerWidth`，不允许页面级水平滚动或文本遮挡。

- [x] **步骤 5：执行前端构建检查**

执行：

```powershell
pnpm lint
pnpm typecheck
pnpm build
```

预期：三条命令退出码均为 `0`，Vite 和服务端构建成功。

### 任务 5：更新可执行合同并完成临时 fixture 验收

- [x] **步骤 1：更新后端合同**

在 `.trellis/spec/backend/readonly-api-contract.md` 增加 `GET /api/tasks -> TaskCenterResponse`，明确：一次读取注册表与快照、项目元数据全量返回、不可用/无快照项目不产生任务行、历史项目零源正文读取、损坏任务使用索引回退摘要、父关系未命中降级 `null`。

- [x] **步骤 2：更新前端合同**

在 `.trellis/spec/frontend/readonly-console-contract.md` 增加 `mode=tasks`、任务中心 URL 参数、筛选失效值修复、标准状态归组、扁平列表、历史刷新后跳转、默认文档、唯一 SSE 连接和 150ms 事件合并合同；网络边界列表加入 `fetchTaskCenter`。

- [x] **步骤 3：创建仓库外临时多项目 fixture**

使用系统临时目录创建 `projects/`、`data/` 和临时 Node 验证脚本，不提交到仓库。fixture 至少包含：

- 一个焦点项目，含活动和归档任务、跨集合父子关系及 `prd.md/design.md/implement.md`。
- 一个历史项目，含不同负责人、包、阶段、更新时间和未知状态。
- 一个先登记后破坏路径并刷新为不可用的项目，保留旧快照。
- 一个注册表存在但快照键被移除的无快照项目。
- 非法 `task.json`、缺失父任务引用和循环父子关系。

所有故障注入只修改临时 fixture 或独立应用数据目录。

- [x] **步骤 4：使用生产构建启动独立验收服务并断言 API**

执行：

```powershell
pnpm build
$env:TRELLIS_VISUAL_CONSOLE_DATA_DIR = "$fixtureRoot/data"
$env:PORT = "3219"
pnpm start
```

临时断言脚本请求 `/api/tasks` 并验证：`projects` 保留全部项目；`tasks` 只含焦点/历史且有快照的项目；`collection/projectId/parentTitle` 正确；非法任务生成回退摘要；损坏关系不阻塞其他任务；响应不包含 PRD、设计、实施计划或 JSONL 正文。

- [x] **步骤 5：使用 Playwright 验证完整用户流程**

打开 `http://127.0.0.1:3219`，至少覆盖：

- 默认焦点/活动范围，切换全部、归档和全部集合。
- 项目、状态、阶段、负责人、包组合筛选和元数据关键词搜索。
- `done/completed` 合并、未知状态“其他”汇总、总数闭合和升降序稳定性。
- URL 全参数刷新恢复；非法 `scope/collection/sort` 回退；过期项目和筛选值清除后写回 URL。
- 焦点任务直接跳转；历史任务先刷新再跳转；最终 URL 包含正确 `project`、`view=tasks`、`task` 和存在时的默认 `document`。
- 历史任务刷新后消失、项目变为不可用、无文档三个分支。
- 连续 `project-invalidated` 与 `project-reindexed` 在合并窗口内只新增一次 `/api/projects` 和一次 `/api/tasks`；稳定基线后切换模式/项目不新增 `/api/events` 连接。
- 375、768、1024、1440 四档无页面级水平滚动、文本遮挡、按钮错位，控制台无错误，网络无未知 4xx/5xx。

- [x] **步骤 6：复核源项目只读边界**

在交互前后比较 fixture `.trellis` 文件摘要；只允许显式故障注入产生差异，产品的聚合、搜索、筛选、刷新和阅读不得写源项目文件。

### 任务 5.5：增加大任务量性能保护

- [x] **步骤 1：复用未失效的任务中心响应**

在 `useTaskCenter.ts` 记录最后成功请求的 `refreshGeneration + retryGeneration` 键。任务中心重新激活且键未变化时直接复用响应；SSE 增加刷新代次或用户重试时继续请求并保留旧响应作为后台刷新内容。

- [x] **步骤 2：延迟关键词筛选计算**

关键词输入状态和 URL 即时更新，使用约 200ms 的延迟值驱动 `results` 搜索和排序。`results` 的依赖不得包含原始 `selection.query`，避免延迟期间仍按每个按键重算。

- [x] **步骤 3：分段渲染任务列表**

`TaskCenter.tsx` 默认渲染前 100 条结果，“加载更多”每次追加 100 条；汇总和空状态继续使用完整结果。筛选、排序或响应变化后重置为首批，窄屏不得产生水平滚动。

- [x] **步骤 4：执行大任务量验收**

使用仓库外临时 fixture 生成至少 2000 条任务，验证：首屏 DOM 行数为 100、汇总总数为完整数量、加载更多后为 200、搜索延迟生效、无失效事件时重复进入不新增 `/api/tasks`、SSE 失效后新增一次请求，并记录首屏就绪耗时作为观察值。

验收记录：2000 条任务登记与聚焦约 825ms，任务中心首屏就绪约 273ms，稳定关键词结果约 258ms；首屏 100 行、加载后 200 行，缓存复用期间请求数不变，SSE 后仅新增一次 `/api/tasks`。

### 任务 6：执行最终质量门禁、审查和提交

- [x] **步骤 1：运行完整质量门禁**

执行：

```powershell
pnpm lint
pnpm typecheck
pnpm build
git diff --check
```

预期：所有命令退出码均为 `0`，无 lint、类型、构建或空白错误。

- [x] **步骤 2：使用 `trellis-check` 审查实现；当前环境未提供 `superpowers:requesting-code-review`，由主会话直接代码审查替代**

重点核对：不可用旧快照排除、状态数量闭合、URL 自修复、SSE 单连接与批量刷新、历史正文授权、目录选择功能无回归、四档响应式和 PRD 每条验收标准。发现问题先修复并重新执行受影响验证。

- [x] **步骤 3：执行完成前证据复核**

使用 `superpowers:verification-before-completion` 读取并确认最后一次质量命令、HTTP 断言和 Playwright 结果，再更新本计划与 PRD 验收项。不得以旧输出或推测声明完成。

- [ ] **步骤 4：仅提交本任务文件**

执行：

```powershell
git status --short
git add src/shared/api.ts src/server/api/project-api-service.ts src/server/api/project-routes.ts src/web/api-client.ts src/web/hooks/useTaskCenter.ts src/web/hooks/useProjectConsole.ts src/web/components/TaskCenter.tsx src/web/components/ProjectSidebar.tsx src/web/components/TaskBrowser.tsx src/web/App.tsx src/web/formatters.ts src/web/styles.css .trellis/spec/backend/readonly-api-contract.md .trellis/spec/frontend/readonly-console-contract.md .trellis/tasks/07-19-cross-project-task-center
git diff --cached --check
git commit -m "feat: 添加跨项目任务中心"
```

预期：提交只包含任务中心源码、可执行合同和任务文档，不覆盖或回退目录选择功能，也不包含临时 fixture、应用数据或无关用户改动。

## 风险与回滚点

- `src/shared/api.ts`：目录选择合同位于同一文件，必须增量添加并保留 `DirectoryPicker*` Schema 和类型。
- `src/server/api/project-api-service.ts`：聚合必须一次读取注册表与快照；若出现性能或合同问题，可先回滚 `/api/tasks`，不影响单项目 API。
- `src/web/hooks/useProjectConsole.ts`：顶层模式、URL、任务跳转和 SSE 都在此汇合；每完成一项先验证现有项目选择、文档白名单和目录选择，再进入下一项。
- `src/web/hooks/useTaskCenter.ts`：筛选和汇总保持纯 DTO 计算；出现 UI 回归时可独立回滚 Hook 与页面，不影响现有 Project Workspace。
- `src/web/styles.css`：只新增任务中心选择器并在现有媒体查询追加规则，不重写全局色彩、侧栏或 TaskBrowser 基础布局。
- 回滚顺序：先移除侧栏入口和 `TaskCenter` 渲染，再移除 Hook/URL/SSE 增量，最后删除 `/api/tasks` 与共享 DTO；持久化文件无需迁移或恢复。

## 实施前检查

- [x] 用户已审阅 `prd.md`、`design.md` 和本 `implement.md`。
- [x] 用户明确允许开始实施后，才运行 `task.py start` 和创建任务分支。
- [x] 不创建 worktree，不新增测试类或仓库内独立测试文件。
- [x] 实施前重新读取目录选择提交后所有冲突文件，禁止覆盖 `d96dc58` 已落地能力。
