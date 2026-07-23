# 任务中心可复用自定义下拉组件实施计划

> **面向代理执行者：** REQUIRED SUB-SKILL：使用 `superpowers:executing-plans` 按任务逐项实施并更新复选框。当前项目采用 Codex inline 模式，不创建 worktree、不派发子代理；按项目约定不新增测试类或仓库内测试文件。

**目标：** 新增可复用、类型安全且支持 Portal 的 `Dropdown` 组件，替换任务中心全部六个原生 `<select>`，保持筛选和排序状态逻辑不变。

**架构：** `Dropdown.tsx` 独立拥有展开、活动项、键盘、焦点、外部点击和 Portal 定位；`TaskCenter.tsx` 只提供受控值、选项与回调；`styles.css` 统一组件主题和响应式样式。业务 Hook、共享 IPC 合同和后端均不修改。

**技术栈：** React 19、TypeScript 6 严格模式、React Portal、Lucide React、CSS 变量、Vite、Playwright。

---

## 文件结构

- Create: `src/web/components/Dropdown.tsx`：共享下拉合同、交互状态、ARIA 和 Portal 定位。
- Modify: `src/web/components/TaskCenter.tsx`：接入六个共享下拉，删除 `FilterSelect` 与原生 `<select>`。
- Modify: `src/web/styles.css`：新增共享下拉样式，删除任务中心原生下拉规则。
- Verify only: `src/web/hooks/useTaskCenter.ts`：确认状态类型与逻辑无变化。
- Update: `.trellis/tasks/07-23-task-center-custom-dropdown/prd.md`：完成后记录验收证据。
- Update: `.trellis/spec/frontend/component-guidelines.md`：已记录项目级自定义弹出控件规范，完成时复核实现一致性。

既有未提交的 `src-tauri/Cargo.toml`、`src-tauri/gen/schemas/desktop-schema.json` 和 `src-tauri/gen/schemas/windows-schema.json` 不属于本任务，不修改、不回退、不暂存。

## 任务 1：加载规范并建立基线

**文件：**

- Read: `.trellis/spec/frontend/index.md`
- Read: `.trellis/spec/frontend/component-guidelines.md`
- Read: `.trellis/spec/frontend/quality-guidelines.md`
- Read: `src/web/components/TaskCenter.tsx`
- Read: `src/web/styles.css`

- [x] **步骤 1：使用 `trellis-before-dev` 加载前端开发约束**

执行技能后确认至少包含：React 函数组件、显式 Props、中文方法与关键流程注释、集中样式、ARIA、响应式和质量命令。

- [x] **步骤 2：记录工作区基线并隔离既有改动**

运行：

```powershell
git status --short
git diff -- src/web/components/TaskCenter.tsx src/web/styles.css
```

预期：业务目标文件在实施前无未提交差异；Tauri 三个既有改动继续保留且不进入本任务。

- [x] **步骤 3：运行实施前质量基线**

运行：

```powershell
pnpm lint
pnpm typecheck
pnpm build:web
```

预期：全部退出码为 `0`。若出现既有失败，先记录证据并判断是否阻断本任务，不扩大范围修复无关问题。

## 任务 2：实现共享 `Dropdown`

**文件：**

- Create: `src/web/components/Dropdown.tsx`

- [x] **步骤 1：定义类型安全的受控组件合同**

使用以下公开合同，使可空筛选和非空排序由泛型分别约束：

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

- [x] **步骤 2：实现本地展示状态和完整键盘合同**

组件至少包含以下状态与流程，方法定义和复杂流程添加中文注释：

```tsx
const [isOpen, setIsOpen] = useState(false);
const [activeIndex, setActiveIndex] = useState(-1);
const [listStyle, setListStyle] = useState<CSSProperties | null>(null);

/** 打开列表，并将键盘活动项定位到当前选中值。 */
const openDropdown = useCallback(() => {
  if (options.length === 0) {
    return;
  }
  const selectedIndex = options.findIndex((option) => Object.is(option.value, value));
  setActiveIndex(selectedIndex >= 0 ? selectedIndex : 0);
  setListStyle(null);
  setIsOpen(true);
}, [options, value]);

/** 关闭列表，并按交互来源决定是否恢复触发器焦点。 */
const closeDropdown = useCallback((restoreFocus: boolean) => {
  setIsOpen(false);
  setListStyle(null);
  if (restoreFocus) {
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  }
}, []);
```

