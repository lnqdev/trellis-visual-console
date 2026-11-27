# 前端组件规范

## 组件边界

- 使用 React 函数组件和显式 Props 接口；组件只消费已经校验的共享 DTO。
- `App` 组合项目工作区和顶层空/加载/错误状态；项目导航、发现、Spec、Task、Workflow、诊断和文档阅读各自独立。
- 表单输入、候选多选、Task 活动/归档标签等局部交互使用组件本地状态，不提升到主 Hook。
- Task 活动/归档标签虽然是局部状态，但必须持续服从当前选中 Task：选中归档 Task 时同步为归档标签，选中活动 Task 时同步为活动标签；当前集合为空而另一集合有内容时自动切换，避免 URL 恢复或项目数据变化后标签与选择分离。
- 文件扫描、路径校验、Markdown 读取和外部打开均由服务端完成，组件不得导入 Node 模块。

## 结构与样式

- 组件文件使用 PascalCase，样式集中在 `styles.css`，类名按功能域命名。
- 长路径、表格和 JSONL 只允许组件内部 `overflow-x: auto`；页面根节点不得产生水平滚动。
- 交互使用语义化 `button`、`form`、`nav`、`article`、`aside`，纯装饰图标设置 `aria-hidden="true"`。
- 错误使用 `role="alert"`，异步提示使用 `aria-live`，标签页使用 `role="tablist" / role="tab" / aria-selected`。

## 可拖动面板分隔线

### 适用场景

- 左侧项目导航侧边栏与 Task 视图任务树栏的宽度由用户拖动决定；统一由 `useResizablePanel` 管理，禁止在组件内重复实现 pointer 逻辑。

### 实现合同

- 布局使用三列 grid：`var(--sidebar-width, 300px) 6px minmax(0, 1fr)` / `var(--task-list-width, 300px) 6px minmax(0, 1fr)`，中间 6px 列是拖拽热区，宽度通过内联 CSS 变量写入。
- 分隔线元素直接展开 Hook 返回的 `separatorProps`：`role="separator"`、`aria-orientation="vertical"`、`aria-valuemin/max/now`、`tabIndex=0`；`ArrowLeft` / `ArrowRight` 每次调整 16px，按住 Shift 为 48px。
- 宽度持久化到 localStorage（沿用 `trellis-console:` 前缀）；拖动中跳过落盘、松手后写入，避免高频同步存储拖慢拖动。
- 拖动期间 `body` 增加 `is-resizing-panel`（禁止选中文本 + `col-resize` 光标），容器增加 `--resizing` 关闭 `grid-template-columns` 过渡；拖动结束、`pointercancel` 与 `lostpointercapture` 都要复位状态。
- 指针捕获使用 `setPointerCapture`，保证快速拖出热区后仍能收到事件；因 `preventDefault()` 会阻止自动聚焦，`pointerdown` 中需显式 `focus()`，让拖动后可直接用方向键微调。

### 踩坑

- 折叠态隐藏分隔线必须使用直接子选择器 `.console-shell--sidebar-collapsed > .panel-resize-handle`。使用后代选择器会连带隐藏 Task 视图内部的分隔线，导致侧边栏折叠后任务树栏无法拖动。
- 折叠态列宽写成 `0 0 minmax(0, 1fr)`，并需要在 1180px 等媒体查询断点内以更高特异性重复声明，否则会被断点规则覆盖。
- 窄屏（≤ 820px）切换为 `display: block` 后必须 `display: none` 隐藏分隔线，避免占位或制造横向滚动。

## 平台原生弹出控件

### 适用范围与约束

- 当 `<select>`、日期/时间选择器等原生控件的弹出层由操作系统或 WebView 渲染，导致背景、边框、选中态、字号或交互无法稳定匹配应用主题时，禁止继续依赖 `appearance`、`color-scheme` 等 CSS 作为最终方案，必须使用应用可完全控制的自定义组件。
- 普通文本输入、按钮等能够稳定匹配主题并满足交互要求的原生语义控件继续保留；不要为了“全部自绘”无差别重造浏览器已经可靠提供的行为。
- 同类自定义控件必须放在独立共享组件中，业务页面只传入选项、当前值和变更回调；禁止在多个业务组件内复制展开、定位、键盘导航和点击外部关闭逻辑。

### 下拉组件合同

```tsx
interface DropdownOption<T extends string | null> {
  value: T;
  label: string;
}

interface DropdownProps<T extends string | null> {
  label: string;
  value: T;
  options: ReadonlyArray<DropdownOption<T>>;
  onChange: (value: T) => void;
  className?: string;
}
```

