use std::panic::{AssertUnwindSafe, catch_unwind};
use std::sync::Arc;

use time::{OffsetDateTime, format_description::well_known::Rfc3339};
use uuid::Uuid;

use crate::contracts::{
    ProjectEventResource, ProjectInvalidationScope, ProjectRealtimeEvent, ProjectRealtimeEventType,
    ProjectRuntimeWatchMode,
};

/// Core 向桌面或未来 Web adapter 发布轻量事件的端口。
pub trait EventSink: Send + Sync + 'static {
    /// 发布一条不包含正文、快照或绝对路径的项目事件。
    fn emit(&self, event: ProjectRealtimeEvent);
}

/// 不消费事件的默认端口，供独立 Core 调用和仓库外验证使用。
#[derive(Debug, Default)]
pub struct NoopEventSink;

impl EventSink for NoopEventSink {
    fn emit(&self, _event: ProjectRealtimeEvent) {}
}

/// 发布事件时由实时管理器提供的领域字段。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct ProjectRealtimeEventInput<'a> {
    pub event_type: ProjectRealtimeEventType,
    pub project_id: &'a str,
    pub resource: ProjectEventResource,
    pub scope: ProjectInvalidationScope,
    pub watch_mode: ProjectRuntimeWatchMode,
}

/// 集中生成事件 ID 和时间戳，并隔离 adapter 回调异常。
pub struct ProjectEventPublisher {
    sink: Arc<dyn EventSink>,
}

impl ProjectEventPublisher {
    /// 创建使用指定 adapter 端口的事件发布器。
    #[must_use]
    pub fn new(sink: Arc<dyn EventSink>) -> Self {
        Self { sink }
    }

    /// 创建并发布一条轻量项目失效事件。
    pub fn publish(&self, input: ProjectRealtimeEventInput<'_>) -> ProjectRealtimeEvent {
        let event = ProjectRealtimeEvent {
            id: Uuid::new_v4().to_string(),
            event_type: input.event_type,
            project_id: input.project_id.to_owned(),
            resource: input.resource,
            scope: input.scope,
            timestamp: now_iso(),
            watch_mode: input.watch_mode,
        };
        let sink = Arc::clone(&self.sink);
        let event_for_sink = event.clone();
        let _ = catch_unwind(AssertUnwindSafe(move || sink.emit(event_for_sink)));
        event
    }
}

fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}
