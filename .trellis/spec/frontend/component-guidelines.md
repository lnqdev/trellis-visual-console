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

## 常见错误

- 不要在新项目已选中时继续展示旧项目正文；切换请求先清空旧数据。
- 不要因一个文档错误替换整个应用，错误应局限在当前阅读区。
- 不要把仅使用一次的展示片段抽象成通用组件；只有明确复用或独立职责时拆分。
- 不要只用 `initialCollection` 初始化 Task 标签后永久忽略 `selectedTaskSourcePath` 的变化。