- 触发器使用 `button` 元素并声明 `role="combobox"`、`aria-haspopup="listbox"`、`aria-expanded`、`aria-activedescendant` 和关联列表 ID。
- 列表使用 `role="listbox"`，选项使用 `role="option"` 与 `aria-selected`；标签必须提供稳定的可访问名称。
- `Enter` / `Space` 打开，`ArrowUp` / `ArrowDown` 移动活动项，`Enter` 确认，`Escape` 关闭；`Tab` 保持正常焦点顺序并关闭列表。
- 点击组件外部关闭列表；关闭后不得意外修改已选值。
- 选项高亮、背景、边框和文字必须使用项目 CSS 变量，不能回退为系统蓝色或系统浅色弹出层。
- 可空筛选由调用方在选项中显式提供 `{ value: null, label: "全部" }`；不可空排序等场景使用不包含 `null` 的泛型，不得产生空值。

### 行为矩阵

| 场景 | 必须行为 |
| --- | --- |
| 当前值存在于选项中 | 触发器展示对应标签，列表项标记为选中 |
| 当前值为 `null` | 展示调用方定义的空值标签，如“全部” |
| 选项动态变化且当前值失效 | 由状态所有者清理值，展示组件不得私自猜测业务默认值 |
| 按 `Escape` 或点击外部 | 关闭列表，保留原值 |
| 键盘确认活动项 | 调用一次 `onChange` 并关闭列表 |
| 列表内容超过可用空间 | 列表内部滚动，不撑开页面或制造根节点横向滚动 |

### 验证要求

- 使用浏览器或真实 Tauri 应用验证鼠标选择、外部点击关闭、键盘导航、焦点顺序和动态选项更新。
- 至少在 macOS WebKit/Tauri 验证弹出层未出现系统浅色背景或系统蓝色选中态。
- 运行 `pnpm lint`、`pnpm typecheck`、`pnpm build:web` 和 `git diff --check`。

### 错误与正确示例

```tsx
// 错误：系统弹出层不可控，CSS 只能修改闭合状态的外观。
<select style={{ appearance: "none", colorScheme: "dark" }}>
  <option value="active">活动</option>
</select>

// 正确：复用共享组件，由应用统一控制展示和交互。
<Dropdown
  label="状态"
  value={status}
  options={statusOptions}
  onChange={setStatus}
/>
```

## 文档渲染

```tsx
<ReactMarkdown remarkPlugins={[remarkGfm]}>{content}</ReactMarkdown>
```

- 不启用 `rehype-raw`，不使用 `dangerouslySetInnerHTML`。
- JSONL 使用可聚焦的 `<pre><code>`，保留原始文本并允许内部滚动。
- HTTP(S) 外部链接使用 `target="_blank"` 和 `rel="noreferrer"`。
- 相对链接必须先经 `resolveMarkdownLink(href, data.sourcePath)` 分类，禁止把相对路径直接交给 WebView 导航（会白屏并丢失当前选择）：
  - `external`：`target="_blank"` + `rel="noreferrer"`。
  - `anchor`：`preventDefault()` 后在文档容器内滚动。
  - `file`：`preventDefault()` 并调用 `onNavigateDocument(sourcePath, anchor)`。
  - `invalid`：只 `preventDefault()`，不得改变 `location`。
- Markdown 标题通过 `buildHeadingIdMap(content)` 生成 GitHub 风格 id，并以“起始行号 → id”建立映射，避免依赖 React 渲染顺序；同名标题追加 `-1`、`-2`。

```tsx
// 错误：相对链接直接输出，点击后 WebView 导航到文件地址。
<a {...props} href={href}>{children}</a>

// 正确：统一分类，相对文档交给应用内路由，锚点交给文档容器滚动。
const target = resolveMarkdownLink(href, data.sourcePath);
if (target.kind === "external") {
  return <a {...props} href={href} target="_blank" rel="noreferrer">{children}</a>;
}
return (
  <a {...props} href={href} onClick={(event) => {
    event.preventDefault();
    if (target.kind === "anchor") scrollToAnchor(target.anchor);
    if (target.kind === "file") onNavigateDocument?.(target.sourcePath, target.anchor);
  }}>{children}</a>
);
```

### Markdown 文内查找（Ctrl/Cmd + F）

