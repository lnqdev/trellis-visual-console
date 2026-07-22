# 前端 Hook 规范

## useProjectConsole

- 集中管理项目列表、详情、正文、URL、操作反馈和桌面事件状态。
- 切换项目时立即清空旧详情和正文选择。
- 每次详情请求递增代次；提交时同时校验当前项目 ref、代次和响应项目 ID。
- Effect 清理继续 `abort()`，但不能把 AbortController 当成 IPC 原生取消。
- 历史项目只有 `contentReadable=true` 后才请求 Spec/Task 正文。

## Tauri Event

- 只订阅 `trellis://project-realtime`，payload 先通过 `isProjectRealtimeEvent`。
- 连续事件使用 150ms 尾随合并，一批只刷新一次项目列表和任务中心。
- 当前项目出现在批次中时才后台刷新详情。
- 视图、项目文档标签和任务中心切换不得创建第二条活动订阅。
- Effect 清理必须调用 `unlisten`、清除定时器和待处理项目集合。
- 订阅失败显示“实时通道不可用”，不得宣称正在重连。

## useTaskCenter

- 使用 `refreshGeneration + retryGeneration` 缓存已完成请求。
- 未收到失效事件时，离开再返回任务中心复用内存响应。
- 请求代次阻止旧响应覆盖新结果；搜索使用约 200ms 延迟。

## useApplicationUpdater

- 更新状态独立于项目 Core/URL 状态，组件只消费控制器，不直接导入 Tauri updater。
- StrictMode 下自动检查只启动一次；检查、安装共用前端操作标记，Rust Command 仍负责最终互斥。
- 关闭弹窗不得清除 `available` 或 `installed`，macOS 稍后重启不持久化更新包。
