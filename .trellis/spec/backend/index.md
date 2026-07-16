# 后端开发规范

> 本目录只记录已在项目中落地的后端约定；尚未实现的能力保持“待建立”，不要提前编造规范。

## 规范索引

| 规范 | 说明 | 状态 |
| --- | --- | --- |
| [目录结构](./directory-structure.md) | Node 服务与共享类型的目录边界 | 已建立 |
| [本地服务合同](./local-service-contract.md) | 启动命令、监听地址、健康接口和静态托管合同 | 已建立 |
| [本机存储合同](./local-storage-contract.md) | 注册表、快照、版本、原子写和损坏恢复合同 | 已建立 |
| [错误处理](./error-handling.md) | 当前启动、接口与浏览器打开错误处理 | 已建立 |
| [质量规范](./quality-guidelines.md) | TypeScript、检查命令与测试边界 | 已建立 |
| [数据库规范](./database-guidelines.md) | 首版不使用数据库的边界 | 已建立 |
| [日志规范](./logging-guidelines.md) | 结构化日志字段与级别约定 | 已建立 |

## 开发前检查

1. 修改服务启动、HTTP 路由或静态托管前，阅读 `local-service-contract.md`。
2. 新增服务模块前，阅读 `directory-structure.md`。
3. 修改注册表、快照、应用数据路径或 JSON 写入前，阅读 `local-storage-contract.md`。
4. 修改错误响应或启动失败行为前，阅读 `error-handling.md`。
5. 写完代码后执行 `pnpm lint`、`pnpm typecheck`、`pnpm build`。

## 质量检查

- 服务仍默认绑定 `127.0.0.1`。
- `/api` 之外的静态托管没有扩展到源项目目录。
- 前后端共享 DTO 仍由 `src/shared` 单点定义。
- 应用持久化 Schema 仍由 `src/server/storage/models.ts` 单点定义。
- 没有因骨架改动提前引入数据库、扫描、监听、SSE 或 Core SDK。
