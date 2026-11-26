# 实施计划：Markdown 相对链接跳转

## 前置

- 已阅读 `.trellis/spec/frontend/component-guidelines.md`（文档渲染）、`hook-guidelines.md`、`state-management.md`。
- 任务状态需先由 `task.py start` 置为 `in_progress`。

## 步骤

1. **新增链接解析工具** `src/web/markdown-links.ts`
   - `resolveMarkdownLink(href, currentSourcePath)`：external / anchor / file / invalid。
   - `buildHeadingIdMap(content)`：行号 → GitHub 风格标题 id。
   - 校验：`pnpm typecheck`。

2. **扩展 DocumentViewer**
   - 链接组件按分类拦截；外部链接保持新窗口。
   - h1~h6 注入 id。
   - 同文档锚点滚动、跨文档 anchor effect（`requestAnimationFrame` + `scrollIntoView`）。
   - 校验：`pnpm typecheck`。

3. **Hook 路由** `useProjectConsole.navigateDocumentLink`
   - 新增 `pendingDocumentAnchor` 状态与 `consumeDocumentAnchor`。
   - 按设计表路由到 spec / tasks / workflow，失败给 notice。
   - 导出到返回对象。
   - 校验：`pnpm typecheck`。

4. **接线**
   - `App.tsx` → `SpecBrowser` / `TaskBrowser` → `DocumentViewer` 传递导航回调、anchor、consume。
   - 校验：`pnpm typecheck`。

5. **样式**
   - `.markdown-body :is(h1,h2,h3,h4,h5,h6) { scroll-margin-top: 16px; }`。
   - 校验：`pnpm build:web`。

6. **质量验证**
   - `pnpm lint`、`pnpm typecheck`、`pnpm build:web`、`git diff --check`。
   - 手工验证（用本仓库任务文档临时加链接或真实项目）：同任务互跳、Spec 跳转、workflow 跳转、跨任务、锚点、无法解析链接提示。
   - 复核无 `target=_blank` 缺失、无 WebView 页面导航、无旧文档残留。

## 验证命令

```bash
pnpm lint
pnpm typecheck
pnpm build:web
git diff --check
```

## 评审门禁

- 完成后由 `trellis-check` 或人工复核：分类边界、路径越界、异步竞态（切换项目/任务时 anchor 清理）、可访问性。
- 若有偏差，回到本计划对应步骤修正，不直接提交。

## 回滚点

- 每个步骤单独可回滚；整体回滚 = 还原上述 6 个前端文件。