触发器 `onKeyDown` 必须覆盖：

```tsx
switch (event.key) {
  case "Enter":
  case " ":
    event.preventDefault();
    if (isOpen) {
      selectActiveOption();
    } else {
      openDropdown();
    }
    break;
  case "ArrowDown":
    event.preventDefault();
    if (isOpen) {
      moveActiveIndex(1);
    } else {
      openDropdown();
    }
    break;
  case "ArrowUp":
    event.preventDefault();
    if (isOpen) {
      moveActiveIndex(-1);
    } else {
      openDropdown();
    }
    break;
  case "Home":
    if (isOpen) {
      event.preventDefault();
      setActiveIndex(0);
    }
    break;
  case "End":
    if (isOpen) {
      event.preventDefault();
      setActiveIndex(options.length - 1);
    }
    break;
  case "Escape":
    if (isOpen) {
      event.preventDefault();
      closeDropdown(true);
    }
    break;
  case "Tab":
    if (isOpen) {
      closeDropdown(false);
    }
    break;
}
```

`moveActiveIndex()` 使用取模循环，`selectActiveOption()` 必须先读取 `options[activeIndex]` 并处理 `undefined`，以满足 `noUncheckedIndexedAccess`。

- [x] **步骤 3：实现 Portal 定位和生命周期清理**

使用 `createPortal()` 把列表渲染到 `document.body`；定位函数遵循以下实际计算：

```tsx
/** 根据触发器和视口空间计算 Portal 列表位置。 */
const updatePosition = useCallback(() => {
  const trigger = triggerRef.current;
  const list = listRef.current;
  if (trigger === null || list === null) {
    return;
  }

  const margin = 8;
  const gap = 4;
  const preferredMaxHeight = 280;
  const rect = trigger.getBoundingClientRect();
  const availableBelow = Math.max(0, window.innerHeight - rect.bottom - gap - margin);
  const availableAbove = Math.max(0, rect.top - gap - margin);
  const contentHeight = Math.min(list.scrollHeight, preferredMaxHeight);
  const openAbove = availableBelow < Math.min(contentHeight, 160)
    && availableAbove > availableBelow;
  const availableHeight = openAbove ? availableAbove : availableBelow;
  const maxHeight = Math.max(0, Math.min(preferredMaxHeight, availableHeight));
  const renderedHeight = Math.min(contentHeight, maxHeight);
  const width = Math.min(
    Math.max(rect.width, 160),
    Math.max(0, window.innerWidth - margin * 2),
  );
  const left = Math.max(
    margin,
    Math.min(rect.left, window.innerWidth - margin - width),
  );
  const top = openAbove
    ? Math.max(margin, rect.top - gap - renderedHeight)
    : rect.bottom + gap;

  setListStyle({ left, top, width, maxHeight });
}, []);
```

展开时在 `useLayoutEffect` 中首次定位，并监听 `resize` 与捕获阶段 `scroll`；清理函数必须移除两个监听。`mousedown` 外部关闭逻辑同时检查 `rootRef` 和 Portal 的 `listRef`，不能把列表内点击误判为外部点击。

- [x] **步骤 4：补齐语义、焦点和动态选项同步**

渲染结构采用：

```tsx
<div ref={rootRef} className={rootClassName}>
  <span id={labelId} className="dropdown-label">{label}</span>
  <button
    ref={triggerRef}
    type="button"
    role="combobox"
    className="dropdown-trigger"
    aria-labelledby={`${labelId} ${valueId}`}
    aria-haspopup="listbox"
    aria-expanded={isOpen}
    aria-controls={listId}
    aria-autocomplete="none"
    aria-readonly="true"
    aria-activedescendant={isOpen && activeIndex >= 0
      ? `${listId}-option-${activeIndex}`
      : undefined}
    disabled={options.length === 0}
  >
    <span id={valueId} className="dropdown-value">{displayLabel}</span>
    <ChevronDown className={isOpen ? "dropdown-chevron dropdown-chevron--open" : "dropdown-chevron"} />
  </button>
</div>
```

