# 后端质量规范

## 必需规则

- 使用严格 TypeScript：`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`。
- 方法与函数定义添加中文注释，关键边界流程添加必要的行内注释。
- 服务主机固定为 `127.0.0.1`；未经产品范围变更不得改为局域网或公网监听。
- 新增依赖前确认它对应当前阶段的明确需求，不提前引入数据库、监听器、WebSocket 或 Core SDK。
- 共享接口类型只在 `src/shared` 定义一次。

## 验证门禁

```bash
pnpm lint
pnpm typecheck
pnpm build
```

默认不生成测试文件；用户明确要求或进入高风险路径解析阶段时，再按任务规划增加相应验证。

## 禁止模式

- `any`、无依据类型断言、关闭 ESLint/TypeScript 规则规避问题。
- 为单次使用逻辑创建没有实际复用者的抽象层。
- 在健康接口或日志中暴露本机项目路径。
