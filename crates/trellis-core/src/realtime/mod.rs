//! 焦点项目的受限监听、批量重索引和轻量事件端口。

mod event;
mod manager;
mod watcher;

pub use event::{EventSink, NoopEventSink};
pub use manager::{ProjectRealtimeError, ProjectRealtimeManager, ProjectRestoreResult};
pub use watcher::{
    NotifyProjectFileWatcherFactory, ProjectFileWatcher, ProjectFileWatcherFactory,
    ProjectFileWatcherOptions, ProjectWatcherCallback, ProjectWatcherError, ProjectWatcherEvent,
};
