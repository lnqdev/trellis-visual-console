# 修复阶段六验收问题

## 目标

修复阶段六复核发现的三项验收缺陷，重新证明历史项目的源文件读取边界、项目快速切换的数据一致性，以及归档 Task 的 URL/跨项目恢复行为符合首版 PRD。

## 背景与已确认事实

- `docs/planning/prd.md` 规定历史项目只展示摘要快照，不持续访问源文件系统；详细 Markdown 和 Task 文档来自源项目，必须由受控状态和用户显式操作保护。
- `ProjectApiService#readSpecDocument`、`readTaskDetail`、`readTaskDocument` 当前只校验快照白名单，没有统一校验项目状态，导致 `history` 项目可直接访问源文件。
- 现有注册表只有 `history | focus | unavailable` 三种持久化状态；显式刷新后的正文资格只需在当前本地服务进程内生效，不应新增注册表版本或长期授权状态。
- `useProjectConsole#loadDetail` 的普通切换请求由 Effect 取消，但 SSE 后台刷新和重试等无信号调用仍可能在项目切换后返回并覆盖当前详情。
- `TaskBrowser` 的活动/归档集合只用 `initialCollection` 初始化一次，后续 URL 恢复、项目切换或选择归档任务不会同步标签。
- 项目约定默认不生成测试类；本次使用临时 fixture、受控请求、HTTP 和 Playwright 完成回归。

## 需求

1. 在服务层为三个正文相关方法复用同一正文资格校验；尚未显式刷新的 `history` 和全部 `unavailable` 项目不得进入源文件读取流程，错误必须使用稳定中文和稳定错误码，不暴露路径或正文。
2. 历史项目仍可通过项目详情查看摘要快照、最后索引时间、Spec 树和 Task 摘要；显式刷新成功后可在当前服务进程内按需读取完整正文，但不启动监听；加入焦点后持续开放正文并启动监听。
3. 前端不得为 `contentReadable=false` 的项目自动选择 Spec 文件、Task 或 Task 文档，不得发送三个正文请求；Spec/Task 视图应隐藏或禁用正文读取入口，并给出可操作的中文提示。
4. `loadDetail` 必须使用请求代次、当前项目引用或等价机制丢弃过期响应；普通切换、后台 SSE 刷新、手动重试和项目操作后的详情更新均不得让旧项目覆盖当前项目。
5. `TaskBrowser` 必须根据当前选中 Task 所属集合持续同步活动/归档标签；URL 恢复到归档 Task、项目切换和程序化选择归档 Task 时都应显示归档集合。
6. 不引入 Core SDK、数据库、WebSocket、路由库或全局状态库，不扩大首版产品范围。
7. 更新阶段六验证报告，记录三项缺陷、修复方案、验证证据和质量门禁结果。
8. 只有在相关证据通过后，才勾选 `docs/planning/prd.md` 对应验收项。

## 验收标准

- [x] 尚未显式刷新的 `history` 项目，其 Spec 正文、Task 详情和 Task 文档接口均返回受控拒绝，且已确认不会触达源文件读取函数。
- [x] `focus` 项目仍可读取快照白名单内的 Spec、Task 详情和 Task 文档；路径边界保护保持不变。
- [x] 历史项目初始只展示摘要信息，Spec/Task 正文入口不可用且不会产生正文网络请求；显式刷新或加入焦点后入口恢复。
- [x] 快速切换两个项目并让前一个详情请求延迟返回时，页面和 URL 始终保持最后选择项目，不显示旧详情。
- [x] 归档 Task URL 可恢复到归档标签；跨项目切换后标签与当前选择/可用 Task 集合一致；选择归档 Task 会同步切换标签。
- [x] `docs/validation/phase-6-report.md` 已补充复核结果、验证步骤和证据。
- [x] `docs/planning/prd.md` 只有在证据完成后才更新对应验收勾选状态。
- [x] `pnpm lint`、`pnpm typecheck`、`pnpm build`、`git diff --check` 全部通过。

## 不在本任务范围内

- 新增数据库、WebSocket、Core SDK、鉴权系统或历史正文缓存。
- 修改源项目 `.trellis` 文件、增加应用内编辑能力或持久化正文授权。
- 新增仓库测试类、worktree、安装包、CI runner 或长期监控服务。
