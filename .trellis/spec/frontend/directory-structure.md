# 前端目录结构

## 当前布局

```text
src/web/
├── index.html
├── main.tsx                    # React 挂载入口
├── App.tsx                     # 应用壳与功能域组合
├── api-client.ts               # 共享 Schema 驱动的 HTTP 边界
├── formatters.ts               # 纯展示格式化
├── hooks/
│   └── useProjectConsole.ts    # 服务端、URL、操作和 SSE 状态
├── components/                 # 项目、Spec、Task、Workflow、诊断组件
└── styles.css                  # 全局视觉系统与响应式布局
```

跨层 DTO 位于 `src/shared`，不在 `src/web` 内重复定义。

## 组织约定

- `App.tsx` 负责组合功能域和顶层状态分支，不直接编写文件系统或接口解析逻辑。
- `components/` 按可独立验证的项目导航、发现、Spec、Task、Workflow、诊断和文档阅读器拆分。
- `hooks/` 只承载跨多个组件共享的有状态数据流；表单输入、标签展开等局部状态留在组件。
- 当前不创建 `stores/`；若未来确有多个页面入口共享状态，再单独评估全局状态库。
- React 组件文件使用 PascalCase，普通 TypeScript 与样式文件使用小写名称。
- 页面只负责展示和用户交互；文件扫描、路径校验、Markdown 读取都属于服务端。

## 现有示例

- 应用壳：`src/web/App.tsx`
- 数据 Hook：`src/web/hooks/useProjectConsole.ts`
- 网络边界：`src/web/api-client.ts`
- 安全文档阅读器：`src/web/components/DocumentViewer.tsx`
- 挂载入口：`src/web/main.tsx`
- 共享合同：`src/shared/health.ts`
