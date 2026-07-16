# 前端开发规范

> 本目录记录已落地的 React/Vite 约定；组件库、路由和状态管理尚未选型，不提前设定。

## 规范索引

| 规范 | 说明 | 状态 |
| --- | --- | --- |
| [目录结构](./directory-structure.md) | React 页面与共享类型边界 | 已建立 |
| [类型安全](./type-safety.md) | API 响应的共享 DTO 与运行时校验 | 已建立 |
| [质量规范](./quality-guidelines.md) | React、可访问性与检查门禁 | 已建立 |
| [组件规范](./component-guidelines.md) | 可复用组件约定 | 待正式页面阶段建立 |
| [Hook 规范](./hook-guidelines.md) | 数据读取与 Hook 约定 | 待正式页面阶段建立 |
| [状态管理](./state-management.md) | 本地、服务端与全局状态边界 | 待正式页面阶段建立 |

## 开发前检查

1. 新增 API 消费前阅读 `type-safety.md`。
2. 新增页面或组件目录前阅读 `directory-structure.md`。
3. 不因页面壳提前引入路由、全局状态或组件库。

## 质量检查

- Web 只通过 `/api` 访问本地服务，不直接读取文件系统。
- 未知接口响应先按 `unknown` 接收并在边界校验。
- 用户可见文案和代码注释使用中文。
- 执行 `pnpm lint`、`pnpm typecheck`、`pnpm build`。
