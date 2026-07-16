# 阶段二本机注册表与摘要快照技术设计

## 模块边界

```text
src/server/storage/
├── application-paths.ts   # 解析操作系统应用数据目录
├── models.ts              # Zod 数据合同与 TypeScript 类型
├── json-file-store.ts     # 版本检查、原子写、损坏隔离和写入串行化
└── application-storage.ts # registry/snapshots 两个专用存储入口
```

本阶段的存储模块只处理应用自有 JSON，不读取或修改任何项目 `.trellis/`。服务启动时只初始化默认文件，后续项目扫描和解析模块再调用公开的 `load`、`save` 方法。

## 应用数据目录

默认目录：

- macOS：`~/Library/Application Support/Trellis Visual Console`
- Windows：`%APPDATA%/Trellis Visual Console`
- Linux：`$XDG_CONFIG_HOME/trellis-visual-console`，未配置时使用 `~/.config/trellis-visual-console`

开发、验证和未来打包场景可以设置 `TRELLIS_VISUAL_CONSOLE_DATA_DIR`，其值会解析为绝对路径。默认目录解析不读取任何项目路径；覆盖值是调用方显式指定的应用数据位置。

## 数据合同

### 注册表

```typescript
interface ProjectRegistryFile {
  version: 1;
  projects: RegisteredProject[];
}
```

`RegisteredProject` 保存 `id`、`path`、`label`、`state`、`lastAccessedAt`、`lastIndexedAt` 和可空错误信息。`state` 遵循规划文档中的 `history | focus | unavailable` 生命周期。

### 摘要快照

```typescript
interface ProjectSnapshotsFile {
  version: 1;
  snapshots: Record<string, ProjectSnapshot>;
}
```

每个 `ProjectSnapshot` 以项目稳定 ID 为键，保存项目概览、递归 Spec 树、活动/归档 Task 摘要、Workflow 摘要、索引时间和诊断。Markdown 正文不进入快照。

## 安全读写

1. 保存前使用 Zod 校验完整数据结构。
2. 在目标文件同目录创建独占临时文件。
3. 写入 UTF-8 格式化 JSON，调用文件句柄 `sync()`。
4. 关闭句柄后使用 `rename()` 原子替换目标文件。
5. 无论成功失败都清理临时文件。
6. 每个存储实例维护 Promise 写队列，保证进程内保存顺序。

文件权限在支持的平台上使用目录 `0700`、文件 `0600`。

## 恢复与版本策略

- 文件不存在：写入版本 1 默认结构并返回。
- JSON 无法解析或 Zod 校验失败：重命名为 `<name>.corrupt-<timestamp>.json`，创建默认文件，并返回恢复记录。
- `version` 是数字但不等于 `1`：抛出 `UnsupportedStorageVersionError`，不移动、不重写原文件。
- 文件系统权限、磁盘空间、重命名失败：向调用方传播错误，不伪装为正常空数据。

## 服务集成

`startServer()` 在监听端口前初始化 `ApplicationStorage`。损坏恢复通过 Fastify 日志记录文件类型和备份路径；应用数据绝对路径不通过 HTTP 返回。

## 依赖选择

新增 `zod` 作为唯一阶段二运行依赖，用同一 Schema 同时完成运行时校验和 TypeScript 类型推导，避免手写接口与校验器漂移。不引入数据库、ORM、文件监听或状态管理依赖。
