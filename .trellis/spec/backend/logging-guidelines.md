# 后端日志规范

## 当前实现

本地服务使用 Fastify 内置结构化日志。正常 HTTP 请求由 Fastify 记录，应用代码只补充有运维价值的生命周期和恢复事件。

## 级别

- `info`：服务监听成功、收到退出信号等正常生命周期。
- `warn`：非致命降级或已完成恢复，例如浏览器自动打开失败、损坏数据已隔离并恢复。
- `error`：服务无法启动等致命错误，由进程入口输出并以非零状态退出。
- 当前不使用业务 `debug` 日志。

## 结构化字段

损坏恢复日志使用：

```typescript
{
  file: "registry.json",
  backup: "registry.corrupt-<timestamp>-<uuid>.json",
  reason: "invalid-json" | "invalid-structure",
  message: "校验失败原因"
}
```

只记录应用数据文件名，不通过 HTTP 或日志记录已登记项目的绝对路径、Markdown 内容或源文件正文。

## 禁止记录

- 被浏览项目的完整文件内容。
- 未来可能出现的访问令牌、密钥或个人敏感信息。
- 为调试方便而长期保留的无结构 `console.log`。