Portal 列表使用 `role="listbox"`，选项使用 `role="option"`、`aria-selected`、稳定 ID 和 `tabIndex={-1}`。选项点击只调用一次 `onChange(option.value)`，随后关闭并恢复焦点。展开期间 `value` 或 `options` 变化时重新寻找活动项；活动项变化时调用 `scrollIntoView({ block: "nearest" })`。

- [x] **步骤 5：运行组件级静态检查**

运行：

```powershell
pnpm typecheck
pnpm lint
```

预期：退出码均为 `0`，无未使用变量、可选属性或数组越界类型错误。

## 任务 3：接入任务中心六个下拉

**文件：**

- Modify: `src/web/components/TaskCenter.tsx`
- Verify only: `src/web/hooks/useTaskCenter.ts`

- [x] **步骤 1：导入共享组件并定义排序与空值选项**

```tsx
import { Dropdown, type DropdownOption } from "./Dropdown";

const TASK_CENTER_SORT_OPTIONS: ReadonlyArray<
  DropdownOption<TaskCenterSelection["sort"]>
> = [
  { value: "updated_desc", label: "最近更新优先" },
  { value: "updated_asc", label: "最早更新优先" },
];

const ALL_DROPDOWN_OPTION: DropdownOption<null> = {
  value: null,
  label: "全部",
};
```

- [x] **步骤 2：替换排序原生下拉**

```tsx
<Dropdown
  className="task-center-sort"
  label="排序"
  value={state.selection.sort}
  options={TASK_CENTER_SORT_OPTIONS}
  onChange={(sort) => state.updateSelection({ sort })}
/>
```

删除原有 `.task-center-sort` 标签内的 `<select>`、两个 `<option>` 和字符串回退转换；类型由 `TaskCenterSelection["sort"]` 保证只能是两个合法值。

- [x] **步骤 3：替换五个可空筛选下拉**

先新增统一辅助函数：

```tsx
/** 为可空筛选选项补充统一的“全部”入口。 */
function withAllOption<T extends string>(
  options: ReadonlyArray<DropdownOption<T>>,
): Array<DropdownOption<T | null>> {
  return [ALL_DROPDOWN_OPTION, ...options];
}
```

五个调用均改为共享组件；项目筛选示例：

```tsx
<Dropdown
  label="项目"
  value={state.selection.projectId}
  options={withAllOption(state.filterOptions.projects.map((project) => ({
    value: project.project.id,
    label: project.project.label,
  })))}
  onChange={(projectId) => state.updateSelection({ projectId })}
/>
```

状态、阶段、负责人、包分别继续使用现有 `state.filterOptions` 和 `toTextOptions()`，仅外层调用改为 `Dropdown` 并通过 `withAllOption()` 加入空值。

- [x] **步骤 4：删除旧组件并校正注释**

删除：

```tsx
interface FilterSelectProps { /* 整段删除 */ }
function FilterSelect(...) { /* 整段删除 */ }
```

将 `toTextOptions()` 注释从“原生菜单选项”改为“下拉选项”，返回类型改为 `Array<DropdownOption<string>>`。不得修改 `isDefaultSelection()`、`state.updateSelection()` 或 `useTaskCenter.ts`。

- [x] **步骤 5：确认原生下拉清零且状态逻辑未变**

运行：

```powershell
rg -n "<select|</select>|<option" src/web
git diff -- src/web/hooks/useTaskCenter.ts
pnpm typecheck
```

预期：`rg` 无匹配，Hook 无差异，类型检查退出码为 `0`。

## 任务 4：实现共享样式并保持响应式布局

**文件：**

- Modify: `src/web/styles.css`

- [x] **步骤 1：删除任务中心原生 select 样式**

从组合选择器中移除 `.task-center-filters select`，完整删除包含 `appearance`、`-webkit-appearance`、`color-scheme` 和 data URI 箭头的规则。保留搜索框 `38px` 高度。

- [x] **步骤 2：新增共享下拉样式**

