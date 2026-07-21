# 焦点项目实时更新可执行合同

## 状态与顺序

- 持久状态为 `history | focus | unavailable`；运行时模式为 `stopped | native | polling`。
- 历史和不可用项目启动时零源访问、零 watcher。
- 聚焦顺序：校验与索引 -> 保存快照 -> 启动 native/polling -> 保存 `focus`。
- 取消聚焦顺序：保存 `history` -> 清理防抖 -> 关闭 watcher。
- 项目失效时保存 `unavailable`、释放 watcher、保留旧快照。
- 修复后显式刷新回到 `history`，不得在没有 watcher 时恢复为 `focus`。

## watcher

- 只监听 Spec、Task、config 和 workflow；Spec/Task 递归，固定文件非递归。
- 缺失可选 workflow 时可监听 `.trellis` 创建哨兵，但进入管理器后仍按允许路径过滤。
- 使用 `notify` 原生 watcher；启动或运行失败时重新校验后切换 10 秒 PollWatcher。
- polling 也失败时清理运行时并发布 `stopped` 失效事件。
- 中央事件线程按项目队列串行处理，路径去重并 300ms 防抖，一批只重索引一次。
- 取消聚焦后的迟到事件必须丢弃。

## 事件与退出

- Core 只调用 `EventSink`，不依赖 Tauri。
- 事件只包含稳定轻量字段；adapter 发布 `trellis://project-realtime`。
- 关闭时先拒绝新生命周期操作，等待项目队列并释放线程和 watcher。

## 验证

临时 fixture 覆盖快速事件合并、越界忽略、native 启动/运行失败、polling 失败、项目删除/修复、重启焦点恢复和关闭清理。真实平台至少观察一次允许文件写入到 UI 自动刷新的闭环。
