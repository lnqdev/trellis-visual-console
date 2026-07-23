# 任务中心自定义下拉组件替换原生 select

## 目标

将任务中心筛选区的五个筛选下拉和一个排序下拉全部替换为自定义 `Dropdown` 组件，彻底解决 macOS WebKit 渲染原生下拉列表时颜色与整体深色主题不符、交互体验不可控的问题。

## 背景

当前确认事实：

- `src/web/components/TaskCenter.tsx` 中 `FilterSelect` 组件及排序控件共使用六个原生 `<select>`
- macOS 系统为 Light 模式时，原生 `<select>` 弹出的 options 列表由系统渲染，选中高亮为系统蓝、背景与边框为系统样式，与应用深色主题不匹配
- CSS `appearance: none` + `color-scheme: dark` 已应用但无法完全控制弹出列表外观
- 原生 `<select>` 弹出列表的样式在 macOS WebKit/Tauri 中无法通过 CSS 控制，只能换成自定义组件
- 当前 `src/web` 中没有其他原生 `<select>`；完成本任务后该目录不应再保留原生下拉

相关文件：
- `src/web/components/TaskCenter.tsx:338`：`FilterSelect` 组件定义
- `src/web/styles.css:683`：`.task-center-filters select` 样式

## 需求

**R1 — 新建 `Dropdown` 组件**
新增独立、类型安全且可复用的 `Dropdown` 组件，任务中心只负责传入选项、当前值和变更回调，不在业务页面内复制下拉交互逻辑：
- 外观：与现有 `FilterSelect` 一致（label + 控件，同行，38px 高度）
- 组件必须可用于普通页面、滚动容器、侧边栏和弹窗等不同布局，弹出列表不能被父级 `overflow` 裁剪
- 选项列表背景、边框、文字颜色完全使用 CSS 变量，与应用深色主题一致
- 选中项高亮使用 `var(--accent-soft)` + `var(--accent)` 文字色（应用绿，不用系统蓝）

**R2 — 替换任务中心全部原生下拉**
将 `TaskCenter.tsx` 中 `FilterSelect` 组件及其五处调用、排序区域的一处原生 `<select>` 全部改为 `Dropdown`，删除旧的 `FilterSelect` 组件代码和任务中心原生 `<select>` 相关 CSS（`appearance: none`、`color-scheme: dark`、背景箭头 SVG）。筛选下拉保留“全部”空值语义，排序下拉保持现有 `updated_desc` / `updated_asc` 状态类型和默认值不变。

**R3 — 完整交互与可访问性**

- 支持 `Enter` / `Space` 打开、上下方向键移动、`Enter` 确认、`Escape` 关闭和 `Tab` 正常切换焦点
- 点击下拉列表外部区域时关闭列表，且不得意外修改已选值
- 提供触发器、列表和选项的完整 ARIA 语义，不能因替换原生控件而丢失键盘或读屏能力
- 选项动态变化、列表超长、窄屏或窗口滚动时，组件仍保持稳定布局和可预测行为

## 验收标准

- [ ] AC1：macOS 上点击筛选下拉，弹出列表背景为 `var(--surface-strong)`，与应用深色主题一致
- [x] AC2：选中项高亮为绿色（`var(--accent-soft)` 背景），不再出现系统蓝
- [x] AC3：键盘 `↑`/`↓`/`Enter`/`Escape` 可正常操作
- [x] AC4：点击列表外部自动关闭
- [x] AC5：筛选功能与现有逻辑完全一致，状态管理不变
- [x] AC6：排序下拉使用同一自定义组件，排序功能及现有状态管理保持不变
- [x] AC7：`src/web` 中不再存在原生 `<select>`，业务组件不重复实现下拉展开、键盘导航和外部点击关闭逻辑
- [x] AC8：下拉组件放入滚动或裁剪容器时，弹出列表仍完整可见，并能在窗口尺寸或滚动位置变化后保持正确位置

## 验收证据

- `pnpm lint`、`pnpm typecheck`、`pnpm build:web`、`git diff --check` 均通过；构建仅保留任务前已存在的 chunk 大小警告。
- `rg -n "<select|</select>|<option" src/web` 无匹配，`useTaskCenter.ts` 无差异。
- Playwright IPC mock 验证六个下拉的鼠标筛选、升降序排序、外部关闭、下拉互斥、键盘导航、焦点恢复和 ARIA 状态。
- Playwright 在 1440×900、1024×900、768×900、375×812 验证 Portal 位于 `body`、列表不越界、页面无正向横向溢出；375px 下筛选保持两列布局。
- 选中项计算样式为 `rgba(34, 197, 94, 0.12)` 背景与 `rgb(34, 197, 94)` 文字；贴近视口底部时列表向上展开，滚动后仍保持贴合。
- 当前执行环境为 Windows，尚未进行 macOS Tauri WebKit 实机视觉检查，因此 AC1 保持未勾选。

## 超出范围

- `useTaskCenter.ts` 中的状态逻辑不变
- 不引入第三方 UI 库
- 普通文本输入等能够稳定匹配主题且交互符合需求的原生控件不在本任务中替换
