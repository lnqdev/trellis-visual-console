# 前端质量规范

## 必需规则

- 使用 React 函数组件和 TypeScript 严格模式。
- 方法与关键异步边界添加详略得当的中文注释。
- 异步 Effect 清理取消本地提交并释放事件订阅。
- 状态提示使用 `aria-live`，装饰图标使用 `aria-hidden`。
- Markdown 不启用 `rehype-raw`；HTTP(S) 外部链接使用 `_blank` 和 `noreferrer`。
- 组件不直接访问 Tauri API、Node 文件系统或任意绝对路径。

## 验证门禁

```bash
pnpm lint
pnpm typecheck
pnpm build:web
git diff --check
```

默认不生成测试类或仓库测试文件。需要端到端验证时使用仓库外 Playwright IPC mock 和真实 Tauri 应用。
