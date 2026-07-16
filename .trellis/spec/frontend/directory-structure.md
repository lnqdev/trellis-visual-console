# 前端目录结构

## 当前布局

```text
src/web/
├── index.html
├── main.tsx       # React 挂载入口
├── App.tsx        # 首阶段页面壳
└── styles.css     # 当前全局样式
```

跨层 DTO 位于 `src/shared`，不在 `src/web` 内重复定义。

## 组织约定

- 当前页面规模很小，保持扁平结构，不提前创建 `components`、`hooks`、`stores` 等空目录。
- 当正式页面出现可独立验证的功能域后，再按项目导航、Spec、Task、Workflow 拆分目录。
- React 组件文件使用 PascalCase，普通 TypeScript 与样式文件使用小写名称。
- 页面只负责展示和用户交互；文件扫描、路径校验、Markdown 读取都属于服务端。

## 现有示例

- 页面壳：`src/web/App.tsx`
- 挂载入口：`src/web/main.tsx`
- 共享合同：`src/shared/health.ts`
