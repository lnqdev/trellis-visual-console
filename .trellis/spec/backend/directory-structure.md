# 后端目录结构

## 当前布局

```text
Cargo.toml
crates/trellis-core/
  src/
    application/  应用服务、Catalog 与正文资格
    contracts/    Serde Command/Event DTO 与稳定错误
    projects/     扫描、索引、正文和路径安全
    realtime/     watcher、轮询、队列与 EventSink
    storage/      版本化存储、迁移与原子文件层
src-tauri/
  src/
    commands/     Tauri Command 薄适配
    system/       路径、日志、目录选择、外部打开和清理
    lib.rs        Builder、AppState、插件和窗口生命周期
    realtime.rs   EventSink 到 Tauri Event 的适配
```

## 依赖规则

- 依赖方向固定为 `src-tauri -> trellis-core`。
- Core 禁止导入 Tauri、Axum、Actix、窗口、WebView 或插件类型。
- Core 从构造参数接收应用数据路径，通过 `EventSink` 发布事件。
- Command adapter 只负责参数、线程调度、Core 调用和错误透传，不复制业务规则。
- 系统对话框、opener、窗口和退出只能位于 `src-tauri`。
- `src/shared` 是前端运行时合同，不是第二套后端实现。
- 禁止恢复 `src/server`、Node sidecar 或 Tauri Command 调用本地 HTTP 的结构。

## 公开入口

- Core：`trellis_core::application::ApplicationService`。
- 事件端口：`trellis_core::realtime::EventSink`。
- Tauri Builder：`src-tauri/src/lib.rs`。
- Command 注册：`src-tauri/src/commands/mod.rs`。