使用以下基础样式，不新增颜色常量替代现有 CSS 变量：

```css
.dropdown {
  min-width: 0;
  position: relative;
  display: grid;
  gap: 5px;
}

.dropdown-label {
  color: var(--subtle);
  font-size: 10px;
  font-weight: 800;
  letter-spacing: 0.04em;
}

.dropdown-trigger {
  width: 100%;
  min-width: 0;
  height: 38px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 9px 8px 10px;
  border: 1px solid var(--border);
  border-radius: 8px;
  color: var(--text);
  background: var(--surface-strong);
  text-align: left;
}

.dropdown-trigger:hover:not(:disabled) {
  border-color: var(--subtle);
  background: var(--surface-hover);
}

.dropdown-trigger:focus-visible {
  box-shadow: 0 0 0 3px var(--accent-soft);
}

.dropdown-value {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dropdown-chevron {
  width: 14px;
  height: 14px;
  flex: 0 0 auto;
  color: var(--subtle);
  transition: transform 140ms ease;
}

.dropdown-chevron--open {
  transform: rotate(180deg);
}

.dropdown-list {
  z-index: 200;
  position: fixed;
  display: grid;
  gap: 2px;
  padding: 4px;
  overflow-y: auto;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--surface-strong);
  box-shadow: 0 12px 30px rgb(0 0 0 / 35%);
}

.dropdown-option {
  width: 100%;
  min-height: 32px;
  padding: 7px 8px;
  overflow: hidden;
  border: 0;
  border-radius: 6px;
  color: var(--muted);
  background: transparent;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.dropdown-option--active {
  color: var(--text);
  background: var(--surface-hover);
}

.dropdown-option--selected {
  color: var(--accent);
  background: var(--accent-soft);
}
```

- [x] **步骤 3：让任务中心布局绑定新组件根节点**

删除 `.task-center-filters label` 和 `label > span:first-child` 规则；共享 `.dropdown` / `.dropdown-label` 已提供相同行为。保留 `.task-center-sort { flex: 0 0 150px; }`，因为该类现在挂在 `Dropdown` 根节点。窄屏下现有两列筛选网格保持不变。

- [x] **步骤 4：运行样式和构建门禁**

运行：

```powershell
pnpm lint
pnpm typecheck
pnpm build:web
git diff --check
```

预期：全部退出码为 `0`，构建产物正常生成，无空白错误。

## 任务 5：执行交互与视觉验收

**文件：**

- No repository test files
- Temporary only: Playwright IPC mock and screenshots outside the repository

- [x] **步骤 1：启动 Web 开发服务**

运行：

```powershell
pnpm dev:web --host 127.0.0.1 --port 4173
```

预期：Vite 在 `http://127.0.0.1:4173` 可访问。保持服务运行直至 Playwright 验收结束。

- [x] **步骤 2：使用 Playwright 注入最小 Tauri IPC mock**

在页面加载前设置 `globalThis.isTauri = true`，提供 `window.__TAURI_INTERNALS__` 的 `invoke`、`transformCallback`、`unregisterCallback`，并为事件插件提供监听/卸载返回值。至少返回：

```text
list_projects    -> 一个 focus 项目的 ProjectListResponse
list_tasks       -> 同项目下覆盖多个状态、阶段、负责人和包的 TaskCenterResponse
check_for_update -> { status: "upToDate", currentVersion: "0.2.0-beta.6", platform: "windows" }
plugin:event|*   -> 可注册和卸载的稳定回调 ID
```

打开 `http://127.0.0.1:4173/?mode=tasks`，等待“跨项目任务中心”出现；IPC mock 只存放于临时目录或 Playwright 会话，不写入仓库。

- [x] **步骤 3：验证六个下拉的鼠标与业务流程**

逐项断言：

1. 页面存在 6 个 `aria-haspopup="listbox"` 触发器，且不存在 `select`。
2. 打开每个触发器后只出现一个可见 `role="listbox"`。
3. 五个筛选列表都有“全部”；排序列表只有两个非空选项。
4. 选择状态、阶段、负责人或包后任务结果数量按现有逻辑变化。
5. 选择“最早更新优先”后结果顺序反转，再选“最近更新优先”恢复。
6. 打开一个下拉再点击另一个，前一个关闭且新列表正常打开。
7. 点击列表外页面区域后列表关闭，已选值保持不变。

