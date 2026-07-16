# 后端错误处理

## 当前约定

- 路由内的预期资源不存在使用明确 HTTP 状态码和中文消息，不把未知 `/api` 路径回退为 SPA 首页。
- 服务启动失败必须让进程以非零状态退出，避免用户误以为服务可用。
- 非关键辅助能力失败不得拖垮主服务；当前示例是自动打开浏览器失败只记录警告。
- 进程收到 `SIGINT` 或 `SIGTERM` 时先关闭 Fastify，再退出进程。
- 应用数据 JSON 损坏或结构非法时保留隔离副本并恢复默认数据。
- 数据文件版本不兼容时必须停止初始化并保留原文件，不能自动降级或覆盖。
- 文件权限、磁盘空间和重命名错误直接向上抛出，由启动入口以非零状态退出。

## 示例

```typescript
server.setNotFoundHandler(async (request, reply) => {
  if (request.url.startsWith("/api/")) {
    return reply.code(404).send({ message: "接口不存在" });
  }

  return reply.sendFile("index.html");
});
```

## 禁止做法

- 禁止吞掉监听失败后继续运行。
- 禁止向接口调用方返回本机堆栈、绝对路径或 Trellis 文件内容。
- 禁止用一个笼统的 SPA 回退掩盖 API 404。
- 禁止把版本不兼容错误当作普通损坏恢复。
- 禁止隔离失败后继续覆盖原数据。
