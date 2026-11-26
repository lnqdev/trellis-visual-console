# 修复任务文档 Markdown 相对链接跳转

## Goal

修复 Task 详情与 Spec 阅读区中 Markdown 链接的点击行为：相对链接不再让 Tauri WebView 直接跳转到文件地址导致白屏或丢失当前选择，而是在应用内完成文档切换与锚点定位。

## Background

`DocumentViewer` 目前只区分 `http(s)` 外链，其余链接一律渲染为普通 `<a href>`。任务文档里的 `[design.md](./design.md)`、`[调研](../research/x.md)`、`[规范](../../spec/backend/index.md)` 等相对链接被 WebView 当作页面导航，点击后离开应用页面；`#锚点` 因标题没有 id 也无法定位。

## Requirements

- 相对链接解析：以当前文档的项目内路径为基准解析 `.`、`..`，同时兼容文档中以 `.trellis/` 开头的项目根相对写法；忽略查询串，保留 `#锚点`。
- 应用内路由：
  - 同任务文档（`.trellis/tasks/<task>/...` 内的 md/jsonl）→ 切换到对应 Task 与文档标签。
  - Spec 文档（存在于当前快照 `specTree` 的 `.trellis/spec/...`）→ 切换到 Spec 视图并选中目标文件。
  - `.trellis/workflow.md` → 切换到 Workflow 视图。
  - 其他任务目录下的文档 → 选中对应 Task 与文档标签（目标文档由任务详情加载后校验）。
- 锚点滚动：为 Markdown 标题生成 GitHub 风格 id；同文档 `#锚点` 直接滚动，跨文档 `file.md#锚点` 在目标正文加载完成后滚动到对应标题。
- 无法在应用内解析的相对链接：阻止 WebView 导航，保持当前页面，并通过顶部 notice 提示目标路径（不静默失败）。
- 外链（`http(s)`、`mailto:` 等）保持现有新窗口行为不变。
- 不新增依赖，不引入路由库或全局状态库；保持只读与现有状态归属（导航状态归 `useProjectConsole`）。

## Acceptance Criteria

- [ ] 在 Task 文档中点击 `design.md`、`implement.md`、`research/xxx.md` 等相对链接，当前 Task 的文档标签同步切换且正文正确加载。
- [ ] 点击 `../../spec/backend/index.md` 等指向 Spec 的相对链接，应用切到 Spec 视图并选中目标文件。
- [ ] 点击 `../../workflow.md` 切到 Workflow 视图。
- [ ] 点击指向其他 Task 目录的文档链接，左侧 Task 树与文档标签同步到目标。
- [ ] 同文档 `#标题` 与跨文档 `x.md#标题` 均能滚动到对应标题；中文标题可用。
- [ ] 无法解析的链接点击后页面不跳转、不白屏，顶部出现可读提示。
- [ ] `pnpm lint`、`pnpm typecheck`、`pnpm build:web` 通过。

## Constraints

- 仅改动前端展示与状态层，不新增 Tauri Command，不改 Rust 读取契约。
- 链接解析必须防御越界（`..` 逃出项目根）、编码异常（`decodeURIComponent` 失败）和空 href。
- 保持现有可访问性语义（`<a>` 仍可聚焦、可复制链接）。

## Out of Scope

- 图片等非 Markdown/JSONL 资源的内嵌预览。
- 外部浏览器打开策略、Tauri opener 插件接入。
- 任务中心（`TaskCenter`）视图内的文档渲染。
