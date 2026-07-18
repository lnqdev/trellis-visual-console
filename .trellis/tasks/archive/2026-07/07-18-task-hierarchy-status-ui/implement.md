# 任务层级与状态展示实施计划

## 1. 数据合同与索引

- [x] 扩展 `src/server/storage/models.ts` 的 Task 快照 Schema，增加已解析关系字段，并兼容旧快照。
- [x] 重构 `src/server/projects/trellis-indexer.ts` 为任务基础读取、跨集合关系解析和诊断三个步骤。
- [x] 覆盖缺失引用、自引用、循环、重复引用和双向不一致的安全降级。
- [x] 扩展 `src/shared/api.ts` 的 Task DTO 合同；现有 API 快照投影自动复用共享字段，无需额外服务层复制。

## 2. 页面交互

- [x] 在 `src/web/formatters.ts` 补齐 `review`、`done` 和未知状态展示规则。
- [x] 将 `src/web/components/TaskBrowser.tsx` 改为可折叠树形列表，保持任务详情和文档阅读现有职责。
- [x] 实现活动/归档独立展开状态、选中任务祖先自动展开和三级视觉缩进上限。
- [x] 实现跨集合直接子任务进度、归档子任务聚焦栏及清除操作。
- [x] 实现详情区可点击父级面包屑和统一跨 Tab 任务导航。
- [x] 在 `src/web/styles.css` 增加状态、树线、深度标记、聚焦栏和面包屑样式。

## 3. 验证

- [x] 使用临时 fixture 验证多层任务、活动父任务 + 归档子任务、无序输入、循环关系、缺失引用、`review`、`done` 和未知状态。
- [x] 使用 Playwright 验证展开/收起、Tab 数量、归档聚焦、清除聚焦、面包屑导航和 URL 深层任务恢复。
- [x] 使用 Playwright 检查 375px、768px、1024px、1440px，无页面级水平滚动或文本遮挡。
- [x] 运行 `pnpm lint`。
- [x] 运行 `pnpm typecheck`。
- [x] 运行 `pnpm build`。

## 4. 风险文件与回滚点

- `src/server/storage/models.ts`：严格持久化 Schema，必须先验证现有版本 1 快照兼容读取。
- `src/server/projects/trellis-indexer.ts`：索引错误不得阻断其他 Task；关系解析完成后再接入 UI。
- `src/web/components/TaskBrowser.tsx`：保留活动/归档与当前选择同步逻辑，避免 URL 恢复回归。
- `src/web/hooks/useProjectConsole.ts`：仅在现有选择入口不足时做最小调整，不把树折叠状态提升到主 Hook。
- 回滚顺序：先恢复平铺渲染，再移除 API/快照关系字段；文档读取合同保持不变。

## 5. 实施前检查

- [x] 用户已审阅 `prd.md`、`design.md`、`implement.md`。
- [x] 获得明确实施许可后再运行 `task.py start`。
- [x] 不生成测试类或独立测试文件，验证使用临时 fixture、现有质量命令和 Playwright 流程。
