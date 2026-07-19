# 只读项目 HTTP API 与 SSE 可执行合同

## 1. 范围与触发条件

修改项目列表、扫描登记、项目详情、焦点/刷新操作、Spec/Task 内容读取、外部打开、系统目录选择、SSE 路由或共享 API DTO 时，必须遵守本合同。源项目始终只读；允许写入的范围仅为应用数据目录中的注册表和快照。

## 2. 接口签名

| 方法 | 路径 | 请求 | 响应 |
| --- | --- | --- | --- |
| GET | `/api/projects` | 无 | `ProjectListResponse` |
| POST | `/api/projects/scan` | `{ rootPath }` | `ProjectScanResponse`，不持久化 |
| POST | `/api/projects/register` | `{ projects: [{ path, label? }] }` | `ProjectRegisterResponse` |
| GET | `/api/projects/:projectId` | 无 | `ProjectDetailResponse`，包含 `contentReadable` |
| POST | `/api/projects/:projectId/focus` | `{ focused }` | `ProjectActionResponse` |
| POST | `/api/projects/:projectId/refresh` | 无 | `ProjectActionResponse` |
| GET | `/api/projects/:projectId/spec-document` | `?path=` | `ProjectDocumentResponse` |
| GET | `/api/projects/:projectId/task-detail` | `?sourcePath=` | `TaskDetailResponse` |
| GET | `/api/projects/:projectId/task-document` | `?taskSourcePath=&path=` | `ProjectDocumentResponse` |
| POST | `/api/projects/:projectId/open` | `{ sourcePath? }` | `{ opened: true }` |
| POST | `/api/system/directories/select` | 严格 JSON `{}` | `{ status: "selected", path } \| { status: "cancelled" }` |
| GET | `/api/events` | SSE | `ProjectRealtimeEvent` 数据帧 |

共享运行时 Schema 和类型统一位于 `src/shared/api.ts`；SSE 事件合同统一位于 `src/shared/project-events.ts`。

## 3. 合同

- JSON 请求和响应必须在边界通过共享 Zod Schema 校验，路由与页面不得私自重定义 DTO。
- 项目列表和详情只组合注册表、最后快照与运行时状态；历史项目的 GET 请求不得访问源文件系统。
- `ProjectDetailResponse.contentReadable` 是正文读取的统一判定：焦点项目为 `true`；历史项目初始为 `false`，只有在当前服务进程内显式刷新成功后为 `true`；服务重启、刷新失败或移出焦点后恢复为 `false`。该状态不写入注册表或快照。
- 扫描只返回候选；登记、刷新和焦点切换才可更新应用自己的注册表与快照。
- Spec/Task 正文服务必须先校验 `contentReadable`，再执行快照白名单和 `.trellis` realpath 边界读取；页面限制不能替代服务端校验。
- Spec 路径必须先命中当前快照 Spec 树，再通过 `.trellis` realpath 边界读取。
- Task 必须先由快照中的 `sourcePath` 定位，再读取该 Task 清单中已列出的 `.md` 或 `.jsonl` 文档。
- 外部打开只接受已登记项目根目录或项目相对 `.trellis/**` 路径，不接受绝对路径、`..`、命令或启动参数。
- 系统目录选择仅在 Windows 和 macOS 调用本机原生对话框；Linux 返回稳定的不支持错误，页面继续允许手工输入。
- 目录选择成功只返回用户确认的绝对路径，取消属于正常结果；选择动作本身不得扫描、登记、读取或持久化该目录。
- 原生目录选择命令必须使用参数化进程调用，不拼接页面输入；服务端日志不得记录选择结果或命令参数中的本机路径。
- 目录选择请求必须使用严格 JSON `{}`，避免跨站简单请求直接触发本机系统对话框。
- `GET /api/events` 使用 `text/event-stream`，15 秒注释心跳；事件只携带 ID、项目 ID、资源、失效范围、时间戳和监听模式。
- `TRELLIS_VISUAL_CONSOLE_DATA_DIR` 只覆盖应用数据目录，不改变源项目只读边界。

