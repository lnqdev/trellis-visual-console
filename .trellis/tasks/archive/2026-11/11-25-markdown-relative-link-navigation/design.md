# 设计：Markdown 相对链接跳转

## 目标与边界

只改前端：

- `src/web/markdown-links.ts`（新增）：纯函数，负责 href 分类、路径解析、标题 slug 与 id 映射。
- `src/web/components/DocumentViewer.tsx`：链接点击拦截、标题 id、锚点滚动。
- `src/web/components/TaskBrowser.tsx` / `SpecBrowser.tsx`：透传导航回调与待处理锚点。
- `src/web/hooks/useProjectConsole.ts`：统一路由 `navigateDocumentLink`，新增待处理锚点状态。
- `src/web/App.tsx`：接线。
- `src/web/styles.css`：标题 `scroll-margin-top`。

Rust 侧与共享 DTO 不变。`ProjectDocumentResponse.sourcePath` 已是项目内相对路径（`.trellis/...`），可直接作为解析基准。

## 链接分类与解析

```ts
type MarkdownLinkTarget =
  | { kind: "external" }
  | { kind: "anchor"; anchor: string }
  | { kind: "file"; sourcePath: string; anchor: string | null }
  | { kind: "invalid" };
```

规则（`resolveMarkdownLink(href, currentSourcePath)`）：

1. 空白 href → `invalid`。
2. 以 `#` 开头 → `anchor`（`decodeURIComponent` 容错）。
3. 有协议（`^[a-z][a-z0-9+.-]*:`，含 `http`、`https`、`mailto`、`file`）或以 `//` 开头 → `external`。
4. 拆出 `#hash` 与 `?query`，只对路径解码。
5. 路径以 `.trellis/` 开头 → 直接视为项目根相对路径。
6. 其余路径以当前文档 `sourcePath` 的目录为基准，用 POSIX 规则归一化 `.` / `..`；结果必须仍位于项目根内，否则 `invalid`。
7. 返回 `file`（路径 + 可选 anchor）。

`DocViewer` 只把 `file` 交给上层路由；`anchor` 在组件内处理。

## 应用内路由（useProjectConsole.navigateDocumentLink）

输入：解析后的项目内路径 `sourcePath`、锚点 `anchor`。

| 目标 | 行为 |
| --- | --- |
| `specTree` 中存在该文件 | `view = "spec"`，`selectedSpecPath = sourcePath` |
| `.trellis/tasks/<dir>/task.json` 对应快照中已存在的 Task，且其后为 `.md` / `.jsonl` | `view = "tasks"`，选中该 Task，`selectedTaskDocumentPath = <rest>` |
| 目标就是当前 Task 且详情已加载，但文档清单没有 `<rest>` | 不切换，notice 提示“目标文档不在当前任务中” |
| `.trellis/workflow.md` | `view = "workflow"` |
| 其他（含不存在路径、越界、非文档） | 不切换，notice 提示无法在应用内打开 |

跨任务时目标文档清单未知，先设置选择；`loadTaskDetail` 发现文档不存在会回落到首个文档，属于已知降级，用 notice 之外不影响主流程。

新增状态：`pendingDocumentAnchor: string | null`。路由成功后写入 anchor；`DocumentViewer` 在目标正文加载后滚动并调用 `consumeDocumentAnchor()` 清空。

## 组件合同

`DocumentViewer` 新增可选 Props：

```ts
interface DocumentViewerProps {
  document: AsyncState<ProjectDocumentResponse>;
  emptyMessage: string;
  onOpenSource: (sourcePath: string) => void;
  /** 上层解析并执行应用内跳转；未提供时相对链接只阻止默认导航。 */
  onNavigateDocument?: (sourcePath: string, anchor: string | null) => void;
  /** 跨文档跳转后待滚动的锚点。 */
  anchor?: string | null;
  /** 锚点已处理，通知上层清空。 */
  onAnchorConsumed?: () => void;
}
```

链接渲染：

- `external`：`target="_blank"` + `rel="noreferrer"`，保持现状。
- `anchor`：`onClick` 阻止默认并滚动（不改变 URL，避免 WebView 导航）。
- `file`：阻止默认；有 `onNavigateDocument` 则回调，否则仅阻止。
- `invalid`：阻止默认。

## 标题锚点

- `buildHeadingIdMap(content)`：逐行匹配 ATX 标题，按 GitHub 规则生成 slug（保留 Unicode 字母/数字/标记、`_`、`-`，空格转 `-`，其余标点移除，转小写），同名标题追加 `-1`、`-2`。
- 以 `行号 → id` 的 Map 保存；自定义 `h1`~`h6` 组件通过 `node.position.start.line` 取 id，避免与 React 渲染顺序耦合。
- 滚动：`requestAnimationFrame` 后在 `article` 容器内用 `querySelector` 定位（`CSS.escape`），`scrollIntoView({ block: "start" })`；找不到时静默。
- 跨文档滚动：effect 依赖 `[anchor, document.data]`，正文未就绪时直接返回，就绪后滚动并 `onAnchorConsumed()`。

## 边界与失败处理

- 越界路径、编码异常、非字符串 href 均由纯函数兜底为 `invalid`，不抛异常。
- 历史快照 `contentReadable=false` 时路由函数直接 notice 并返回，保持现状。
- 链接点击绝不改变 WebView location；不调用 `window.open`。
- 不新增依赖；标题组件只覆盖 `id`，其余属性和现有排版不变。

## 回滚

改动集中在 6 个前端文件；回滚为整体还原这 6 个文件即可，无数据迁移、无后端兼容问题。
