use std::sync::Arc;

use tauri::{AppHandle, Emitter, Manager};
use trellis_core::contracts::ProjectRealtimeEvent;
use trellis_core::realtime::EventSink;

use crate::system::logging::AppLogger;

/// 前端进程内实时事件的固定名称。
pub const PROJECT_REALTIME_EVENT_NAME: &str = "trellis://project-realtime";

/// 将 Core 轻量事件发送到主窗口的 Tauri adapter。
pub struct TauriEventSink {
    app: AppHandle,
    logger: Arc<AppLogger>,
}

impl TauriEventSink {
    /// 创建绑定当前桌面进程的事件端口。
    #[must_use]
    pub fn new(app: AppHandle, logger: Arc<AppLogger>) -> Self {
        Self { app, logger }
    }
}

impl EventSink for TauriEventSink {
    fn emit(&self, event: ProjectRealtimeEvent) {
        self.logger.project_event(&event);
        if let Some(window) = self.app.get_webview_window("main") {
            let _ = window.emit(PROJECT_REALTIME_EVENT_NAME, event);
        }
    }
}
