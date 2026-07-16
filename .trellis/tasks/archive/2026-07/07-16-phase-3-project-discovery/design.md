# 阶段三项目扫描与内容解析技术设计

## 模块边界

```text
src/server/projects/
├── project-models.ts      # 发现、校验、登记和读取结果类型
├── project-paths.ts       # 稳定 ID、项目内相对路径和 realpath 边界
├── project-validator.ts   # Trellis 项目结构校验
├── project-scanner.ts     # 扫描根目录递归发现
├── trellis-indexer.ts     # YAML、Spec、Task、Workflow 索引
├── markdown-reader.ts     # 项目内 Markdown 按需读取
└── project-catalog.ts     # 扫描、登记、存储编排
```

## 数据流

```text
扫描根目录
  → 跳过目录与符号链接
  → 发现 .trellis
  → 结构校验
  → TrellisIndexer 生成 ProjectSnapshot
  → 返回候选（扫描不持久化）

手动/批量登记
  → 结构校验与索引
  → 保存 snapshots.json
  → 更新 registry.json
```

## 扫描与路径安全

- 扫描根目录先 `realpath`，之后只使用目录句柄递归普通目录。
- 所有符号链接直接跳过，不解析其目标。
- `.trellis` 候选不继续向下扫描，避免把任务或 Spec 子目录误识别成项目。
- 项目 ID 为 `sha256(realProjectPath)` 的固定十六进制前缀，不依赖显示名称。
- Markdown 读取要求输入为相对路径、扩展名 `.md`，真实文件必须位于 `realpath(<project>/.trellis)` 内。

## 解析策略

### 配置和包

使用 `yaml` 包解析 `config.yaml`。只消费 `packages` 映射中的包名、`path` 和可选 `type`；未知字段忽略。配置异常时包列表为空并记录错误诊断，项目仍继续索引。

### Spec

递归遍历 `.trellis/spec`，目录和 `.md` 文件转换为 `SpecTreeNode`。非 Markdown 文件忽略；符号链接跳过并记录警告。正文不读取。

### Task

- 活动任务只读取 `.trellis/tasks` 的直接子目录。
- 归档任务递归查找 `.trellis/tasks/archive` 下包含 `task.json` 的目录。
- `task.json` 使用宽容 Zod Schema：识别当前字段，未知字段保留兼容；缺少字段时按目录名回退并记录诊断。
- 状态映射：`planning → plan`、`in_progress → execute`、`completed → completed`，未知状态的阶段为空。
- `updatedAt` 使用 `task.json` 文件修改时间。
- 活动任务缺少 `prd.md` 记录警告；存在的 `.jsonl` 文件逐行验证 JSON。

### Workflow

读取 `workflow.md` 的 UTF-8 文本：首个 H1 为名称，`### Phase N: ...` 标题形成阶段表。项目当前阶段根据活动任务状态推断：存在 `in_progress` 为 `execute`；否则存在 `planning` 为 `plan`；否则为空。

## 容错与诊断

诊断统一复用 `SnapshotDiagnostic`，`sourcePath` 对项目内文件使用相对项目路径。单文件解析错误不会抛出到项目级；结构校验失败、扫描根目录不存在等无法继续的情况返回失败结果。

## 登记语义

- 新项目写入 `history` 注册项，`lastAccessedAt` 和 `lastIndexedAt` 使用当前索引时间。
- 重复真实路径复用原稳定 ID 和状态，更新快照、索引时间、错误摘要；仅在调用方显式提供 label 时更新显示名。
- 如果项目快照含错误诊断，注册表 `error` 保存第一条错误；仅有警告时保持为空。
- 先保存快照，再保存注册表；失败向调用方传播，不伪装成功。

## 按需 Markdown

`readProjectMarkdown(projectRoot, relativePath)` 只返回 UTF-8 文本、相对源路径和文件修改时间。它不渲染 Markdown，也不读取 JSON/YAML/任意文件。

## 依赖选择

新增 `yaml` 作为唯一阶段三依赖。目录扫描、SHA-256、UTF-8 校验和路径边界全部使用 Node.js 标准库；继续复用现有 Zod 和应用存储层。
