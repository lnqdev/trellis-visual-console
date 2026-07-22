# 后端开发规范

## 规范索引

| 规范 | 说明 |
| --- | --- |
| [目录结构](./directory-structure.md) | Rust Core 与 Tauri adapter 边界 |
| [桌面运行合同](./desktop-runtime-contract.md) | 启动、单实例、系统集成与退出 |
| [桌面在线更新合同](./desktop-updater-contract.md) | Updater Command、签名、状态存储、发布与升级验收 |
| [本机存储合同](./local-storage-contract.md) | 版本 2、迁移、原子写与清理 |
| [项目发现合同](./project-discovery-contract.md) | 扫描、索引、正文与路径安全 |
| [实时更新合同](./project-realtime-contract.md) | watcher、轮询、队列与事件 |
| [桌面 Command 合同](./desktop-command-contract.md) | IPC DTO、错误和系统操作 |
| [错误处理](./error-handling.md) | 稳定错误、初始化失败与降级 |
| [日志规范](./logging-guidelines.md) | 受控 JSONL、轮转与隐私 |
| [质量规范](./quality-guidelines.md) | Rust/前端门禁与依赖边界 |
| [数据库规范](./database-guidelines.md) | 首版不使用数据库 |

## 开发前检查

1. 修改 Core 或 adapter 前阅读 `directory-structure.md`。
2. 修改启动、窗口、插件、目录选择、外部打开或退出前阅读 `desktop-runtime-contract.md`。
3. 修改存储、迁移和数据清理前阅读 `local-storage-contract.md`。
4. 修改扫描、索引、正文或路径前阅读 `project-discovery-contract.md`。
5. 修改焦点、监听、事件或轮询前阅读 `project-realtime-contract.md`。
6. 修改 Command、DTO 或错误映射前阅读 `desktop-command-contract.md` 和 `error-handling.md`。

## 质量检查

- `trellis-core` 正常依赖树不包含 Tauri、HTTP 框架、窗口或插件类型。
- 源项目保持只读；应用写入只发生在固定应用数据目录。
- Command/Event DTO 与前端 Zod/守卫字段一致。
- 历史项目零监听，焦点项目只监听允许路径。
- 日志和错误不包含绝对项目路径、正文、命令参数、堆栈或底层错误原文。
- 生产应用没有 Node/Fastify、本地 HTTP 服务或 sidecar。