## 4. 校验与错误矩阵

| 条件 | HTTP / 行为 |
| --- | --- |
| 请求体、查询或参数不符合 Schema | `400 invalid-request`，返回字段级说明 |
| 项目、Spec、Task 或 Task 文档不存在 | `404 resource-not-found` |
| 历史项目尚未显式刷新，或项目不可用 | `409 project-content-unavailable`，不进入源文件读取 |
| 绝对路径、原始 `..`、符号链接或 realpath 逃逸 | `400 unsafe-project-path` |
| 项目资源权限不足 | `403 project-access-denied` |
| 已有目录选择对话框等待操作 | `409 directory-picker-busy` |
| 当前平台不支持原生目录选择 | `501 directory-picker-unsupported` |
| 系统目录选择命令无法启动或异常退出 | `500 directory-picker-unavailable` |
| 未知内部错误 | `500 internal-error`，响应和日志不记录本机绝对路径或正文 |
| 手动登记路径不存在 | 登记结果 `invalid`，诊断消息为中文“项目路径不存在” |
| 扫描根目录不存在或无权限 | 返回中文扫描诊断，无候选 |
| SSE 客户端关闭或请求中止 | 立即取消订阅、清除心跳并移除连接 |

## 5. 正常、基础与异常用例

- 正常：焦点项目文件变化先更新快照，再通过轻量 SSE 使页面重新查询详情和当前文档。
- 基础：历史项目详情从快照返回，`watchMode=stopped`，不会创建监听器。
- 正常：历史项目显式刷新成功后 `contentReadable=true`，可按需读取正文但仍为 `history`、`watchMode=stopped`；服务重启后重新变为摘要模式。
- 异常：直接调用历史项目的 Spec、Task 详情或 Task 文档接口统一返回 `409`，即使请求路径命中快照白名单也不能绕过。
- 正常：重复登记同一真实路径更新原记录，不新增重复项目。
- 正常：Windows 或 macOS 用户确认目录后接口返回绝对路径，用户取消时返回 `cancelled` 且不产生错误响应。
- 异常：Linux 调用目录选择接口返回中文 501 错误，现有扫描和手工登记接口仍可使用。
- 异常：请求不在 Spec 树中的 Markdown 路径返回 404，即使文件在磁盘上真实存在。
- 异常：Task 文档路径未列入 Task 清单、包含 `..` 或通过链接逃逸时拒绝读取。
- 异常：Markdown 原始 HTML 不通过 API 执行；API 只返回文本，渲染安全由前端合同负责。

## 6. 必需验证

默认不生成测试文件。合同变更至少执行：

```bash
pnpm lint
pnpm typecheck
pnpm build
git diff --check
```

临时 fixture 必须断言：扫描不持久化、批量登记、重复登记、历史详情零源读取、历史正文刷新前统一 `409`、刷新后正文 `200` 且仍零监听、服务重启后授权清除、焦点进出、Spec/Task 白名单、外部打开越界拒绝、SSE 轻量事件和连接清理。浏览器验证必须确认接口错误无堆栈、无未知 4xx/5xx。

## 7. 错误与正确示例

错误：路由直接拼接页面传入路径读取文件，或把完整快照塞入 SSE。

```typescript
const content = await readFile(resolve(project.path, request.query.path), "utf8");
response.write(`data: ${JSON.stringify(snapshot)}\n\n`);
```

正确：服务层先校验正文读取资格，再校验快照白名单并复用受保护读取；SSE 只通知失效。

```typescript
const data = await this.requireReadableProjectData(projectId);
if (data.snapshot === null || !containsSpecFile(data.snapshot.specTree, sourcePath)) {
  throw new ProjectApiNotFoundError("当前项目快照中不存在指定 Spec 文档");
}
const document = await readProjectMarkdown(data.project.path, sourcePath);
response.write(`data: ${JSON.stringify(event)}\n\n`);
```
