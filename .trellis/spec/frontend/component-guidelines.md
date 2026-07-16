# 前端组件规范

## 组件边界

- 使用 React 函数组件和显式 Props 接口；组件只消费已经校验的共享 DTO。
- `App` 组合项目工作区和顶层空/加载/错误状态；项目导航、发现、Spec、Task、Workflow、诊断和文档阅读各自独立。
- 表单输入、候选多选、Task 活动/归档标签等局部交互使用组件本地状态，不提升到主 Hook。
- 文件扫描、路径校验、Markdown 读取和外部打开均由服务端完成，组件不得导入 Node 模块。

## 结构与样式

- 组件文件使用 PascalCase，样式集中在 `styles.css`，类名按功能域命名。
- 长路径、表格和 JSONL 只允许组件内部 `overflow-x: auto`；页面根节点不得产生水平滚动。
- 交互使用语义化 `button`、`form`、`nav`、`article`、`aside`，纯装饰图标设置 `aria-hidden="true"`。
- 错误使用 `role="alert"`，异步提示使用 `aria-live`，标签页使用 `role="tablist" / role="tab" / aria-selected`。

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
