# 前端开发规范

> 本目录记录已落地的 React/Vite 约定；组件库、路由和状态管理尚未选型，不提前设定。

## 规范索引

| 规范 | 说明 | 状态 |
| --- | --- | --- |
| [目录结构](./directory-structure.md) | React 页面与共享类型边界 | 已建立 |
| [类型安全](./type-safety.md) | API 响应的共享 DTO 与运行时校验 | 已建立 |
| [质量规范](./quality-guidelines.md) | React、可访问性与检查门禁 | 已建立 |
| [组件规范](./component-guidelines.md) | 功能域组件、可访问性和文档渲染约定 | 已建立 |
| [Hook 规范](./hook-guidelines.md) | API、URL、请求取消和 SSE 数据流约定 | 已建立 |
| [状态管理](./state-management.md) | 本地、服务端、URL 和派生状态边界 | 已建立 |
| [只读控制台合同](./readonly-console-contract.md) | 页面状态、失效选择、SSE 和响应式验收合同 | 已建立 |

## 开发前检查

1. 新增 API 消费前阅读 `type-safety.md` 和 `readonly-console-contract.md`。
2. 新增页面或组件前阅读 `directory-structure.md`、`component-guidelines.md`。
3. 修改服务端状态、URL 状态或 SSE 同步前阅读 `hook-guidelines.md`、`state-management.md`。
4. 不因局部交互引入路由、全局状态或组件库。

## 质量检查

- Web 只通过 `/api` 访问本地服务，不直接读取文件系统。
- 未知接口响应先按 `unknown` 接收并在边界校验。
- 项目或资源切换不会展示上一选择的陈旧正文，也不会请求失效 URL 路径。
- SSE 连接不会因视图或文档标签切换反复重建。
- 用户可见文案和代码注释使用中文。
- 执行 `pnpm lint`、`pnpm typecheck`、`pnpm build`。
