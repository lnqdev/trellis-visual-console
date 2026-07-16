# 项目发现与内容解析可执行合同

## 场景：只读发现、索引和登记 Trellis 项目

### 1. 范围与触发条件

修改扫描目录、项目结构校验、Trellis YAML/JSON/JSONL/Markdown 解析、摘要快照生成、项目登记或 Markdown 按需读取时，必须遵守本合同。源项目始终只读。

### 2. 签名

- 结构校验：`ProjectValidator#validate(projectPath)`
- 递归扫描：`ProjectScanner#scan(scanRoot)`
- 项目索引：`TrellisIndexer#index(project)`
- 扫描候选：`ProjectCatalog#scan(scanRoot)`
- 单个登记：`ProjectCatalog#registerProject(projectPath, label?)`
- 批量登记：`ProjectCatalog#registerProjects(projects)`
- Markdown 读取：`readProjectMarkdown(projectRoot, relativePath)`
- 稳定 ID：`createStableProjectId(realProjectPath)`

### 3. 合同

- 有效项目必须包含普通目录 `.trellis/spec`、`.trellis/tasks` 和普通文件 `.trellis/config.yaml`。
- 项目根目录、`.trellis` 和必需入口不能是符号链接。
- 扫描忽略 `.git`、`node_modules`、构建产物和已知缓存目录，不跟随任何符号链接。
- 项目 ID 为真实路径 SHA-256 的前 24 位十六进制字符串。
- `config.yaml` 只消费 `packages` 映射中的名称、路径、可选类型和 `git` 标记。
- Spec 树只包含目录和 `.md` 文件；正文不进入快照。
- 活动任务读取直接子目录；归档任务递归读取 `tasks/archive` 下包含 `task.json` 的目录。
- 单个坏 `task.json`、JSONL 或 Workflow 只生成 `SnapshotDiagnostic`，不终止其他文件索引。
- 用户可见的解析和读取诊断必须使用稳定中文消息；诊断 `code` 与 `sourcePath` 用于程序化定位，不得把 YAML、JSON、Zod、文件系统或 UTF-8 解码器的原始错误文本直接返回页面。
- 扫描只返回候选，不写应用数据；显式登记才先保存快照、再更新注册表。
- Markdown 输入必须是项目根目录相对路径、位于 `.trellis/`、扩展名 `.md`，且真实路径仍在 `.trellis` 内。

### 4. 校验与错误矩阵

| 条件 | 行为 |
| --- | --- |
| 扫描根目录不存在、不是目录或是符号链接 | 返回错误诊断，无候选 |
| 遇到普通符号链接 | 跳过，不跟随 |
| 遇到符号链接 `.trellis` | 跳过并记录警告 |
| 缺少必需 Trellis 结构 | 项目无效，不生成候选 |
| YAML 语法或结构异常 | 包列表为空，记录错误，继续索引 |
| `task.json` 缺失或非法 | 使用目录名回退摘要，记录错误，继续索引 |
| JSONL 某行非法 | 记录文件和行号，继续其他文件 |
| 解析器或文件系统抛出带平台细节的错误 | 保留稳定诊断 code 和源路径，消息转换为中文领域描述，不暴露原始错误文本 |
| Workflow 缺失或不可读 | Workflow 字段降级，记录警告 |
| Markdown 路径为绝对路径、含原始 `..`、不是 `.md` | 抛出 `UnsafeProjectPathError` |
| Markdown 文件或 `.trellis` 为符号链接 | 抛出 `UnsafeProjectPathError` |
| 真实 Markdown 路径逃逸 `.trellis` | 抛出 `UnsafeProjectPathError` |
| 重复登记相同真实路径 | 更新快照和原注册项，不新增重复路径 |

### 5. 正常、基础与异常用例

- 正常：扫描根目录发现单仓库和 monorepo，生成包、Spec、Task、Workflow 摘要。
- 基础：无 `packages` 配置时项目包列表为空，项目仍有效。
- 兼容：历史非法 `task.json` 只显示目录名回退摘要并产生诊断。
- 兼容：坏 YAML、JSON 和 JSONL 的诊断消息为稳定中文，不随依赖版本或操作系统错误文本变化。
- 安全：`node_modules` 内项目和符号链接项目不会成为候选。
- 安全：`.trellis/spec/../spec/index.md` 即使规范化后仍在目录内，也必须因原始 `..` 被拒绝。
- 隔离：删除应用快照不改变 fixture 项目任何文件。

### 6. 必需验证

项目默认不生成测试文件。本合同变更至少验证：

```bash
pnpm lint
pnpm typecheck
pnpm build
```

临时 fixture 断言：扫描忽略目录；链接不被跟随；单仓库与 monorepo 包信息正确；坏 YAML/JSON/JSONL 只产生带 code、源路径和中文消息的诊断，且响应不包含解析器原文或堆栈；重复登记不重复；Markdown 合法读取且路径攻击被拒绝。

真实项目断言：当前项目和 Trellis monorepo 都能索引；旧版非法任务文件不阻塞其他 200+ 归档任务。

### 7. 错误与正确示例

错误：先规范化路径再检查 `..`，或直接拼接前端输入读取文件。

```typescript
const normalized = posix.normalize(relativePath);
return readFile(resolve(projectRoot, normalized));
```

正确：先拒绝原始上级目录片段，再校验扩展名、文件类型和最终 realpath 边界。

```typescript
if (slashPath.split("/").includes("..")) {
  throw new UnsafeProjectPathError("Markdown 路径不能包含上级目录片段");
}

if (!isPathInsideOrEqual(realTrellisRoot, realCandidatePath)) {
  throw new UnsafeProjectPathError("Markdown 路径超出项目 .trellis 边界");
}
```

错误：把底层解析器消息直接作为页面诊断，导致英文文本、依赖实现和本机路径泄露。

```typescript
catch (error) {
  diagnostics.push({ code: "task-json-invalid", message: getErrorMessage(error), sourcePath });
}
```

正确：对外保留稳定 code 和源路径，消息使用领域中文；需要底层细节时只在受控服务日志中记录错误类型。

```typescript
catch {
  diagnostics.push({
    severity: "error",
    code: "task-json-invalid",
    message: "task.json 不是合法 JSON",
    sourcePath,
  });
}
```
