# 阶段三项目扫描与内容解析

## 目标

建立只读的 Trellis 项目发现与索引层：从用户指定目录发现有效项目，支持单项目手动登记，将 `.trellis/` 内容转换为稳定摘要快照，并为后续 API 提供受路径约束的 Markdown 按需读取能力。

## 背景与已确认事实

- `.trellis/` 文件仍是唯一事实来源，索引结果和历史快照都不能反向写回。
- 有效项目至少包含 `.trellis/config.yaml`、`.trellis/spec/` 和 `.trellis/tasks/`。
- `config.yaml` 的 `packages` 映射描述 monorepo 包；单仓库项目可能没有该字段。
- 活动任务位于 `.trellis/tasks/<task>/`，归档任务位于 `.trellis/tasks/archive/<year-month>/<task>/`。
- 不同 Trellis 版本的 `task.json` 字段可能变化，历史文件甚至可能不是合法 JSON；单个坏任务不得阻塞项目索引。
- Spec 以目录和 Markdown 文件为主；Markdown 正文不进入摘要快照。
- 本阶段不实现 HTTP API、Web UI、焦点监听或 SSE。

## 需求

1. 实现指定扫描根目录的递归项目发现，返回项目候选和扫描诊断。
2. 跳过 `.git`、`node_modules`、`dist`、`build`、`coverage`、`.cache`、`.next`、`.turbo`、`target` 等无关目录。
3. 不跟随符号链接；扫描根目录通过 `realpath` 固定，避免链接逃逸。
4. 校验单项目根目录和 `.trellis` 结构；`.trellis` 本身或必需目录为符号链接时判定无效。
5. 使用项目真实路径的 SHA-256 摘要生成稳定项目 ID。
6. 解析 `config.yaml` 的 monorepo 包名称和路径；YAML 缺失、语法或结构异常产生诊断。
7. 生成 Spec 目录树，只包含目录和 Markdown 文件，跳过符号链接和非 Markdown 文件。
8. 解析活动/归档任务摘要：ID、标题、状态、阶段、负责人、包、修改时间和源路径。
9. 对缺失或异常 `task.json`、活动任务缺失 `prd.md`、非法 JSONL、不可读文件返回带源路径的诊断，并继续处理其他任务。
10. 解析 Workflow 名称、阶段标题和当前阶段；当前阶段根据活动任务状态推断，优先级为执行中高于规划中。
11. 生成并保存项目摘要快照，包含概览、Spec 树、Task 摘要、Workflow 摘要、索引时间和诊断。
12. 实现单项目登记和批量登记：新项目默认 `history`；重复路径更新索引与快照，不重复写注册表。
13. 快照先保存、注册表后保存，避免注册表出现没有快照的新项目。
14. 实现 Markdown 按需读取，只接受项目 `.trellis/` 内的相对 `.md` 路径；使用真实路径校验阻止目录穿越和符号链接逃逸。
15. 所有文件读取使用 UTF-8；非法 UTF-8 作为诊断或读取错误返回。
16. 所有新增方法添加中文注释，关键路径边界和容错流程添加中文说明。
17. 本阶段不生成测试文件。

## 验收标准

- [x] 扫描包含多个项目和忽略目录的临时根目录，只返回有效 Trellis 项目。
- [x] 符号链接形式的项目、`.trellis` 或子内容不会被跟随。
- [x] 单仓库和配置了 `packages` 的 monorepo 都能生成正确项目概览。
- [x] 当前项目可生成 Spec 树、活动/归档 Task 摘要和 Workflow 摘要。
- [x] 一个坏 `task.json` 或 JSONL 只产生诊断，不影响其他任务和项目。
- [x] 手动登记后注册表和快照可重新加载，重复登记不会产生重复路径。
- [x] Markdown 读取可以返回合法正文，并拒绝绝对路径、`..` 穿越、非 Markdown 和链接逃逸。
- [x] 删除或重建应用快照不会修改 fixture 项目的 `.trellis/` 文件。
- [x] 不存在新增 HTTP API、UI、监听器、SSE 或 Core SDK 依赖。
- [x] `pnpm lint`、`pnpm typecheck`、`pnpm build` 全部通过。

## 不在本阶段范围内

- 浏览器目录选择、项目列表或内容浏览 API。
- 项目聚焦、重新索引调度、文件监听、轮询降级和 SSE。
- Markdown HTML 渲染与安全清理。
- 任务状态变更、文件编辑、外部编辑器打开。
- Workspace、Mem、Channel、Runtime 和 Core SDK。
