# 桌面 Command 与 Event 可执行合同

## Command

固定命令包括：

```text
list_projects             list_tasks
get_project               scan_projects
register_projects         remove_project
set_project_focus
refresh_project           read_spec_document
read_task_detail          read_task_document
open_project_path         select_directory
open_log_directory        clear_application_data_and_exit
check_for_update          install_update
restart_application
```

- 请求对象和响应 DTO 使用 camelCase 字段，Command 名使用 snake_case。
- Core 返回 `Result<T, CommandError>`；错误固定包含 `code`、中文 `message` 和可选 `details`。
- Command 错误不得包含 HTTP 状态、堆栈、绝对项目路径或底层错误原文。
- 同步文件系统工作必须在线程池执行，不能阻塞窗口线程。
- `src/shared/api.ts` 是前端 Zod 线协议合同；任何字段变更必须同步 Rust Serde DTO 并做真实序列化对照。
- `install_update` 的 Channel payload 也属于 IPC 合同，必须逐条经过 Zod 校验；更新 DTO 详见 `desktop-updater-contract.md`。

## Event

- 固定事件名为 `trellis://project-realtime`。
- payload 使用 `ProjectRealtimeEvent`，只包含 ID、项目 ID、资源、失效范围、时间和监听模式。
- 事件不得包含正文、完整快照、绝对路径或底层错误。
- Tauri adapter 只把 Core `EventSink` 发布到主窗口，不解析领域内容。

## 验证

- 全部真实 Command 成功响应通过对应 Zod Schema。
- 结构化错误通过 `ApiErrorResponseSchema`，未知错误使用稳定回退。
- Rust 事件通过 `isProjectRealtimeEvent`。
- 非 Tauri 页面明确返回 `desktop-runtime-unavailable`，不得回退 HTTP。

## 场景：项目移除 Command

### 1. 范围 / 触发条件

- 新增或修改项目移除 IPC、响应 DTO、错误映射或前端消费时适用。

### 2. 签名

```text
remove_project({ projectId: string })
  -> { projectId: string, removed: true }
```

```rust
ApplicationService::remove_project(&self, project_id: &str)
  -> Result<ProjectRemoveResponse, CommandError>
```

### 3. 合同

- Command 名固定为 `remove_project`，请求字段为 camelCase `projectId`。
- Rust `ProjectRemoveResponse` 使用 `camelCase + deny_unknown_fields`；前端使用严格 Zod Schema，`removed` 必须为字面量 `true`。
- Tauri adapter 只把调用放入 Core 线程池，不复制存储、watcher 或选择修复规则。
- 成功前清理应用内登记、摘要、活动运行时和临时正文授权；源项目保持只读。

### 4. 校验与错误矩阵

| 条件 | 稳定结果 |
| --- | --- |
| 项目存在且清理完成 | `{ projectId, removed: true }` |
| 项目不存在或重复移除 | `project-not-found` |
| 存储或补偿失败 | `project-operation-failed` 或现有稳定存储错误 |
| watcher 关闭失败 | `project-watcher-unavailable`，但已移除运行时不得重新进入 Map |
| 应用正在关闭 | `application-closing` |
| 成功响应字段缺失、额外或 `removed !== true` | 前端 `invalid-command-response` |

### 5. Good / Base / Bad Cases

- Good：共享 Schema、Rust DTO、Tauri 注册和客户端调用四层字段完全一致。
- Base：不存在的 ID 返回稳定错误，前端重新读取权威项目列表。
- Bad：组件直接调用 `invoke`，或把重复删除伪装成成功。

### 6. 必需验证与断言点

- 使用真实序列化结果通过 `ProjectRemoveResponseSchema`，并让未知字段与 `removed: false` 校验失败。
- `rg` 核对 Command 名、请求字段和响应字段在四层一致。
- 真实隔离应用登记后移除，断言注册表、快照、任务中心和当前详情均无该 ID。
- 注入项目不存在、存储失败和 watcher 关闭失败，断言错误码不泄漏路径或底层原文。

### 7. Wrong vs Correct

#### Wrong

```tsx
invoke("remove_project", { id: projectId });
```

#### Correct

```tsx
removeProject(projectId); // 集中客户端负责 invoke 和严格 Schema 校验
```
