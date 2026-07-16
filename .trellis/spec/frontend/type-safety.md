# 前端类型安全

## 类型组织

- API 请求与响应 DTO 放在 `src/shared`，由服务端和 Web UI 共同导入。
- 组件局部状态类型留在组件文件附近，例如 `App.tsx` 的 `ConnectionState`。
- 从网络、JSON 或未来文件解析边界进入的数据先视为 `unknown`，通过共享守卫后再使用。

## 当前模式

```typescript
const payload: unknown = await response.json();
if (!isHealthResponse(payload)) {
  throw new Error("健康检查返回格式不正确");
}

setConnection({ status: "connected", health: payload });
```

联合类型的状态分支使用 `switch` 穷尽处理，避免多个组件分散判断同一状态含义。

## 禁止模式

```typescript
// 禁止：在组件里私自重定义接口并直接断言。
const payload = (await response.json()) as { ok: boolean };
```

- 禁止 `any`。
- 禁止对未经校验的接口响应直接做类型断言。
- 禁止在多个消费者中重复解析同一个未类型化字段。
