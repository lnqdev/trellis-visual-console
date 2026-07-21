use std::fs;
use std::path::Path;
use std::time::SystemTime;

use time::{OffsetDateTime, format_description::well_known::Rfc3339};

use crate::contracts::{
    ProjectDocumentFormat, ProjectDocumentResponse, TaskDetailResponse, TaskDocumentSummary,
};
use crate::storage::ProjectSnapshot;

use super::paths::{
    UnsafeProjectPathError, normalize_project_relative_path, read_utf8_file,
    resolve_safe_project_path, to_project_relative_path,
};

/// 项目正文读取的稳定领域错误。
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
pub enum ProjectReadError {
    #[error("{0}")]
    UnsafePath(#[from] UnsafeProjectPathError),
    #[error("当前项目快照中不存在指定 Task")]
    TaskNotFound,
    #[error("当前 Task 中不存在指定文档")]
    TaskDocumentNotFound,
    #[error("Task 文档目录无法读取")]
    TaskDirectoryUnreadable,
}

/// 按需读取项目 `.trellis` 内的 Markdown 文件。
pub fn read_project_markdown(
    project_root: &Path,
    relative_path: &str,
) -> Result<ProjectDocumentResponse, ProjectReadError> {
    let normalized_path = normalize_markdown_path(relative_path)?;
    let safe_path = resolve_safe_project_path(project_root, &normalized_path, ".trellis")?;
    if !safe_path.metadata.is_file() {
        return Err(UnsafeProjectPathError::new("Markdown 路径不是普通文件").into());
    }
    Ok(ProjectDocumentResponse {
        content: read_utf8_file(&safe_path.real_path)?,
        source_path: normalized_path,
        modified_at: modified_at(&safe_path.metadata),
        format: ProjectDocumentFormat::Markdown,
    })
}

/// 根据快照白名单列出一个 Task 的 Markdown 和 JSONL 文档。
pub fn read_project_task_detail(
    project_root: &Path,
    snapshot: &ProjectSnapshot,
    task_source_path: &str,
) -> Result<TaskDetailResponse, ProjectReadError> {
    let task = snapshot
        .tasks
        .active
        .iter()
        .chain(&snapshot.tasks.archived)
        .find(|task| task.source_path == task_source_path)
        .cloned()
        .ok_or(ProjectReadError::TaskNotFound)?;
    let normalized_task_source_path = normalize_project_relative_path(&task.source_path)?;
    if !normalized_task_source_path.starts_with(".trellis/tasks/")
        || Path::new(&normalized_task_source_path)
            .file_name()
            .and_then(|name| name.to_str())
            != Some("task.json")
    {
        return Err(UnsafeProjectPathError::new("Task 源路径不符合 Trellis 目录合同").into());
    }
    let safe_task_json =
        resolve_safe_project_path(project_root, &normalized_task_source_path, ".trellis/tasks")?;
    if !safe_task_json.metadata.is_file() {
        return Err(UnsafeProjectPathError::new("Task 源路径不是普通文件").into());
    }
    let task_root = safe_task_json
        .real_path
        .parent()
        .ok_or_else(|| UnsafeProjectPathError::new("Task 根目录无效"))?;
    let mut documents = Vec::new();
    walk_task_documents(
        &safe_task_json.real_project_root,
        task_root,
        task_root,
        &mut documents,
    )?;
    sort_task_documents(&mut documents);
    Ok(TaskDetailResponse {
        project_id: snapshot.project_id.clone(),
        task,
        documents,
    })
}

/// 读取已列入 Task 文档清单的 Markdown 或 JSONL 正文。
pub fn read_project_task_document(
    project_root: &Path,
    snapshot: &ProjectSnapshot,
    task_source_path: &str,
    document_path: &str,
) -> Result<ProjectDocumentResponse, ProjectReadError> {
    let detail = read_project_task_detail(project_root, snapshot, task_source_path)?;
    let normalized_document_path = normalize_project_relative_path(document_path)?;
    let document = detail
        .documents
        .iter()
        .find(|document| document.relative_path == normalized_document_path)
        .ok_or(ProjectReadError::TaskDocumentNotFound)?;
    let normalized_task_source_path = normalize_project_relative_path(task_source_path)?;
    let task_root_path = Path::new(&normalized_task_source_path)
        .parent()
        .and_then(Path::to_str)
        .ok_or_else(|| UnsafeProjectPathError::new("Task 根目录无效"))?;
    let safe_document =
        resolve_safe_project_path(project_root, &document.source_path, task_root_path)?;
    if !safe_document.metadata.is_file() {
        return Err(UnsafeProjectPathError::new("Task 文档不是普通文件").into());
    }
    Ok(ProjectDocumentResponse {
        content: read_utf8_file(&safe_document.real_path)?,
        source_path: document.source_path.clone(),
        modified_at: modified_at(&safe_document.metadata),
        format: document.format,
    })
}

fn normalize_markdown_path(relative_path: &str) -> Result<String, UnsafeProjectPathError> {
    let normalized_path = normalize_project_relative_path(relative_path)?;
    if !normalized_path.starts_with(".trellis/") {
        return Err(UnsafeProjectPathError::new(
            "Markdown 路径必须位于项目 .trellis 目录内",
        ));
    }
    if !has_extension(Path::new(&normalized_path), "md") {
        return Err(UnsafeProjectPathError::new("只允许读取 Markdown 文件"));
    }
    Ok(normalized_path)
}

fn walk_task_documents(
    real_project_root: &Path,
    task_root: &Path,
    current_directory: &Path,
    documents: &mut Vec<TaskDocumentSummary>,
) -> Result<(), ProjectReadError> {
    let entries =
        fs::read_dir(current_directory).map_err(|_| ProjectReadError::TaskDirectoryUnreadable)?;
    for entry in entries {
        let entry = entry.map_err(|_| ProjectReadError::TaskDirectoryUnreadable)?;
        let file_type = entry
            .file_type()
            .map_err(|_| ProjectReadError::TaskDirectoryUnreadable)?;
        if file_type.is_symlink() {
            continue;
        }
        let entry_path = entry.path();
        if file_type.is_dir() {
            walk_task_documents(real_project_root, task_root, &entry_path, documents)?;
            continue;
        }
        if !file_type.is_file() {
            continue;
        }
        let Some(format) = document_format(&entry_path) else {
            continue;
        };
        let metadata =
            fs::metadata(&entry_path).map_err(|_| ProjectReadError::TaskDirectoryUnreadable)?;
        let relative_path = entry_path
            .strip_prefix(task_root)
            .map_err(|_| UnsafeProjectPathError::new("Task 文档路径超出任务目录"))?
            .to_string_lossy()
            .replace('\\', "/");
        let source_path = to_project_relative_path(real_project_root, &entry_path)?;
        documents.push(TaskDocumentSummary {
            name: entry.file_name().to_string_lossy().into_owned(),
            relative_path,
            source_path,
            format,
            modified_at: modified_at(&metadata),
        });
    }
    Ok(())
}

fn document_format(path: &Path) -> Option<ProjectDocumentFormat> {
    if has_extension(path, "md") {
        Some(ProjectDocumentFormat::Markdown)
    } else if has_extension(path, "jsonl") {
        Some(ProjectDocumentFormat::Jsonl)
    } else {
        None
    }
}

fn has_extension(path: &Path, expected: &str) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case(expected))
}

fn sort_task_documents(documents: &mut [TaskDocumentSummary]) {
    documents.sort_by(|left, right| {
        document_priority(&left.relative_path)
            .cmp(&document_priority(&right.relative_path))
            .then_with(|| left.relative_path.cmp(&right.relative_path))
    });
}

fn document_priority(relative_path: &str) -> u8 {
    match relative_path {
        "prd.md" => 0,
        "design.md" => 1,
        "implement.md" => 2,
        _ => 10,
    }
}

fn modified_at(metadata: &fs::Metadata) -> String {
    metadata
        .modified()
        .map(format_system_time)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

fn format_system_time(system_time: SystemTime) -> String {
    OffsetDateTime::from(system_time)
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}
