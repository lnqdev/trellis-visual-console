use std::collections::{HashMap, HashSet};

use serde::{Deserialize, Serialize};
use time::{OffsetDateTime, UtcOffset, format_description::well_known::Rfc3339};

/// 当前桌面应用数据文件版本。
pub const STORAGE_VERSION: u32 = 2;

/// 可持久化版本数据需要提供统一语义校验。
pub trait VersionedStorageData {
    /// 返回文件声明的存储版本。
    fn version(&self) -> u32;

    /// 校验版本与跨字段语义约束。
    fn validate(&self, expected_version: u32) -> Result<(), StorageValidationError>;
}

/// 存储数据通过 Serde 后仍不满足领域约束。
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("存储数据结构不合法")]
pub struct StorageValidationError {
    details: Vec<String>,
}

impl StorageValidationError {
    /// 创建包含稳定中文详情的校验错误。
    #[must_use]
    pub fn new(details: Vec<String>) -> Self {
        Self { details }
    }

    /// 返回可用于诊断的稳定中文详情。
    #[must_use]
    pub fn details(&self) -> &[String] {
        &self.details
    }
}

/// 项目在应用中的展示生命周期。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum ProjectDisplayState {
    /// 只展示最后成功快照。
    History,
    /// 持续读取并监听 Trellis 展示路径。
    Focus,
    /// 项目当前无法校验或读取。
    Unavailable,
}

/// 项目不可用或索引失败时保存的稳定错误摘要。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectError {
    pub code: String,
    pub message: String,
    pub occurred_at: String,
}

/// 单个已登记项目的数据结构。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct RegisteredProject {
    pub id: String,
    pub path: String,
    pub label: String,
    pub state: ProjectDisplayState,
    pub last_accessed_at: Option<String>,
    pub last_indexed_at: Option<String>,
    pub error: Option<ProjectError>,
}

/// 项目注册表文件。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectRegistryFile {
    pub version: u32,
    pub projects: Vec<RegisteredProject>,
}

impl ProjectRegistryFile {
    /// 创建空的当前版本项目注册表。
    #[must_use]
    pub fn empty() -> Self {
        Self {
            version: STORAGE_VERSION,
            projects: Vec::new(),
        }
    }
}

impl VersionedStorageData for ProjectRegistryFile {
    fn version(&self) -> u32 {
        self.version
    }

    fn validate(&self, expected_version: u32) -> Result<(), StorageValidationError> {
        let mut details = validate_version(self.version, expected_version);
        let mut project_ids = HashSet::new();
        let mut project_paths = HashSet::new();

        for (index, project) in self.projects.iter().enumerate() {
            let prefix = format!("projects.{index}");
            validate_non_empty(&project.id, &format!("{prefix}.id"), &mut details);
            validate_non_empty(&project.path, &format!("{prefix}.path"), &mut details);
            validate_non_empty(&project.label, &format!("{prefix}.label"), &mut details);
            validate_optional_datetime(
                project.last_accessed_at.as_deref(),
                &format!("{prefix}.lastAccessedAt"),
                &mut details,
            );
            validate_optional_datetime(
                project.last_indexed_at.as_deref(),
                &format!("{prefix}.lastIndexedAt"),
                &mut details,
            );
            if let Some(error) = &project.error {
                validate_non_empty(&error.code, &format!("{prefix}.error.code"), &mut details);
                validate_non_empty(
                    &error.message,
                    &format!("{prefix}.error.message"),
                    &mut details,
                );
                validate_datetime(
                    &error.occurred_at,
                    &format!("{prefix}.error.occurredAt"),
                    &mut details,
                );
            }
            if !project_ids.insert(project.id.as_str()) {
                details.push(format!("{prefix}.id: 项目 ID 不能重复"));
            }
            if !project_paths.insert(project.path.as_str()) {
                details.push(format!("{prefix}.path: 项目路径不能重复"));
            }
        }

        finish_validation(details)
    }
}

/// Spec 快照树节点类型。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SpecTreeNodeKind {
    Directory,
    File,
}

/// Spec 快照树节点。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SpecTreeNode {
    pub name: String,
    pub relative_path: String,
    pub kind: SpecTreeNodeKind,
    pub children: Vec<SpecTreeNode>,
}

