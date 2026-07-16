# 本地服务可执行合同

## 场景：第一阶段本地 HTTP 运行骨架

### 1. 范围与触发条件

修改以下任一内容时必须遵守本合同：服务启动脚本、监听地址、端口处理、`/api/health`、生产静态托管、前后端健康状态联通。

### 2. 签名

- 开发启动：`pnpm dev`
- 生产构建：`pnpm build`
- 生产启动：`pnpm start`
- 健康接口：`GET /api/health`
- 服务入口：`src/server/index.ts`
- 共享合同：`HealthResponse`、`isHealthResponse(value: unknown)`

### 3. 合同

服务默认监听：

```text
host = 127.0.0.1
port = PORT 或 3100
```

健康接口无请求体，成功响应为：

```typescript
interface HealthResponse {
  status: "ok";
  service: "trellis-visual-console";
  timestamp: string;
}
```

- `timestamp` 使用 `Date#toISOString()`。
- `PORT` 可选；必须是 `1..65535` 的整数，否则回退到 `3100`。
- `NODE_ENV=production` 由 `pnpm start` 设置，用于启用 `dist/web` 静态托管和自动打开浏览器。
- 服务不接受前端传入任意绝对路径，也不读取被浏览项目。

### 4. 校验与错误矩阵

| 条件 | 行为 |
| --- | --- |
| `PORT` 缺失 | 使用 `3100` |
| `PORT` 非整数、非正数或超过 `65535` | 回退到 `3100` |
| 未知 `/api/*` 路径 | 返回 `404` 与 `{ "message": "接口不存在" }` |
| 生产浏览器自动打开失败 | 记录警告，服务继续运行 |
| 服务监听失败 | 输出“本地服务启动失败”并以非零状态退出 |
| Web 收到非 2xx 健康响应 | 页面展示连接失败与 HTTP 状态 |
| Web 收到不符合 DTO 的 JSON | 页面展示“健康检查返回格式不正确” |

### 5. 正常、基础与异常用例

- 正常：`pnpm start` 后首页与 `/api/health` 均返回 `200`，浏览器展示“本地服务已连接”。
- 基础：未设置 `PORT` 时只监听 `127.0.0.1:3100`。
- 异常：访问 `/api/missing` 返回 `404`，不能回退成 Web 首页。
- 异常：浏览器无法自动打开时，不得关闭已启动的服务。

### 6. 必需验证

项目默认不生成测试文件，除非用户明确要求。本合同变更至少验证：

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm start
curl http://127.0.0.1:3100/api/health
curl -I http://127.0.0.1:3100/
```

断言点：监听地址为回环地址；健康字段完整；首页为 `200`；未知 API 为 `404`；退出信号释放端口。

### 7. 错误与正确示例

错误：对外绑定所有网卡，或在前后端重复定义响应字段。

```typescript
await server.listen({ host: "0.0.0.0", port: 3100 });
type PageHealth = { ok: boolean };
```

正确：固定回环地址，并复用共享 DTO 与运行时守卫。

```typescript
await server.listen({ host: "127.0.0.1", port: 3100 });
const payload: unknown = await response.json();
if (!isHealthResponse(payload)) {
  throw new Error("健康检查返回格式不正确");
}
```
