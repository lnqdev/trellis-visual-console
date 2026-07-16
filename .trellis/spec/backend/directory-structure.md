# 后端目录结构

## 当前布局

```text
src/
├── server/
│   └── index.ts       # Fastify 服务入口、基础路由和进程生命周期
└── shared/
    └── health.ts      # 不依赖 Node/浏览器运行时的共享 DTO 与守卫
```

编译产物固定输出到：

```text
dist/
├── server/            # Node 服务
├── shared/            # 服务运行时使用的共享模块
└── web/               # Vite 静态资源
```

## 模块约定

- `src/server` 只放本地服务能力，不放 React 组件。
- `src/shared` 只放前后端都能运行的纯 TypeScript 合同，不允许导入 `node:*`、React 或浏览器全局对象。
- 当前只有一个服务入口，不为单次使用逻辑提前拆分 service、repository、utils 等抽象。
- 后续新增扫描、解析或监听模块时，按职责放入 `src/server` 子目录，并让路由只依赖服务层公开接口。

## 命名与导入

- TypeScript 文件使用小写短横线或领域名；React 组件例外，使用 PascalCase。
- Node ESM 内部相对导入必须写编译后的 `.js` 后缀，例如：

```typescript
import { SERVICE_NAME } from "../shared/health.js";
```

- 不把面向 UI 的 DTO 重复定义在服务路由中，统一放入 `src/shared`。

## 现有示例

- 服务入口：`src/server/index.ts`
- 共享健康合同：`src/shared/health.ts`