/// Monorepo 包摘要。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectPackageSnapshot {
    pub name: String,
    pub path: String,
    #[serde(rename = "type")]
    pub package_type: Option<String>,
    pub git: bool,
}

/// 项目概览快照。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectOverviewSnapshot {
    pub label: String,
    pub path: String,
    pub packages: Vec<ProjectPackageSnapshot>,
}

/// Task 列表使用的最小摘要。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskSummarySnapshot {
    pub id: String,
    pub title: String,
    pub status: String,
    pub phase: Option<String>,
    pub assignee: Option<String>,
    pub package_name: Option<String>,
    pub updated_at: Option<String>,
    pub source_path: String,
    #[serde(default)]
    pub parent_source_path: Option<String>,
    #[serde(default)]
    pub child_source_paths: Vec<String>,
}

/// 活动与归档 Task 集合。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct TaskCollectionSnapshot {
    pub active: Vec<TaskSummarySnapshot>,
    pub archived: Vec<TaskSummarySnapshot>,
}

/// Workflow 页面使用的摘要。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct WorkflowSummarySnapshot {
    pub name: Option<String>,
    pub current_phase: Option<String>,
    pub summary: Option<String>,
    pub source_path: Option<String>,
}

/// 索引诊断级别。
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum SnapshotSeverity {
    Warning,
    Error,
}

/// 索引期间产生的稳定诊断信息。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct SnapshotDiagnostic {
    pub severity: SnapshotSeverity,
    pub code: String,
    pub message: String,
    pub source_path: Option<String>,
}

/// 单个项目的可重建摘要快照。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectSnapshot {
    pub project_id: String,
    pub indexed_at: String,
    pub overview: ProjectOverviewSnapshot,
    pub spec_tree: Vec<SpecTreeNode>,
    pub tasks: TaskCollectionSnapshot,
    pub workflow: WorkflowSummarySnapshot,
    pub diagnostics: Vec<SnapshotDiagnostic>,
}

/// 全部项目摘要快照文件。
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct ProjectSnapshotsFile {
    pub version: u32,
    pub snapshots: HashMap<String, ProjectSnapshot>,
}

impl ProjectSnapshotsFile {
    /// 创建空的当前版本项目摘要快照集合。
    #[must_use]
    pub fn empty() -> Self {
        Self {
            version: STORAGE_VERSION,
            snapshots: HashMap::new(),
        }
    }
}

impl VersionedStorageData for ProjectSnapshotsFile {
    fn version(&self) -> u32 {
        self.version
    }

    fn validate(&self, expected_version: u32) -> Result<(), StorageValidationError> {
        let mut details = validate_version(self.version, expected_version);
        for (project_id, snapshot) in &self.snapshots {
            validate_non_empty(project_id, "snapshots.key", &mut details);
            if snapshot.project_id != *project_id {
                details.push(format!(
                    "snapshots.{project_id}.projectId: 快照键必须与 projectId 一致"
                ));
            }
            validate_snapshot(snapshot, &format!("snapshots.{project_id}"), &mut details);
        }
        finish_validation(details)
    }
}

fn validate_snapshot(snapshot: &ProjectSnapshot, prefix: &str, details: &mut Vec<String>) {
    validate_non_empty(
        &snapshot.project_id,
        &format!("{prefix}.projectId"),
        details,
    );
    validate_datetime(
        &snapshot.indexed_at,
        &format!("{prefix}.indexedAt"),
        details,
    );
    validate_non_empty(
        &snapshot.overview.label,
        &format!("{prefix}.overview.label"),
        details,
    );
    validate_non_empty(
        &snapshot.overview.path,
        &format!("{prefix}.overview.path"),
        details,
    );
    for (index, package) in snapshot.overview.packages.iter().enumerate() {
        let package_prefix = format!("{prefix}.overview.packages.{index}");
        validate_non_empty(&package.name, &format!("{package_prefix}.name"), details);
        validate_non_empty(&package.path, &format!("{package_prefix}.path"), details);
        validate_optional_non_empty(
            package.package_type.as_deref(),
            &format!("{package_prefix}.type"),
            details,
        );
    }
    for (index, node) in snapshot.spec_tree.iter().enumerate() {
        validate_spec_node(node, &format!("{prefix}.specTree.{index}"), details);
    }
    validate_tasks(
        &snapshot.tasks.active,
        &format!("{prefix}.tasks.active"),
        details,
    );
    validate_tasks(
        &snapshot.tasks.archived,
        &format!("{prefix}.tasks.archived"),
        details,
    );
    for (index, diagnostic) in snapshot.diagnostics.iter().enumerate() {
        let diagnostic_prefix = format!("{prefix}.diagnostics.{index}");
        validate_non_empty(
            &diagnostic.code,
            &format!("{diagnostic_prefix}.code"),
            details,
        );
        validate_non_empty(
            &diagnostic.message,
            &format!("{diagnostic_prefix}.message"),
            details,
        );
        validate_optional_non_empty(
            diagnostic.source_path.as_deref(),
            &format!("{diagnostic_prefix}.sourcePath"),
            details,
        );
    }
}

