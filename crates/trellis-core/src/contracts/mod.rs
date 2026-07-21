//! 桌面 Command 与未来适配层共享的传输无关线协议。

use serde::{Deserialize, Serialize};

use crate::storage::{
    ProjectSnapshot, RegisteredProject, SnapshotDiagnostic, StorageError, TaskSummarySnapshot,
};

/// 传输层统一返回的稳定错误。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct CommandError {
    pub code: String,
    pub message: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub details: Option<Vec<String>>,
}

impl CommandError {
    /// 创建不包含字段详情的命令错误。
    #[must_use]
    pub fn new(code: impl Into<String>, message: impl Into<String>) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: None,
        }
    }

    /// 创建包含稳定字段详情的命令错误。
    #[must_use]
    pub fn with_details(
        code: impl Into<String>,
        message: impl Into<String>,
        details: Vec<String>,
    ) -> Self {
        Self {
            code: code.into(),
            message: message.into(),
            details: Some(details),
        }
    }
}

impl From<StorageError> for CommandError {
    fn from(error: StorageError) -> Self {
        match error {
            StorageError::UnsupportedVersion {
                actual_version,
                expected_version,
                ..
            } => Self::with_details(
                "storage-version-unsupported",
                "应用数据版本不受当前客户端支持",
                vec![format!(
                    "当前版本为 {actual_version}，客户端支持版本为 {expected_version}"
                )],
            ),
            StorageError::InvalidStructure { details, .. } => Self::with_details(
                "storage-invalid",
                "应用数据结构不合法，原文件已保留",
                details,
            ),
            StorageError::Io { operation, .. } => Self::with_details(
                "storage-unavailable",
                "应用数据暂时无法访问",
                vec![format!("失败阶段：{operation}")],
            ),
            StorageError::QueueUnavailable => Self::new(
                "storage-queue-unavailable",
                "应用数据写入队列不可用，请重启客户端",
            ),
        }
    }
}

/// 项目运行时监听模式。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectRuntimeWatchMode {
    Stopped,
    Native,
    Polling,
}

/// 单个项目的进程内监听状态。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectRuntimeStatus {
    pub project_id: String,
    pub watch_mode: ProjectRuntimeWatchMode,
    pub realtime: bool,
    pub pending_changes: usize,
}

/// 项目实时事件类型。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "kebab-case")]
pub enum ProjectRealtimeEventType {
    ProjectFocused,
    ProjectInvalidated,
    SpecChanged,
    TasksChanged,
    ProjectUnavailable,
    ProjectReindexed,
}

/// 实时事件指向的只读资源。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectEventResource {
    Project,
    Spec,
    Tasks,
}

/// 页面重新查询数据时使用的失效范围。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectInvalidationScope {
    All,
    Summary,
    Tree,
}

/// Core 通过事件端口发布的轻量项目失效事件。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectRealtimeEvent {
    pub id: String,
    #[serde(rename = "type")]
    pub event_type: ProjectRealtimeEventType,
    pub project_id: String,
    pub resource: ProjectEventResource,
    pub scope: ProjectInvalidationScope,
    pub timestamp: String,
    pub watch_mode: ProjectRuntimeWatchMode,
}

/// 项目列表单项。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectListItem {
    pub project: RegisteredProject,
    pub runtime: ProjectRuntimeStatus,
    pub has_snapshot: bool,
    pub possibly_stale: bool,
    pub active_task_count: usize,
    pub archived_task_count: usize,
    pub diagnostic_count: usize,
}

/// 项目列表响应。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectListResponse {
    pub projects: Vec<ProjectListItem>,
}

/// Task 所属集合。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum TaskCollection {
    Active,
    Archived,
}

/// 跨项目任务中心单项。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskCenterItem {
    pub project_id: String,
    pub collection: TaskCollection,
    pub task: TaskSummarySnapshot,
    pub parent_title: Option<String>,
}

/// 跨项目任务中心响应。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskCenterResponse {
    pub projects: Vec<ProjectListItem>,
    pub tasks: Vec<TaskCenterItem>,
}

/// 单项目详情响应。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectDetailResponse {
    pub project: RegisteredProject,
    pub runtime: ProjectRuntimeStatus,
    pub snapshot: Option<ProjectSnapshot>,
    pub possibly_stale: bool,
    pub content_readable: bool,
}

/// 快速扫描请求。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectScanRequest {
    pub root_path: String,
}

/// 快速扫描候选。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectScanCandidate {
    pub project: RegisteredProject,
    pub snapshot: ProjectSnapshot,
}

/// 快速扫描响应。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectScanResponse {
    pub candidates: Vec<ProjectScanCandidate>,
    pub diagnostics: Vec<SnapshotDiagnostic>,
}

/// 单个待登记项目。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectRegisterInput {
    pub path: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub label: Option<String>,
}

/// 批量登记请求。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectRegisterRequest {
    pub projects: Vec<ProjectRegisterInput>,
}

/// 单个项目登记结果状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectRegistrationStatus {
    Added,
    Updated,
    Invalid,
}

/// 单个项目登记结果。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectRegistrationResult {
    pub status: ProjectRegistrationStatus,
    pub project: Option<RegisteredProject>,
    pub snapshot: Option<ProjectSnapshot>,
    pub diagnostics: Vec<SnapshotDiagnostic>,
}

/// 批量登记响应。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectRegisterResponse {
    pub results: Vec<ProjectRegistrationResult>,
}

/// 焦点切换请求。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectFocusRequest {
    pub focused: bool,
}

/// 项目操作后的详情响应。
pub type ProjectActionResponse = ProjectDetailResponse;

/// 项目文档格式。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectDocumentFormat {
    Markdown,
    Jsonl,
}

/// Spec Markdown 或 Task 文档响应。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectDocumentResponse {
    pub content: String,
    pub source_path: String,
    pub modified_at: String,
    pub format: ProjectDocumentFormat,
}

/// Task 文档清单单项。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskDocumentSummary {
    pub name: String,
    pub relative_path: String,
    pub source_path: String,
    pub format: ProjectDocumentFormat,
    pub modified_at: String,
}

/// Task 详情响应。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskDetailResponse {
    pub project_id: String,
    pub task: TaskSummarySnapshot,
    pub documents: Vec<TaskDocumentSummary>,
}

/// 外部打开请求。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenProjectPathRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source_path: Option<String>,
}

/// 外部打开响应。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct OpenProjectPathResponse {
    opened: bool,
}

impl OpenProjectPathResponse {
    /// 创建成功打开响应。
    #[must_use]
    pub fn opened() -> Self {
        Self { opened: true }
    }

    /// 返回路径是否已交给系统外部应用打开。
    #[must_use]
    pub fn is_opened(self) -> bool {
        self.opened
    }
}

/// 系统目录选择请求。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct DirectoryPickerRequest {}

/// 系统目录选择响应。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(tag = "status", rename_all = "lowercase", deny_unknown_fields)]
pub enum DirectoryPickerResponse {
    Selected { path: String },
    Cancelled,
}

/// 清除应用数据并退出的确认请求。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ClearApplicationDataRequest {
    pub confirmed: bool,
}
