# 任务中心搜索区样式整理

## 目标

修复 macOS 上 `<select>` 与 `<input>` 高度不一致的问题，同时重组筛选区布局，解决排序和清除按钮换行导致的视觉断层。

## 背景

**问题一：macOS 上 `<select>` 高度与搜索框不一致（主要问题）**
- 全局 `select` reset（`styles.css:52`）只有 `font: inherit`，没有 `appearance: none`
- macOS WebKit 保留了 `<select>` 的原生 OS 样式，导致 `min-height: 38px` 和 `padding: 8px 10px` 被原生 chrome 部分覆盖，实际渲染高度低于 `<input>`
- Windows 使用 Chromium WebView2，`<select>` 遵循 CSS 规则，所以 Windows 上高度一致而 macOS 上不一致

**问题二：auto-fit 网格溢出换行（视觉凌乱）**
- `task-center-filters` 使用 `repeat(auto-fit, minmax(150px, 1fr))`
- 在典型窗口宽度下：第一行填满搜索 + 5 个下拉，排序和清除溢出到第二行，但只有 2 个元素，右侧大片空白

相关文件：
- `src/web/styles.css:52`：全局 select reset
- `src/web/styles.css:557`：`.task-center-filters` 及子选择器
- `src/web/components/TaskCenter.tsx:125`：筛选区 HTML 结构

## 需求

**R1 — 修复 `<select>` 跨平台高度**
在 `.task-center-filters select` 上增加：
- `appearance: none; -webkit-appearance: none`（剥离原生 OS 样式，让 CSS 完全控制尺寸）
- 将 `min-height` 改为显式 `height: 38px`，保证与 `<input>` 精确对齐
- 用 CSS background-image 补充自定义下拉箭头（SVG inline，颜色使用 `var(--subtle)`），并设置 `padding-right` 留出箭头空间

**R2 — 重组筛选区 HTML 结构**
将 `.task-center-filters` 内控件拆为两个子容器：

```
第一行（主操作行）：搜索输入 | 排序下拉 | 清除条件按钮
第二行（维度筛选行）：项目 | 状态 | 阶段 | 负责人 | 包
```

第一行 flex 布局：搜索框 `flex: 1`，排序和清除跟随右侧。
第二行 `grid-template-columns: repeat(5, 1fr)` 五等分。

**R3 — 更新 CSS**
- `.task-center-filters` 改为 `flex-direction: column`
- 新增 `.task-center-filters-primary`（flex row）
- 新增 `.task-center-filters-secondary`（5-col grid）
- 删除 `grid-column: span 2` 和 auto-fit 规则
- 响应式断点同步调整

## 验收标准

- [ ] AC1：macOS 上搜索框与 5 个下拉筛选高度视觉一致（均为 38px）
- [ ] AC2：自定义下拉箭头正常显示，Windows 和 macOS 外观一致
- [ ] AC3：搜索框、排序下拉、清除条件在同一行内对齐，搜索框自动拉伸
- [ ] AC4：5 个维度筛选在第二行均等分布
- [ ] AC5：整体视觉与 `task-center-segments`、`task-center-summary` 风格一致

## 超出范围

- 筛选逻辑和状态管理不变
- 控件功能和文案不变
- 全局 `<select>` 样式不做统一修改（只改 task-center-filters 作用域）