fn validate_spec_node(node: &SpecTreeNode, prefix: &str, details: &mut Vec<String>) {
    validate_non_empty(&node.name, &format!("{prefix}.name"), details);
    validate_non_empty(
        &node.relative_path,
        &format!("{prefix}.relativePath"),
        details,
    );
    if node.kind == SpecTreeNodeKind::File && !node.children.is_empty() {
        details.push(format!("{prefix}.children: 文件节点不能包含子节点"));
    }
    for (index, child) in node.children.iter().enumerate() {
        validate_spec_node(child, &format!("{prefix}.children.{index}"), details);
    }
}

fn validate_tasks(tasks: &[TaskSummarySnapshot], prefix: &str, details: &mut Vec<String>) {
    for (index, task) in tasks.iter().enumerate() {
        let task_prefix = format!("{prefix}.{index}");
        validate_non_empty(&task.id, &format!("{task_prefix}.id"), details);
        validate_non_empty(&task.title, &format!("{task_prefix}.title"), details);
        validate_non_empty(&task.status, &format!("{task_prefix}.status"), details);
        validate_non_empty(
            &task.source_path,
            &format!("{task_prefix}.sourcePath"),
            details,
        );
        validate_optional_datetime(
            task.updated_at.as_deref(),
            &format!("{task_prefix}.updatedAt"),
            details,
        );
        validate_optional_non_empty(
            task.phase.as_deref(),
            &format!("{task_prefix}.phase"),
            details,
        );
        validate_optional_non_empty(
            task.assignee.as_deref(),
            &format!("{task_prefix}.assignee"),
            details,
        );
        validate_optional_non_empty(
            task.package_name.as_deref(),
            &format!("{task_prefix}.packageName"),
            details,
        );
        validate_optional_non_empty(
            task.parent_source_path.as_deref(),
            &format!("{task_prefix}.parentSourcePath"),
            details,
        );
        for (child_index, child) in task.child_source_paths.iter().enumerate() {
            validate_non_empty(
                child,
                &format!("{task_prefix}.childSourcePaths.{child_index}"),
                details,
            );
        }
    }
}

fn validate_version(actual: u32, expected: u32) -> Vec<String> {
    if actual == expected {
        Vec::new()
    } else {
        vec![format!("version: 当前为 {actual}，期望为 {expected}")]
    }
}

fn validate_non_empty(value: &str, field: &str, details: &mut Vec<String>) {
    if value.is_empty() {
        details.push(format!("{field}: 字段不能为空"));
    }
}

fn validate_optional_non_empty(value: Option<&str>, field: &str, details: &mut Vec<String>) {
    if value.is_some_and(str::is_empty) {
        details.push(format!("{field}: 字段不能为空"));
    }
}

fn validate_datetime(value: &str, field: &str, details: &mut Vec<String>) {
    if !matches!(
        OffsetDateTime::parse(value, &Rfc3339),
        Ok(datetime) if datetime.offset() == UtcOffset::UTC
    ) {
        details.push(format!("{field}: 必须是 ISO 8601 UTC 时间"));
    }
}

fn validate_optional_datetime(value: Option<&str>, field: &str, details: &mut Vec<String>) {
    if let Some(value) = value {
        validate_datetime(value, field, details);
    }
}

fn finish_validation(details: Vec<String>) -> Result<(), StorageValidationError> {
    if details.is_empty() {
        Ok(())
    } else {
        Err(StorageValidationError::new(details))
    }
}
