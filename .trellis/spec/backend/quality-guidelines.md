# 后端质量规范

## 必需规则

- 使用严格 TypeScript：`strict`、`noUncheckedIndexedAccess`、`exactOptionalPropertyTypes`。
- 方法与函数定义添加中文注释，关键边界流程添加必要的行内注释。
- 服务主机固定为 `127.0.0.1`；未经产品范围变更不得改为局域网或公网监听。
- 新增依赖前确认它对应当前阶段的明确需求，不提前引入数据库、监听器、WebSocket 或 Core SDK。
- 共享接口类型只在 `src/shared` 定义一次。
- 版本化应用数据的 Zod Schema 只在 `src/server/storage/models.ts` 定义；除递归类型外，TypeScript 类型从 Schema 推导。
- 注册表与快照必须复用 `JsonFileStore`，不要分别实现 JSON 写入和损坏恢复。
- 应用数据写入使用 UTF-8、同目录临时文件、文件同步和原子重命名。
- 源项目文件读取使用严格 UTF-8；扫描和索引不得写入源项目。
- 路径安全必须同时检查原始输入、文件类型和最终 `realpath` 包含关系。
- 外部 YAML、JSON 和 JSONL 只在各自解析边界转换一次，消费者使用类型化结果。
- 单文件容错必须保留诊断的项目相对源路径。

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
- 绕过 Schema 直接把未知 JSON 断言为存储类型。
- 直接覆盖目标 JSON 文件，或在版本不兼容时重建默认文件。
- 先规范化再忽略原始 `..` 片段。
- 跟随符号链接扫描项目或读取 Markdown。
- 在多个消费者中重复解析原始 `task.json` 字段。
