# 修复阶段六验收问题实施计划

## 实施清单

1. [x] 在 `ProjectApiService` 增加正文读取状态的统一校验，并在路由层映射稳定错误码和中文消息。
2. [x] 在 `useProjectConsole` 增加当前项目 ref 和详情请求代次，覆盖普通请求、SSE 后台刷新、重试与项目操作返回。
3. [x] 在 Hook 和 `App` 中阻止正文不可读项目触发请求，隐藏或替换 Spec/Task 正文入口。
4. [x] 修复 `TaskBrowser` 活动/归档集合与选中 Task、URL 恢复和跨项目切换的同步。
5. [x] 使用临时 fixture 验证历史项目三个正文接口拒绝、显式刷新后恢复、服务重启后清除和焦点项目正常读取。
6. [x] 使用 Playwright 验证项目详情延迟竞态、历史正文入口、归档 Task URL 恢复和跨项目切换。
7. [x] 更新 `docs/validation/phase-6-report.md`，记录缺陷、证据和回归结果。
8. [x] 证据通过后勾选 `docs/planning/prd.md` 对应验收项。
9. [x] 执行 `pnpm lint`、`pnpm typecheck`、`pnpm build`、`git diff --check`。
10. [x] 使用 `trellis-check` 进行后端、前端和跨层全量复核，并更新后端 API、前端 Hook、组件和控制台可执行规范。
11. [x] 按 Phase 3.4 提交代码和文档，再使用 `trellis-finish-work` 归档任务并记录 journal。

## 风险文件

- `src/server/api/project-api-service.ts`：服务层校验顺序必须确保未获正文资格的历史项目在任何源文件读取前被拒绝。
- `src/server/api/project-routes.ts`：错误码不能被 404/500 分支吞并。
- `src/web/hooks/useProjectConsole.ts`：详情代次、选择 ref 和资源选择清理必须保持一致，避免引入新的 URL 抖动。
- `src/web/components/TaskBrowser.tsx`：集合同步 Effect 不能与首项自动选择形成循环。
- `src/web/App.tsx`：正文资格限制不能影响概览、Workflow、诊断和既有项目操作。

## 验证命令

```bash
pnpm lint
pnpm typecheck
pnpm build
git diff --check
```

HTTP、延迟请求和浏览器流程使用独立 `/tmp` fixture 与应用数据目录，不写入仓库测试文件，不污染用户应用数据。
