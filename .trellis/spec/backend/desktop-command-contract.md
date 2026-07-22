# 桌面 Command 与 Event 可执行合同

## Command

固定命令包括：

```text
list_projects             list_tasks
get_project               scan_projects
register_projects         set_project_focus
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
