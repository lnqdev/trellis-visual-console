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

## 场景：移除项目的实时生命周期

### 1. 范围 / 触发条件

- 移除焦点、历史或不可用项目，或修改运行时 Map、项目锁和迟到事件处理时适用。

### 2. 签名

```rust
ProjectRealtimeManager::remove_project(&self, project_id: &str)
  -> Result<(), ProjectRealtimeError>
```

### 3. 合同

- 移除必须与聚焦、取消聚焦、刷新和文件批次共用同一个项目级锁。
- 持锁调用 Catalog 完成持久化移除后，从运行时 Map 取出项目并关闭 watcher。
- 运行时一旦从 Map 取出，即使 `watcher.close()` 报错也不得重新插入。
- 已排队的路径、失败通知和防抖截止事件找不到运行时时必须丢弃，不得重建已移除快照。

### 4. 校验与错误矩阵

| 条件 | 结果 |
| --- | --- |
| 历史或不可用项目 | 移除持久数据，活动 watcher 数不变 |
| 焦点项目 | 移除持久数据，从 Map 取出并关闭 watcher |
| Catalog 报项目不存在 | 返回 `ProjectNotFound`，不触碰其他运行时 |
| watcher 关闭失败 | 返回 `WatcherUnavailable`，运行时仍保持已取出状态 |
| 移除后收到迟到文件消息 | 忽略消息，不保存快照、不发布重新索引事件 |

### 5. Good / Base / Bad Cases

- Good：项目锁覆盖“持久化移除 -> Map 取出 -> watcher 关闭”的完整顺序。
- Base：零 watcher 的历史项目只执行持久化移除。
- Bad：先释放项目锁再关 watcher，或在迟到事件中按路径重新创建运行时。

### 6. 必需验证与断言点

- 焦点项目移除后断言 watcher 计数减一、Map 无该 ID、注册表和快照无该 ID。
- 在移除前排入路径消息，移除后释放队列，断言快照没有重新出现。
- 让 watcher `close` 失败，断言返回稳定错误且运行时 Map 仍无该 ID。
- 与刷新、聚焦并发执行，断言项目锁使最终状态可串行解释。

### 7. Wrong vs Correct

#### Wrong

```text
删除注册表 -> 释放项目锁 -> 异步关闭 watcher
```

#### Correct

```text
项目锁 -> Catalog 移除 -> 从 Map 取出 -> 关闭 watcher -> 释放项目锁
```
