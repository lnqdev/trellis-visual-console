# 阶段五只读 HTTP API 与 Web UI 技术设计

## 总体数据流

```text
React 页面
  ├─ HTTP：项目列表、扫描、登记、详情、文档和操作
  └─ SSE：轻量失效事件
        ↓
Fastify API
  ├─ ProjectApiService：DTO 投影与业务编排
  ├─ ProjectCatalog：注册表/快照查询与扫描登记
  ├─ ProjectRealtimeManager：聚焦、刷新和运行时状态
  ├─ TaskReader / MarkdownReader：受保护内容读取
  └─ ProjectEventHub：SSE 订阅源
```

页面不理解存储文件格式，不直接读取文件系统；路由不直接操作 JSON 存储或拼接用户路径。

## 模块边界

```text
src/shared/
├── api.ts                     # API Zod Schema、DTO 与统一错误合同
└── project-events.ts          # 已有 SSE 事件合同

src/server/api/
├── project-api-service.ts     # 项目/内容 DTO 投影与操作编排
├── project-routes.ts          # HTTP 参数校验、状态码和响应
└── project-events-route.ts    # SSE 响应、心跳与连接清理

src/server/projects/
├── task-reader.ts             # Task 文档发现和受保护读取
└── project-file-opener.ts     # 已登记项目范围内的外部打开

src/web/
├── api-client.ts
├── hooks/useProjectConsole.ts
├── components/
│   ├── ProjectSidebar.tsx
│   ├── ProjectDiscovery.tsx
│   ├── ProjectHeader.tsx
│   ├── ProjectOverview.tsx
│   ├── SpecBrowser.tsx
│   ├── TaskBrowser.tsx
│   ├── WorkflowPanel.tsx
│   ├── DiagnosticsPanel.tsx
│   └── DocumentViewer.tsx
├── App.tsx
└── styles.css
```

不引入路由或全局状态库。`App` 组合功能域组件，`useProjectConsole` 集中管理服务端数据、操作和 SSE；局部展开、选中项和表单输入留在对应组件或 Hook。

## HTTP API

### 项目集合

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| GET | `/api/projects` | 无 | 项目列表及运行时状态 |
| POST | `/api/projects/scan` | `{ rootPath }` | 未持久化候选与扫描诊断 |
| POST | `/api/projects/register` | `{ projects: [{ path, label? }] }` | 每个项目的登记结果 |

### 单项目

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| GET | `/api/projects/:projectId` | 无 | 注册项、运行时状态和快照 |
| POST | `/api/projects/:projectId/focus` | `{ focused }` | 更新后的项目详情 |
| POST | `/api/projects/:projectId/refresh` | 无 | 更新后的项目详情 |
| GET | `/api/projects/:projectId/spec-document` | `?path=` | Markdown 正文与元数据 |
| GET | `/api/projects/:projectId/task-detail` | `?sourcePath=` | Task 摘要与文档清单 |
| GET | `/api/projects/:projectId/task-document` | `?taskSourcePath=&path=` | Markdown/JSONL 正文 |
| POST | `/api/projects/:projectId/open` | `{ sourcePath?: string }` | `{ opened: true }` |

`projectId` 只用于查注册表；内容接口中的相对路径必须先匹配当前快照或 Task 文档清单，再进入 realpath 边界读取。扫描和登记是唯一允许接收本机绝对路径的接口，因为它们的产品职责就是让用户显式选择项目；这些路径不会被通用内容读取接口复用。

## API DTO

共享 `api.ts` 使用 Zod 单点定义：

- `ApiErrorResponse`
- `ProjectListItem` / `ProjectListResponse`
- `ProjectDetailResponse`
- `ProjectScanRequest` / `ProjectScanResponse`
- `ProjectRegisterRequest` / `ProjectRegisterResponse`
- `ProjectFocusRequest`
- `ProjectDocumentResponse`
- `TaskDetailResponse`
- `OpenProjectPathRequest` / `OpenProjectPathResponse`

项目详情快照包含 `overview`、`specTree`、`tasks`、`workflow` 和 `diagnostics`。服务端从存储模型显式投影为 API DTO；Web UI 只消费共享 Schema 解析后的值。

## ProjectCatalog 查询扩展

新增只读方法：

- `listProjectData()`：在存储队列中读取注册表与快照并配对。
- `getProjectData(projectId)`：返回单个注册项及可空快照。

这些方法不访问源项目，保证项目列表与历史详情只读缓存。API 合并 `ProjectRealtimeManager#getRuntimeStatus()` 形成页面状态。

## Task 内容读取

`task-reader.ts` 不接受任意任务目录：

