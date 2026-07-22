# 前端状态管理

| 状态 | 所有者 | 示例 |
| --- | --- | --- |
| Core 查询状态 | `useProjectConsole` / `useTaskCenter` | 项目、详情、正文、任务中心 |
| URL 状态 | `useProjectConsole` | 模式、项目、视图、文档、筛选 |
| 操作状态 | `useProjectConsole` | busy、notice、目录选择 |
| 应用更新状态 | `useApplicationUpdater` | 检查、版本、进度、错误、待重启 |
| 组件本地状态 | 功能组件 | 展开、输入、分批可见数量 |
| 派生状态 | `useMemo` | 筛选结果、汇总、可用选项 |

## 规则

- Core/Command 响应是事实来源，Tauri Event 只是失效通知。
- 项目阅读 URL 与任务中心筛选 URL 分支独立，切换时清除不适用参数。
- 项目/资源切换先清旧内容，再加载新内容，不展示陈旧正文。
- 不把筛选结果、统计或 watcher 状态重复存成第二份可变数据。
- 清理、日志打开和焦点操作通过统一 busy/notice 状态反馈。
- 当前规模不引入路由库或全局状态库。
- 应用更新与项目操作状态分离，检查或下载不能阻塞本地只读浏览。
