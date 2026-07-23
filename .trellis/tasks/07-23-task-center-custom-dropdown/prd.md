# 下拉筛选自定义组件替换原生 select

## 目标

将任务中心筛选区的五个原生 `<select>` 替换为自定义 `Dropdown` 组件，彻底解决 macOS WebKit 渲染原生下拉列表时颜色与整体深色主题不符的问题。

## 背景

当前问题：
- `src/web/components/TaskCenter.tsx` 中 `FilterSelect` 组件使用原生 `<select>`
- macOS 系统为 Light 模式时，原生 `<select>` 弹出的 options 列表由系统渲染，选中高亮为系统蓝、背景与边框为系统样式，与应用深色主题不匹配
- CSS `appearance: none` + `color-scheme: dark` 已应用但无法完全控制弹出列表外观
- 原生 `<select>` 弹出列表的样式在 macOS WebKit/Tauri 中无法通过 CSS 控制，只能换成自定义组件

相关文件：
- `src/web/components/TaskCenter.tsx:338`：`FilterSelect` 组件定义
- `src/web/styles.css:683`：`.task-center-filters select` 样式

## 需求

**R1 — 新建 `Dropdown` 组件**
在 `TaskCenter.tsx` 内（或抽成独立文件）实现 `Dropdown` 组件：
- Props：`label`、`value: string | null`、`options: Array<{value: string; label: string}>`、`onChange: (value: string | null) => void`
- 外观：与现有 `FilterSelect` 一致（label + 控件，同行，38px 高度）
- 点击后在控件正下方展示绝对定位的选项列表（portal 或相对定位均可）
- 选项列表背景、边框、文字颜色完全使用 CSS 变量，与应用深色主题一致
- 选中项高亮使用 `var(--accent-soft)` + `var(--accent)` 文字色（应用绿，不用系统蓝）
- 支持键盘：`Enter`/`Space` 打开，`↑`/`↓` 切换，`Enter` 确认，`Escape` 关闭

**R2 — 替换 `FilterSelect`**
将 `TaskCenter.tsx` 中 `FilterSelect` 组件及其五处调用全部改为 `Dropdown`，删除旧的 `FilterSelect` 组件代码和原生 `<select>` 相关 CSS（`appearance: none`、`color-scheme: dark`、背景箭头 SVG）。

**R3 — 点击外部关闭**
点击下拉列表外部区域时关闭列表（`mousedown` 事件 + ref 判断）。

## 验收标准

- [ ] AC1：macOS 上点击筛选下拉，弹出列表背景为 `var(--surface-strong)`，与应用深色主题一致
- [ ] AC2：选中项高亮为绿色（`var(--accent-soft)` 背景），不再出现系统蓝
- [ ] AC3：键盘 `↑`/`↓`/`Enter`/`Escape` 可正常操作
- [ ] AC4：点击列表外部自动关闭
- [ ] AC5：筛选功能与现有逻辑完全一致，状态管理不变

## 超出范围

- 排序下拉（`.task-center-sort`）可暂不替换（不是筛选维度，使用频率低）
- `useTaskCenter.ts` 中的状态逻辑不变
- 不引入第三方 UI 库