1. API 从当前项目快照中按 `sourcePath` 找到 Task 摘要。
2. `sourcePath` 必须指向 `.trellis/tasks/**/task.json`。
3. 任务根目录由该已知路径推导，并再次校验位于项目 `.trellis/tasks/` 内。
4. 递归列出普通 `.md` 和 `.jsonl` 文件，跳过符号链接。
5. 文档读取要求请求路径精确命中文档清单，再使用 `lstat + realpath` 确认没有目录穿越或链接逃逸。

Markdown 返回 `format=markdown`；JSONL 返回 `format=jsonl`。两者都使用严格 UTF-8。

## 外部打开

复用现有 `open` 包：

- `sourcePath` 缺失时打开项目根目录。
- 非空路径必须是项目相对路径、不得含原始 `..`，最终真实路径位于项目根目录内；`.trellis` 内容必须仍在真实 `.trellis` 根内。
- API 不接收可执行文件、命令、参数或应用名称，只调用 `open(resolvedPath)`。
- 打开失败返回通用中文错误，日志不记录完整绝对路径。

## SSE

`GET /api/events` 使用 Fastify 原始响应：

```text
Content-Type: text/event-stream; charset=utf-8
Cache-Control: no-cache, no-transform
Connection: keep-alive
X-Accel-Buffering: no
```

连接建立后写入注释帧，之后每条事件使用：

```text
id: <event.id>
data: <JSON(ProjectRealtimeEvent)>

```

不设置自定义 `event:` 字段，Web UI 统一使用 `EventSource#onmessage` 和共享守卫解析。15 秒发送一次注释心跳；`close`/`aborted` 时取消订阅和定时器，清理函数必须幂等。

## Web 状态模型

`useProjectConsole` 管理：

- 项目列表、当前项目详情和请求状态。
- 当前视图：`overview | spec | tasks | workflow | diagnostics`。
- 当前 Spec 路径、Task `sourcePath` 和 Task 文档路径。
- 扫描、登记、刷新、聚焦和外部打开操作。
- SSE 连接与事件驱动刷新。

URL 查询参数只保存稳定选择信息：`project`、`view`、`spec`、`task`、`document`。参数不作为信任来源，所有数据仍由 API 校验。项目或文件消失时 Hook 清理失效选择并回退到可用视图。

## 页面信息架构

```text
┌────────────── 项目导航 ──────────────┬──────────── 主工作区 ────────────┐
│ 品牌 / 服务状态 / 添加项目           │ 项目标题、路径、状态、操作        │
│ 焦点项目                              │ Overview | Spec | Tasks | Flow   │
│ 历史项目                              │                                  │
│ 不可用项目                            │ 当前视图内容                     │
└───────────────────────────────────────┴──────────────────────────────────┘
```

- 桌面端侧栏约 300px，主区自适应；Spec/Task 内部再使用列表 + 阅读器双栏。
- 1024px 以下减少双栏宽度；768px 以下项目导航改为顶部块，内部列表与正文纵向堆叠。
- 所有页面固定显示源路径、快照时间和实时性，不让历史快照看起来像实时源数据。
- 无项目时直接展示发现面板；有项目时发现面板作为侧栏按钮打开的主区卡片。

## 视觉系统

采纳 `ui-ux-pro-max` 中适合开发者工具的 Swiss Modernism、Data-Dense Dashboard 和 Knowledge Base 建议，拒绝其不适合本产品的 Vibrant/Newsletter 推荐：

- 背景：`#0f172a`，侧栏/卡片：`#111c2f` / `#172236`。
- 主文本：`#f8fafc`，次文本：`#94a3b8`，边框：`#2b3a50`。
- 状态/操作强调：`#22c55e`；警告 `#f59e0b`；错误 `#f87171`；链接 `#60a5fa`。
- 8px 基础间距，12–16px 圆角，阴影只用于层级，不使用玻璃、霓虹或布局位移动画。
- 字体使用 Inter 回退系统无衬线；路径、JSONL 和代码使用系统等宽字体。

## Markdown 安全

使用 `react-markdown` + `remark-gfm`，不安装或启用 `rehype-raw`。原始 HTML 作为文本忽略，不进入 DOM。外部链接增加 `target="_blank"` 和 `rel="noreferrer"`，代码块、表格和引用由受控组件样式渲染。

## 依赖选择

- `react-markdown`：安全 Markdown → React 渲染。
- `remark-gfm`：表格、任务列表和删除线。
- `lucide-react`：统一、可访问的 SVG 图标。

不引入 React Router、React Query、Zustand、Redux、Tailwind 或组件库；当前数据规模和页面数量用原生 Hook 与 CSS 足够。

## 回滚与兼容性

- 不修改注册表或快照版本；API 只投影现有数据。
- 删除 `src/server/api/`、Task reader、共享 API DTO 和 Web 页面即可回滚，阶段二至阶段四能力保持可用。
- SSE 断线不影响源项目监听和快照更新；页面可通过手动刷新恢复。
- Markdown 渲染失败只影响当前文档区域，不应导致项目导航不可用。