- [x] **步骤 4：验证键盘和 ARIA**

对至少一个筛选下拉和排序下拉分别验证：

1. `Enter` 和 `Space` 可打开。
2. `ArrowDown` / `ArrowUp` 更新 `aria-activedescendant`。
3. `Enter` 确认后 `aria-expanded="false"`，焦点回到触发按钮。
4. `Escape` 关闭但不改变值。
5. `Tab` 关闭并把焦点移到正常的下一控件。
6. 当前选项具有 `aria-selected="true"`。

- [x] **步骤 5：验证 Portal、主题和响应式**

在 `1440x900`、`768x900` 和 `375x812` 视口截图并断言：

- 列表节点位于 `document.body`，不在 `.task-center-filters` 内。
- 列表背景计算值对应 `var(--surface-strong)`，选中项背景对应 `var(--accent-soft)`、文字对应 `var(--accent)`。
- 列表未超出视口左右边界；靠近视口底部时可向上展开或限制内部高度。
- 页面 `document.documentElement.scrollWidth <= window.innerWidth`。
- 搜索框、排序、清除按钮和筛选网格无重叠，长选项文本不撑开布局。
- 浏览器控制台无错误。

当前 Windows 环境不能替代 macOS Tauri WebKit 实机；最终交付明确记录 macOS 视觉项是否已实测。代码中原生 `<select>` 清零是消除系统弹出层的静态证据。

## 任务 6：质量审查、规范复核与提交

**文件：**

- Review: `src/web/components/Dropdown.tsx`
- Review: `src/web/components/TaskCenter.tsx`
- Review: `src/web/styles.css`
- Update: `.trellis/tasks/07-23-task-center-custom-dropdown/prd.md`
- Review: `.trellis/spec/frontend/component-guidelines.md`

- [x] **步骤 1：使用 `trellis-check` 执行全范围审查**

重点核对：组件可复用边界、可空/非空类型、事件监听清理、Portal 外部点击判断、活动索引越界、ARIA、六个调用、无 Hook 变化、响应式和 PRD 每条验收标准。发现问题后修复并重跑受影响验证。

- [x] **步骤 2：执行最终质量命令**

```powershell
rg -n "<select|</select>|<option" src/web
pnpm lint
pnpm typecheck
pnpm build:web
git diff --check
git status --short
```

预期：`rg` 无匹配；质量命令均为 `0`；状态仅包含本任务文件和实施前已存在的 Tauri 三个改动。

- [x] **步骤 3：使用 `superpowers:verification-before-completion` 复核证据**

读取最后一次命令输出与 Playwright 结果，禁止以旧输出或推测勾选 PRD。macOS 未实测时必须明确保留该验收说明，不能宣称完整实机通过。

- [x] **步骤 4：更新任务验收记录和代码规范**

在 `prd.md` 中仅勾选有证据支持的 AC；检查 `component-guidelines.md` 的公共合同与最终代码一致。若实现过程没有产生新的项目级规则，不重复扩写规范。

- [ ] **步骤 5：仅提交本任务文件**

```powershell
git add src/web/components/Dropdown.tsx src/web/components/TaskCenter.tsx src/web/styles.css .trellis/spec/frontend/component-guidelines.md .trellis/tasks/07-23-task-center-custom-dropdown
git diff --cached --check
git diff --cached --stat
git commit -m "feat: 添加可复用自定义下拉组件"
```

不得暂存或提交实施前已存在的 Tauri 三个改动。提交成功后按 Trellis 流程记录会话并归档任务。

## 回滚点

1. 任务 2 独立新增组件，接入前删除该文件即可回滚，不影响现有页面。
2. 任务 3 和任务 4 必须一起回滚，避免 JSX 与样式不匹配。
3. 不回滚 `useTaskCenter.ts`，因为本计划禁止修改该文件。
4. 不以恢复原生 `<select>` 作为长期解决方案；Portal 或键盘缺陷在共享组件内修复。
