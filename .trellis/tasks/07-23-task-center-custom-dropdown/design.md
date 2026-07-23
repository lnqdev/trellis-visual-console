# 任务中心可复用自定义下拉组件设计

## 设计目标

建立一个独立、可复用且类型安全的 `Dropdown` 组件，统一替代任务中心五个筛选下拉和一个排序下拉。组件必须完全由应用控制弹出层样式与交互，在 macOS WebKit/Tauri、Windows WebView2 和普通浏览器中保持一致，同时不能因替换原生 `<select>` 而丢失键盘和可访问性能力。

本次只替换当前项目中已有的六个原生 `<select>`，不改动 `useTaskCenter.ts` 的筛选、排序、URL 同步或派生状态逻辑。

## 方案选择

### 已选方案：共享组件加 Portal

- 新建 `src/web/components/Dropdown.tsx`，集中实现展开状态、活动项、键盘导航、焦点恢复、外部点击关闭和弹层定位。
- 弹出列表通过 React Portal 渲染到 `document.body`，使用触发器的视口坐标定位，避开父级 `overflow`、滚动容器和堆叠上下文裁剪。
- `TaskCenter.tsx` 只负责提供选项、当前值和 `onChange`，不保留下拉交互实现。
- 样式仍集中在 `src/web/styles.css`，复用现有 CSS 变量。

### 未选方案

1. **业务页面内相对定位**：代码较少，但组件进入侧边栏、弹窗或滚动容器后可能被裁剪，不满足复用目标。
2. **继续包装原生 `<select>`**：无法控制 macOS 系统弹出列表的背景和选中态，不能解决根因。
3. **引入第三方组件库**：会扩大依赖和视觉适配范围，本任务所需行为可以由小型共享组件完成。

## 组件边界

### `Dropdown.tsx`

职责：

- 渲染标签、触发按钮和列表选项。
- 管理当前是否展开及键盘活动项索引。
- 通过 Portal 渲染和定位列表。
- 处理鼠标选择、外部点击、窗口滚动和尺寸变化。
- 提供完整的按钮、列表和选项 ARIA 语义。

不负责：

- 不保存业务选择值。
- 不清理失效筛选值，也不猜测业务默认值。
- 不执行筛选、排序或 URL 写入。
- 不读取 Tauri API 或其他外部状态。

### `TaskCenter.tsx`

- 为五个可空筛选下拉显式加入 `{ value: null, label: "全部" }` 选项。
- 为排序下拉提供 `updated_desc` 和 `updated_asc` 两个非空选项。
- 继续调用现有 `state.updateSelection()`，不改变状态所有权。
- 删除 `FilterSelect` 和全部原生 `<select>` 标记。

### `styles.css`

- 新增共享下拉根节点、触发按钮、Portal 列表、选项、活动态和选中态样式。
- 保持触发按钮高度为 `38px`，与搜索框和清除按钮对齐。
- 删除任务中心原生 `<select>` 的 `appearance`、`color-scheme` 和背景箭头规则。
- 列表使用 `var(--surface-strong)`、`var(--border)`、`var(--text)`；活动项和选中项使用 `var(--accent-soft)` 与应用绿色文字。

## 公共合同

```tsx
export interface DropdownOption<T extends string | null> {
  value: T;
  label: string;
}

export interface DropdownProps<T extends string | null> {
  label: string;
  value: T;
  options: ReadonlyArray<DropdownOption<T>>;
  onChange: (value: T) => void;
  className?: string;
}
```

该合同把“全部”建模为真正的 `null` 选项，而不是空字符串约定。排序下拉的泛型只包含 `TaskCenterSort`，因此回调类型不能产生 `null`；筛选下拉的泛型包含 `string | null`，保持现有状态合同。

调用方必须保证选项值唯一，并保证当前值通常存在于选项中。动态选项暂时与当前值不一致时，组件展示“暂无匹配项”，但不主动调用 `onChange`；值清理由现有状态所有者负责。

## 交互与状态流

