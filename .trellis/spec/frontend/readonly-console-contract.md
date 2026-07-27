# 只读桌面控制台可执行合同

## 通信

- 所有业务查询和系统操作通过 `src/web/api-client.ts` 的 Tauri Command。
- 在线更新同样只通过集中客户端调用 Rust Command；组件和 Hook 不直接访问 updater 插件或任意网络。
- 实时入口固定为 `listen("trellis://project-realtime")`。
- 非 Tauri 页面显示稳定桌面运行时错误，不回退 HTTP。
- Tauri 订阅失败显示“实时通道不可用”，浏览快照仍可继续。

## 项目与正文

- 页面保留 `focus | history | unavailable` 三态分组。
- 历史项目只展示摘要；显式刷新或加入焦点成功后才显示正文浏览器。
- Spec/Task 选择必须来自当前详情快照；详情变化后自动修复失效选择。
- 文档请求只能在项目 ID、读取资格和白名单全部匹配时发出。
- Markdown 使用 `react-markdown + remark-gfm`，不启用原始 HTML。

## 任务中心

- 默认范围为焦点项目、默认集合为活动任务。
- 支持项目、状态、阶段、负责人、包、关键词和更新时间排序。
- `done` 与 `completed` 汇总到完成组，未知状态进入其他组。
- 2000 条结果首次只挂载 100 行，每次加载再增加 100 行。
- 无事件失效时重新进入任务中心不重复请求；事件批次只增加一次刷新代次。

## URL 与竞态

- 项目模式和任务中心模式使用互斥查询参数集合。
- 非法、过期或不属于当前项目的选择自动清理。
- 详情提交必须通过项目 ref、请求代次和响应项目 ID 三重校验。
- IPC 无原生取消时，旧响应也不得覆盖当前详情或正文。

## 诊断与系统操作

- 诊断页提供打开日志目录和清除本地数据并退出。
- 诊断页展示应用版本、免费内测标识、更新状态和手动检查入口；自动检查只提示，不自动下载。
- 清理前明确说明只删除项目列表、快照和日志，不删除 Trellis 项目，并要求确认。
- 取消确认不得发送清理 Command；确认只发送 `{ confirmed: true }`。
- 前端不获得任意 opener 或文件系统 capability。

## 响应式与安全验收

Playwright IPC mock 至少覆盖：成功/错误 Schema、延迟详情竞态、单活动订阅、150ms 合并、任务中心刷新代次、2000 条分批渲染、Markdown 原始 HTML与危险协议、诊断操作，以及 375/768/1024/1440 零页面横向滚动。

真实 Tauri 应用至少覆盖：扫描、登记、焦点、刷新、Spec/Task 正文、原生事件自动刷新、系统目录选择、受控项目路径、日志目录和隔离数据清理。

## 场景：从侧边栏移除项目

### 1. 范围 / 触发条件

- 修改侧边栏项目操作、移除确认、当前选择修复或跨项目任务缓存时适用。

### 2. 签名

```ts
removeProject(projectId: string): Promise<ProjectRemoveResponse>
removeRegisteredProject(projectId: string): Promise<void>
```

### 3. 合同

- 焦点、历史和不可用分组复用同一个移除入口；选择按钮与垃圾桶按钮必须是同级语义按钮。
- 垃圾桶在项目选中、行悬停或 `focus-within` 时可见，提供 `aria-label` 和 `title`，并为长名称、状态和诊断数量预留固定空间。
- 确认文案必须说明只删除应用登记和摘要、不删除源项目与 `.trellis`、之后可以重新添加；取消时不得调用 Command。
- 移除当前项目前先把选择设为 `null` 并递增详情请求代次；Command 无论成功失败都重新读取项目列表。
- 成功后增加任务中心刷新代次；剩余项目选择列表第一项，最后项目移除后打开项目发现页。

### 4. 校验与错误矩阵

| 条件 | 界面行为 |
| --- | --- |
| 用户取消确认 | 列表、选择、详情和 Command 调用数均不变 |
| 移除非当前项目成功 | 当前详情保持，列表和任务中心刷新 |
| 移除当前项目成功 | 旧详情立即失效，选择剩余第一项 |
| 移除最后项目成功 | URL 清除项目参数并打开添加项目界面 |
| Command 返回错误 | 展示稳定错误，同时用后端列表修复实际状态 |
| 迟到详情或正文返回 | 因项目 ref / 请求代次不匹配而丢弃 |

### 5. Good / Base / Bad Cases

- Good：Hook 统一管理确认、请求代次、权威列表刷新和任务中心失效，组件只转发项目 ID。
- Base：取消确认，不产生 IPC 调用。
- Bad：删除按钮嵌套在项目选择按钮内，或成功后只本地过滤数组而不重新读取 Core。

### 6. 必需验证与断言点

- Playwright IPC mock 覆盖三种项目状态、鼠标悬停、键盘聚焦、可访问名称和长名称/诊断数不重叠。
- 分别取消和确认，断言 `remove_project` 调用次数、确认文案和成功提示。
- 延迟旧详情响应直到移除完成后再返回，断言不能覆盖新选择。
- 移除当前项和最后一项，断言 URL、首项选择、添加项目页和任务中心刷新。

### 7. Wrong vs Correct

#### Wrong

```tsx
<button onClick={selectProject}>
  项目
  <button onClick={removeProject}>删除</button>
</button>
```

#### Correct

```tsx
<div className="project-item-row">
  <button onClick={selectProject}>项目</button>
  <button aria-label="移除项目：项目名称" onClick={removeProject} />
</div>
```
