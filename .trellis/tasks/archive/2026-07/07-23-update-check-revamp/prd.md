# 自动更新检查优化与更新入口改版

## 目标

将自动检查间隔从 24 小时缩短为 30 分钟，用版本号旁的绿色按钮取代顶部横条通知，并在侧边栏左下角增加弱化的手动检查更新按钮以替代诊断面板的对应入口。

## 背景

当前实现：
- `src-tauri/src/system/updater.rs:17`：`AUTOMATIC_CHECK_INTERVAL = Duration::hours(24)`，只在应用启动时检查一次
- `src/web/hooks/useApplicationUpdater.ts:125`：仅在 mount 时触发一次 `check("automatic")`，无周期定时器
- `src/web/App.tsx:57`：`<ApplicationUpdateNotice updater={updater} />`，`available / installed` 时在工作区顶部显示横条
- `src/web/components/DiagnosticsPanel.tsx:37`：嵌入完整的 `<ApplicationUpdatePanel>`，包含"检查更新"按钮
- `src/web/components/ProjectSidebar.tsx`：当前不接收 `updater` prop，版本号仅为纯文本 `brand-version` span

## 需求

**R1 — 后端缩短自动检查间隔**
`updater.rs:17` 将 `AUTOMATIC_CHECK_INTERVAL` 从 `Duration::hours(24)` 改为 `Duration::minutes(30)`。

**R2 — 前端增加 30 分钟周期定时器**
`useApplicationUpdater.ts` 在现有 mount 触发之外，增加 `setInterval`（30 分钟）周期调用 `check("automatic")`；useEffect 清理函数执行 `clearInterval`，避免 unmount 后继续触发。

**R3 — 移除工作区顶部横条**
删除 `App.tsx:57` 的 `<ApplicationUpdateNotice>` 引用，及 `ApplicationUpdate.tsx` 中的 `ApplicationUpdateNotice` 组件函数，以及 `styles.css` 中的 `.update-notice` 及相关子选择器。

**R4 — 版本号右侧更新按钮**
`ProjectSidebar` 新增 `updater: ApplicationUpdaterController` prop：
- `phase === "available"` 时，版本号同行右侧显示绿色背景"更新"按钮，点击 `updater.openDialog()`
- `phase === "installed"` 时，同行右侧显示橙黄色"重启"按钮，点击 `updater.openDialog()`
- 其他 phase 不显示额外按钮，版本号区域保持现状
- `App.tsx` 补传 `updater` prop 给 `ProjectSidebar`

**R5 — 侧边栏左下角检查更新按钮**
在 `ProjectSidebar` 的 `sidebar-footer` 区域增加弱化风格（ghost/subtle）的"检查更新"按钮：
- 点击调用 `updater.check("manual")`
- `phase === "checking"` 时显示旋转图标并禁用
- `phase === "downloading"` 时禁用
- 视觉上弱化，与 footer 文字信息协调，不喧宾夺主

**R6 — 从诊断面板移除 ApplicationUpdatePanel**
`DiagnosticsPanel.tsx` 中整体移除 `<ApplicationUpdatePanel updater={updater} />`，以及对应的 `updater` prop 定义和所有使用处（`DiagnosticsPanel` 接口、调用点 `App.tsx:renderProjectView`）。应用更新信息与单个项目诊断无关，不应出现在此页面。

## 验收标准

- [ ] AC1：应用运行约 30 分钟后后台日志出现新的 `update-check-started`（定时器生效）
- [ ] AC2：有新版本时，侧边栏版本号旁出现绿色"更新"按钮，点击弹出更新弹框
- [ ] AC3：已安装待重启时，版本号旁出现橙色"重启"按钮，点击弹出弹框
- [ ] AC4：无特殊状态时，版本号旁无额外按钮
- [ ] AC5：侧边栏左下角"检查更新"按钮可见，检查中自动禁用并显示旋转图标
- [ ] AC6：工作区顶部不再出现更新横条
- [ ] AC7：诊断面板中 `ApplicationUpdatePanel` 整体消失，诊断页不再展示任何应用更新内容

## 超出范围

- `ApplicationUpdateDialog`（弹框内部）流程和内容不变
- 更新下载、签名验证、安装逻辑不变
- `tauri.conf.json` 更新端点配置不变