1. 点击触发按钮或按 `Enter` / `Space` 时打开列表。
2. 打开时，活动项初始化为当前选中项；当前值无匹配项时定位到第一项。
3. `ArrowDown` / `ArrowUp` 循环移动活动项，且不立即修改业务值。
4. `Enter` 确认活动项，只调用一次 `onChange`，随后关闭列表并把焦点还给触发按钮。
5. `Escape`、`Tab` 或点击组件外部时关闭列表，不修改当前值。
6. 鼠标点击选项时更新值、关闭列表并恢复触发按钮焦点。
7. `options` 或 `value` 在展开期间变化时，重新校准活动项，避免索引指向不存在的选项。

组件本地状态只包含展示状态；业务值始终由调用方控制：

```text
TaskCenter selection -> Dropdown value -> 用户选择 -> onChange -> updateSelection
```

## Portal 定位

- 列表使用 `position: fixed`，根据触发按钮的 `getBoundingClientRect()` 计算 `left`、`top` 和宽度。
- 默认在触发器下方展开；下方空间不足且上方空间更多时向上展开。
- 横向位置限制在视口安全边距内，窄屏时列表宽度不得超过可视区域。
- 列表设置最大高度并内部滚动，不能撑开页面或产生根节点横向滚动。
- 展开期间监听窗口 `resize` 和捕获阶段 `scroll`，重新计算位置；关闭或卸载时释放监听。
- 外部点击判断同时覆盖触发器根节点和 Portal 列表节点，点击列表内部不能误关闭。

## 可访问性合同

- 触发器为 `button type="button"` 并声明 `role="combobox"`，包含可见当前值和下拉图标。
- 触发器声明 `aria-haspopup="listbox"`、`aria-expanded` 和 `aria-controls`。
- 列表声明 `role="listbox"`，每个选项声明 `role="option"`、`aria-selected` 和稳定 ID。
- 触发器通过 `aria-label` 或可关联标签提供稳定的可访问名称。
- 活动项变化时通过 `aria-activedescendant` 暴露当前键盘位置。
- 装饰性图标使用 `aria-hidden="true"`。

## 边界行为

| 场景 | 预期行为 |
| --- | --- |
| `options` 为空 | 触发器可展示“暂无选项”，不能打开空列表 |
| 当前值无匹配项 | 展示“暂无匹配项”，不私自改值 |
| 点击当前已选项 | 回调最多执行一次，随后关闭 |
| 展开后点击另一个下拉 | 前一个下拉因外部点击关闭，后一个正常打开 |
| 滚动或调整窗口尺寸 | 列表位置重新计算，不脱离触发器或被裁剪 |
| 组件卸载 | 移除事件监听，Portal 内容同步销毁 |
| 选项文本较长 | 单行省略，列表宽度和页面布局保持稳定 |

## 验证方案

### 静态门禁

```powershell
rg -n "<select|</select>" src/web
pnpm lint
pnpm typecheck
pnpm build:web
git diff --check
```

`rg` 预期无匹配，其他命令预期退出码为 `0`。

### 浏览器流程

使用 Playwright 验证：

1. 六个下拉均能鼠标打开并选择，筛选和排序结果保持原逻辑。
2. 选中项使用应用绿色，列表背景和边框完全来自 CSS 变量。
3. `Enter`、`Space`、上下方向键、`Escape` 和 `Tab` 行为符合合同。
4. 点击页面空白处关闭列表，点击列表内部不误关闭。
5. 桌面和窄屏视口下列表不被裁剪、不超出视口、不引起横向滚动。
6. 打开一个下拉后再打开另一个，下拉状态切换正常。

当前环境无法代表 macOS 原生 Tauri WebKit 时，浏览器验证之外仍需在 macOS 实机确认弹层未出现系统浅色背景或系统蓝色选中态。由于实现中不再存在原生 `<select>`，该实机检查用于最终视觉验收，不影响静态合同判断。

## 回滚边界

- 组件改造只涉及共享 `Dropdown`、`TaskCenter.tsx` 和 `styles.css`，不修改 Hook 或后端合同。
- 若 Portal 定位出现不可接受的问题，可仅回退共享组件及调用点，不涉及数据迁移或状态格式恢复。
- 不以恢复原生 `<select>` 作为长期修复；定位缺陷应在共享组件内解决。
