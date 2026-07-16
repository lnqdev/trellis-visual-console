# 本机存储可执行合同

## 场景：版本化项目注册表与摘要快照

### 1. 范围与触发条件

修改应用数据目录、`registry.json`、`snapshots.json`、存储 Schema、文件版本、损坏恢复或原子写入时，必须遵守本合同。该存储只属于可视化应用，禁止作为源项目 `.trellis/` 的写入通道。

### 2. 签名

- 路径入口：`resolveApplicationPaths(dataDirectoryOverride?)`
- 应用入口：`createApplicationStorage(dataDirectoryOverride?)`
- 初始化：`ApplicationStorage#initialize()`
- 读取：`JsonFileStore#load()`
- 保存：`JsonFileStore#save(data)`
- 版本错误：`UnsupportedStorageVersionError`
- 环境变量：`TRELLIS_VISUAL_CONSOLE_DATA_DIR`

### 3. 合同

固定文件：

```text
<应用数据目录>/registry.json
<应用数据目录>/snapshots.json
```

两个文件的根对象都必须包含：

```typescript
{ version: 1 }
```

- 注册表 Schema：`ProjectRegistryFileSchema`。
- 快照 Schema：`ProjectSnapshotsFileSchema`。
- 项目状态只能是 `history | focus | unavailable`。
- 注册表中的项目 ID 和项目路径不能重复。
- 快照对象键必须与内部 `projectId` 一致。
- Spec 文件节点的 `children` 必须为空。
- 日期时间使用 ISO 8601 UTC 字符串。
- 默认目录根据操作系统解析，不从项目路径推导。

### 4. 校验与错误矩阵

| 条件 | 行为 |
| --- | --- |
| 文件不存在 | 创建版本 1 默认文件 |
| JSON 语法损坏 | 隔离为 `.corrupt-*`，恢复默认文件 |
| Schema 校验失败 | 隔离为 `.corrupt-*`，恢复默认文件 |
| 数值 `version` 不等于当前版本 | 抛出 `UnsupportedStorageVersionError`，保留原文件 |
| 保存数据不符合 Schema | 保存前抛出 Zod 错误，不创建临时文件 |
| 文件系统权限或磁盘错误 | 向调用方传播，服务启动失败 |
| 同一实例并发保存 | 按调用顺序串行执行，最后一次调用最终落盘 |

### 5. 正常、基础与异常用例

- 正常：保存项目注册表和完整摘要快照后，新存储实例可无损加载。
- 基础：首次启动只生成 `{ version: 1, projects: [] }` 和 `{ version: 1, snapshots: {} }`。
- 异常：重复项目 ID、重复项目路径、快照键不一致或文件节点包含子节点时拒绝保存。
- 异常：未来版本文件不能被当前程序当成损坏文件覆盖。
- 隔离：删除应用数据目录只删除应用配置和缓存，不影响源项目文件。

### 6. 必需验证

项目默认不生成测试文件。本合同变更至少验证：

```bash
pnpm lint
pnpm typecheck
pnpm build
TRELLIS_VISUAL_CONSOLE_DATA_DIR=<临时目录> pnpm start
```

使用临时目录断言：默认文件创建；注册表和快照往返一致；损坏文件有隔离副本；不兼容版本字节不变；并发保存最终值正确；删除应用目录后独立源文件仍存在。

### 7. 错误与正确示例

错误：直接写目标文件，或把版本不兼容当作损坏恢复。

```typescript
await writeFile(registryFile, JSON.stringify(data));
if (data.version !== 1) {
  await writeDefaultFile();
}
```

正确：所有注册表和快照写入复用 `JsonFileStore`，先校验、再同步临时文件、最后原子重命名；版本不兼容直接拒绝。

```typescript
const storage = createApplicationStorage();
await storage.registry.save(registry);

if (actualVersion !== STORAGE_VERSION) {
  throw new UnsupportedStorageVersionError(filePath, actualVersion, STORAGE_VERSION);
}
```