- 实现分两层：`src/web/markdown-search.ts` 提供 rehype 插件 `createSearchHighlightPlugin({ query, activeIndex })`；`DocumentViewer` 负责查找条状态与快捷键。
- 高亮必须在渲染阶段产出 `<mark>`；禁止直接改写 React 管理的 DOM 文本节点，也不要依赖 CSS Custom Highlight（macOS 13 的 WKWebView 不支持）。
- 插件契约：
  - 匹配：`query.trim().toLocaleLowerCase("zh-CN")` 后做包含匹配，大小写不敏感、非重叠推进；空关键词原样返回语法树。
  - 分组：按块级标签（`p`、`li`、`td`、`th`、`h1`-`h6`、`blockquote`、`pre` 等）切分文本组，行内元素文本并入最近的块级组；因此跨 `strong`/`code`/`a` 的关键词可以命中，但不会跨段落、表格单元格匹配。
  - 输出：`<mark class="markdown-search-hit" data-search-match-index="N">`，当前命中追加 `markdown-search-hit--active`；同一命中跨多个文本节点时共享同一序号。
- `DocumentViewer` 约束：
  - 仅当 `format === "markdown"` 时注册 window `keydown` 拦截 `Ctrl/Cmd + F`（排除 Alt 与 `[role="dialog"]` 内部），并阻止 WebView 原生查找；JSONL 不提供入口与快捷键。
  - 命中总数取 DOM 中唯一的 `data-search-match-index` 数量，当前命中用 `scrollIntoView({ block: "center" })` 定位。
  - 中文输入法组词确认的 Enter（`isComposing` 或 `keyCode === 229`）不得触发跳转。
  - 查找状态属于组件本地状态，不写入 URL；切换文档必须重置关键词、当前序号与计数。查找条相对 `.document-body` 绝对定位，不随正文滚动，也不压住工具栏。

### 文档大纲（h1–h3）

- 大纲由 `buildDocumentOutline(content)` 生成，与 `buildHeadingIdMap` 共用 `collectHeadings` 这一份扫描结果：同样跳过 fenced code block 与 slug 为空的标题，同名标题沿用 `-1`、`-2` 规则，因此大纲条目的跳转目标必然等于正文标题 id。大纲只展开到 h3，h3 没有 h2 时挂到最近的 h1。
- `DocumentViewer` 仅在 `format === "markdown"` 且大纲非空时渲染大纲；JSONL、空文档、加载与错误状态都不出现大纲入口。
- 布局：宽屏 `.document-body--with-outline` 为 `minmax(0, 1fr) 28px` 两列，右侧只占一条导轨。导轨默认收起，每个条目只显示短横线，当前章节的横线更粗更长并使用强调色；悬停或键盘聚焦时面板向左展开到 248px 显示全文，覆盖正文但不改变布局。展开态有标题分隔线、当前条目底色与悬停底色，收起态不加底色以免在窄导轨里出现零碎色块；标题行在收起态保留占位（`visibility: hidden`），避免展开瞬间内容整体跳动。鼠标点击条目后主动 `blur()` 让导轨复原，键盘激活（`event.detail === 0`）保留焦点。≤820px（与单列布局同一断点）改为绝对定位抽屉，由工具栏“大纲”按钮切换，点击条目后自动收起。
- 滚动高亮用固定阈值（顶部 28px 缓冲）取最后一个越过基准线的标题，不要改用 IntersectionObserver 的多重交叉状态，否则相邻标题边界处会抖动。≤820px 时正文改为整页滚动，必须同时监听正文容器与 `window` 的 `scroll`。滚到页面底部时按最后一个可见标题高亮，避免末章永远高亮不到；页面本身不可滚动时不算到底。
- 点击条目复用 `scrollToAnchor`，与文内锚点行为一致（标题 `scroll-margin-top: 16px`），不被工具栏遮挡。
- 有大纲时查找条要让出导轨宽度（`.document-body--with-outline .document-find` 的 `right: 44px`），否则会压住导轨。
- 验证至少覆盖 375 / 768 / 1024 / 1440 视口、同名标题、切换文档与 JSONL 文档。

## 常见错误

- 不要在新项目已选中时继续展示旧项目正文；切换请求先清空旧数据。
- 不要因一个文档错误替换整个应用，错误应局限在当前阅读区。
- 不要把仅使用一次的展示片段抽象成通用组件；只有明确复用或独立职责时拆分。
- 不要只用 `initialCollection` 初始化 Task 标签后永久忽略 `selectedTaskSourcePath` 的变化。
