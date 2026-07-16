# 阶段五只读 HTTP API 与 Web UI 实施计划

## 实施清单

1. 添加 `react-markdown`、`remark-gfm` 和 `lucide-react` 依赖。
2. 在 `src/shared/api.ts` 定义项目、扫描、登记、详情、文档、操作和错误响应的 Zod Schema、类型与解析入口。
3. 扩展 `ProjectCatalog` 的只读注册表/快照配对查询，不访问历史项目源文件。
4. 实现 Task 文档发现与受保护读取：已知任务摘要定位、允许扩展名、严格 UTF-8、符号链接和 realpath 边界。
5. 实现已登记项目目录和 `.trellis` 合法源路径的外部打开能力，拒绝绝对路径、`..`、链接逃逸和命令参数。
6. 实现 `ProjectApiService`，集中完成存储模型到共享 DTO 投影、扫描/登记、聚焦/刷新和内容读取编排。
7. 实现项目集合与单项目 Fastify 路由，使用共享请求 Schema 校验并统一映射 400/404/409/500 中文错误。
8. 实现 SSE 路由、15 秒心跳、事件序列化和连接幂等清理。
9. 在服务启动阶段注册 API/SSE 路由，保留现有健康接口、回环监听和生产静态托管合同。
10. 实现前端 `api-client.ts`，所有响应按 `unknown` 接收并通过共享 Schema 解析，支持 AbortSignal。
11. 实现 `useProjectConsole`：项目列表、详情、URL 查询参数、SSE、选中资源、操作状态和错误恢复。
12. 实现项目侧栏、状态分组、服务连接状态和发现入口。
13. 实现扫描/批量登记和手动添加面板，使用明确的本机绝对路径文本输入说明。
14. 实现项目头部、刷新、焦点切换、外部打开和实时/历史/不可用提示。
15. 实现 Overview、Spec、Task、Workflow 和 Diagnostics 功能域组件。
16. 实现安全 Markdown、JSONL 和空/加载/错误状态组件；统一 Lucide 图标与语义化按钮。
17. 重写全局样式为信息密集的深色开发者控制台，完成 375/768/1024/1440 响应式和 reduced-motion 规则。
18. 使用临时 fixture 启动服务，通过 curl 验证扫描、登记、列表、详情、焦点、刷新、Spec、Task、外部打开拒绝和 SSE 事件格式。
19. 使用浏览器流程验证无项目、扫描登记、焦点/历史导航、各内容页、错误状态、实时刷新和窄屏布局。
20. 复核只读边界，比较 fixture 项目 `.trellis` 文件摘要，确认浏览、刷新、聚焦和打开没有写源文件。
21. 复核范围，确认没有数据库、WebSocket、路由库、状态库、CSS 框架、Core SDK 或应用内编辑。
22. 运行 `pnpm lint`、`pnpm typecheck`、`pnpm build` 和生产启动检查。

## 实施结果

- [x] 1–17：共享合同、服务端 API/SSE、受保护内容读取、前端 Hook/组件和响应式视觉系统已完成。
- [x] 18：临时 fixture HTTP 与 SSE 验收通过。
- [x] 19：Playwright 项目发现、内容浏览、错误、实时刷新和窄屏验收通过。
- [x] 20：源项目 `.trellis` 摘要对比一致，只读边界通过。
- [x] 21：范围复核通过，未引入禁止依赖或编辑能力。
- [x] 22：lint、typecheck、build、生产启动和 `git diff --check` 通过。

## 风险文件与回滚点

- `src/shared/api.ts`：服务端与页面共同依赖，字段必须单点定义且运行时可校验。
- `src/server/api/project-routes.ts`：扫描/登记允许绝对路径，但内容读取接口绝不能复用该信任边界。
- `src/server/projects/task-reader.ts`：任务目录和文档路径必须从快照白名单出发，再做 realpath 校验。
- `src/server/api/project-events-route.ts`：断开连接后必须取消订阅和心跳，避免内存泄漏。
- `src/web/hooks/useProjectConsole.ts`：请求取消、SSE 重连和选择清理容易产生卸载后更新或陈旧状态。
- `src/web/styles.css`：双栏内容需在窄屏改为纵向，不能靠固定宽度造成水平滚动。

## 验证命令

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm start
```

HTTP 与 SSE 使用临时应用数据目录和临时 Trellis fixture 验证；浏览器验证优先使用 Playwright MCP。默认不在仓库生成测试文件。

## 启动前复核

- 阶段五允许写应用自己的注册表/快照，不允许写被查看项目。
- 扫描/登记路径输入与内容读取路径输入使用不同信任边界。
- 历史项目详情来自快照，只有显式刷新或聚焦才访问源项目。
- 原始 Markdown HTML 不进入 DOM。
- SSE 只通知失效，页面重新查询 HTTP API。
- 目录选择使用路径文本输入，原生选择器不进入首版。
