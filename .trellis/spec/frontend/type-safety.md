# 前端类型安全

## IPC 边界

- Tauri `invoke` 返回值先按 `unknown` 接收，再使用对应 Zod Schema 校验。
- Command reject 值同样按 `unknown` 接收，先过 `ApiErrorResponseSchema`。
- 非法成功响应转换为 `ApiClientError("invalid-command-response")`。
- 非法错误响应转换为 `unknown-command-error`，不得展示任意对象或底层原文。
- `ApiClientError` 只包含稳定 code、中文 message 和 details，不包含 HTTP 状态。
- `AbortSignal` 只表达调用前后取消；IPC 过期提交由 Hook 的请求代次负责。

## 共享合同

- `src/shared/api.ts` 定义 Command DTO 和 Zod Schema。
- `src/shared/project-events.ts` 定义事件字段、枚举和守卫。
- Rust Serde DTO 字段、null/可选语义和 ISO UTC 时间必须与共享合同一致。
- 禁止 `any`、无依据断言或绕过 Schema 直接使用 IPC 数据。
- Tauri Channel 消息与 Command 返回值具有同等信任边界；每条消息先按 `unknown` 解析，任一非法消息必须使当前操作失败，不能忽略后继续报告成功。
