use std::collections::{BTreeMap, HashMap, HashSet};
use std::fs;
use std::path::{Path, PathBuf};
use std::time::SystemTime;

use serde::Deserialize;
use serde_json::{Map, Value};
use time::{OffsetDateTime, format_description::well_known::Rfc3339};

use crate::storage::{
    ProjectOverviewSnapshot, ProjectPackageSnapshot, ProjectSnapshot, SnapshotDiagnostic,
    SnapshotSeverity, SpecTreeNode, SpecTreeNodeKind, TaskCollectionSnapshot, TaskSummarySnapshot,
    WorkflowSummarySnapshot,
};

use super::paths::{read_utf8_file, to_project_relative_path};
use super::validator::ValidatedTrellisProject;

#[derive(Debug, Deserialize)]
struct PackageConfig {
    path: String,
    #[serde(rename = "type")]
    package_type: Option<String>,
    git: Option<bool>,
}

#[derive(Debug, Default, Deserialize)]
struct TrellisConfig {
    #[serde(default)]
    packages: BTreeMap<String, PackageConfig>,
}

#[derive(Debug)]
struct ParsedTask {
    summary: TaskSummarySnapshot,
    directory_name: String,
    parent_name: Option<String>,
    child_names: Vec<String>,
}

#[derive(Debug)]
struct TaskRelationCandidate {
    parent_index: usize,
    child_index: usize,
    declared_by_parent: bool,
    declared_by_child: bool,
    parent_declaration_index: Option<usize>,
}

/// 将单个已校验 Trellis 项目解析为可持久化摘要快照。
#[derive(Debug, Default)]
pub struct TrellisIndexer;

impl TrellisIndexer {
    /// 创建 Trellis 内容索引器。
    #[must_use]
    pub fn new() -> Self {
        Self
    }

    /// 索引项目概览、Spec、Task 和 Workflow，单文件错误只产生诊断。
    #[must_use]
    pub fn index(&self, project: &ValidatedTrellisProject) -> ProjectSnapshot {
        let mut diagnostics = Vec::new();
        let packages = parse_project_packages(project, &mut diagnostics);
        let spec_tree = build_spec_tree(project, &mut diagnostics);
        let tasks = index_tasks(project, &mut diagnostics);
        let workflow = parse_workflow(project, &tasks.active, &mut diagnostics);
        ProjectSnapshot {
            project_id: project.id.clone(),
            indexed_at: format_system_time(SystemTime::now()),
            overview: ProjectOverviewSnapshot {
                label: project.label.clone(),
                path: project.project_root.to_string_lossy().into_owned(),
                packages,
            },
            spec_tree,
            tasks,
            workflow,
            diagnostics,
        }
    }
}

fn parse_project_packages(
    project: &ValidatedTrellisProject,
    diagnostics: &mut Vec<SnapshotDiagnostic>,
) -> Vec<ProjectPackageSnapshot> {
    let config_path = project.trellis_root.join("config.yaml");
    let source_path = source_path(project, &config_path);
    let config_text = match read_utf8_file(&config_path) {
        Ok(content) => content,
        Err(_) => {
            diagnostics.push(file_diagnostic("config-read-failed", source_path, None));
            return Vec::new();
        }
    };
    let yaml_value: serde_yaml::Value = match serde_yaml::from_str(&config_text) {
        Ok(value) => value,
        Err(_) => {
            diagnostics.push(file_diagnostic("config-yaml-invalid", source_path, None));
            return Vec::new();
        }
    };
    let config: TrellisConfig = match serde_yaml::from_value(yaml_value) {
        Ok(config) => config,
        Err(_) => {
            diagnostics.push(SnapshotDiagnostic {
                severity: SnapshotSeverity::Error,
                code: "config-structure-invalid".to_owned(),
                message: "packages: 字段格式不正确".to_owned(),
                source_path: Some(source_path),
            });
            return Vec::new();
        }
    };
    let mut packages = Vec::new();
    for (name, package) in config.packages {
        if name.is_empty()
            || package.path.is_empty()
            || package.package_type.as_deref().is_some_and(str::is_empty)
        {
            diagnostics.push(SnapshotDiagnostic {
                severity: SnapshotSeverity::Error,
                code: "config-structure-invalid".to_owned(),
                message: "packages: 字段格式不正确".to_owned(),
                source_path: Some(source_path.clone()),
            });
            return Vec::new();
        }
        packages.push(ProjectPackageSnapshot {
            name,
            path: package.path,
            package_type: package.package_type,
            git: package.git.unwrap_or(false),
        });
    }
    packages
}

fn build_spec_tree(
    project: &ValidatedTrellisProject,
    diagnostics: &mut Vec<SnapshotDiagnostic>,
) -> Vec<SpecTreeNode> {
    walk_spec_directory(project, &project.trellis_root.join("spec"), diagnostics)
}

fn walk_spec_directory(
    project: &ValidatedTrellisProject,
    directory_path: &Path,
    diagnostics: &mut Vec<SnapshotDiagnostic>,
) -> Vec<SpecTreeNode> {
    let entries = match fs::read_dir(directory_path) {
        Ok(entries) => entries,
        Err(_) => {
            diagnostics.push(file_diagnostic(
                "spec-directory-unreadable",
                source_path(project, directory_path),
                None,
            ));
            return Vec::new();
        }
    };
    let mut nodes = Vec::new();
    for entry_result in entries {
        let Ok(entry) = entry_result else {
            diagnostics.push(file_diagnostic(
                "spec-directory-unreadable",
                source_path(project, directory_path),
                None,
            ));
            continue;
        };
        let entry_path = entry.path();
        let entry_source_path = source_path(project, &entry_path);
        let Ok(file_type) = entry.file_type() else {
            diagnostics.push(file_diagnostic(
                "spec-directory-unreadable",
                entry_source_path,
                None,
            ));
            continue;
        };
        if file_type.is_symlink() {
            diagnostics.push(SnapshotDiagnostic {
                severity: SnapshotSeverity::Warning,
                code: "spec-symlink-skipped".to_owned(),
                message: "跳过 Spec 中的符号链接".to_owned(),
                source_path: Some(entry_source_path),
            });
            continue;
        }
        let name = entry.file_name().to_string_lossy().into_owned();
        if file_type.is_dir() {
            nodes.push(SpecTreeNode {
                name,
                relative_path: entry_source_path,
                kind: SpecTreeNodeKind::Directory,
                children: walk_spec_directory(project, &entry_path, diagnostics),
            });
        } else if file_type.is_file() && has_extension(&entry_path, "md") {
            nodes.push(SpecTreeNode {
                name,
                relative_path: entry_source_path,
                kind: SpecTreeNodeKind::File,
                children: Vec::new(),
            });
        }
    }
    nodes.sort_by(|left, right| {
        spec_kind_order(left.kind)
            .cmp(&spec_kind_order(right.kind))
            .then_with(|| left.name.cmp(&right.name))
    });
    nodes
}

fn index_tasks(
    project: &ValidatedTrellisProject,
    diagnostics: &mut Vec<SnapshotDiagnostic>,
) -> TaskCollectionSnapshot {
    let tasks_root = project.trellis_root.join("tasks");
    let entries = match fs::read_dir(&tasks_root) {
        Ok(entries) => entries,
        Err(_) => {
            diagnostics.push(file_diagnostic(
                "tasks-directory-unreadable",
                source_path(project, &tasks_root),
                None,
            ));
            return empty_tasks();
        }
    };
    let mut active = Vec::new();
    for entry_result in entries {
        let Ok(entry) = entry_result else {
            diagnostics.push(file_diagnostic(
                "tasks-directory-unreadable",
                source_path(project, &tasks_root),
                None,
            ));
            continue;
        };
        if entry.file_name() == "archive" {
            continue;
        }
        let Ok(file_type) = entry.file_type() else {
            continue;
        };
        if file_type.is_dir() && !file_type.is_symlink() {
            active.push(parse_task_directory(
                project,
                &entry.path(),
                false,
                diagnostics,
            ));
        }
    }
    let archived_directories =
        find_archived_task_directories(project, &tasks_root.join("archive"), diagnostics);
    let archived = archived_directories
        .iter()
        .map(|path| parse_task_directory(project, path, true, diagnostics))
        .collect();
    resolve_task_relationships(active, archived, diagnostics)
}

fn find_archived_task_directories(
    project: &ValidatedTrellisProject,
    archive_root: &Path,
    diagnostics: &mut Vec<SnapshotDiagnostic>,
) -> Vec<PathBuf> {
    if !is_regular_directory(archive_root) {
        return Vec::new();
    }
    let mut task_directories = Vec::new();
    let mut pending = vec![archive_root.to_path_buf()];
    while let Some(current) = pending.pop() {
        if is_regular_file(&current.join("task.json")) {
            task_directories.push(current);
            continue;
        }
        let entries = match fs::read_dir(&current) {
            Ok(entries) => entries,
            Err(_) => {
                diagnostics.push(file_diagnostic(
                    "archive-directory-unreadable",
                    source_path(project, &current),
                    Some(SnapshotSeverity::Warning),
                ));
                continue;
            }
        };
        for entry in entries.flatten() {
            if entry
                .file_type()
                .is_ok_and(|file_type| file_type.is_dir() && !file_type.is_symlink())
            {
                pending.push(entry.path());
            }
        }
    }
    task_directories.sort();
    task_directories
}

fn parse_task_directory(
    project: &ValidatedTrellisProject,
    task_root: &Path,
    archived: bool,
    diagnostics: &mut Vec<SnapshotDiagnostic>,
) -> ParsedTask {
    let task_json_path = task_root.join("task.json");
    let task_source_path = source_path(project, &task_json_path);
    let directory_name = task_root
        .file_name()
        .map(|name| name.to_string_lossy().into_owned())
        .unwrap_or_else(|| "unknown".to_owned());
    let task_record = read_task_record(&task_json_path, &task_source_path, diagnostics);
    let record_id = read_task_string(&task_record, "id", diagnostics, &task_source_path);
    let record_name = read_task_string(&task_record, "name", diagnostics, &task_source_path);
    let record_title = read_task_string(&task_record, "title", diagnostics, &task_source_path);
    let record_status = read_task_string(&task_record, "status", diagnostics, &task_source_path);
    let assignee = read_task_string(&task_record, "assignee", diagnostics, &task_source_path);
    let package_name = read_task_string(&task_record, "package", diagnostics, &task_source_path);
    let parent_name = read_task_string(&task_record, "parent", diagnostics, &task_source_path);
    let child_names =
        read_task_string_array(&task_record, "children", diagnostics, &task_source_path);

    if !archived {
        validate_active_task_prd(project, task_root, diagnostics);
    }
    validate_task_jsonl_files(project, task_root, diagnostics);
    let id = record_id
        .or(record_name.clone())
        .unwrap_or_else(|| directory_name.clone());
    let title = record_title.or(record_name).unwrap_or_else(|| id.clone());
    let status = record_status.unwrap_or_else(|| {
        if archived {
            "completed".to_owned()
        } else {
            "unknown".to_owned()
        }
    });
    ParsedTask {
        directory_name,
        parent_name,
        child_names,
        summary: TaskSummarySnapshot {
            id,
            title,
            phase: map_task_status_to_phase(&status),
            status,
            assignee,
            package_name,
            updated_at: read_task_modified_at(&task_json_path, task_root),
            source_path: task_source_path,
            parent_source_path: None,
            child_source_paths: Vec::new(),
        },
    }
}

fn read_task_record(
    task_json_path: &Path,
    source_path: &str,
    diagnostics: &mut Vec<SnapshotDiagnostic>,
) -> Map<String, Value> {
    let content = match read_utf8_file(task_json_path) {
        Ok(content) => content,
        Err(_) => {
            diagnostics.push(file_diagnostic(
                "task-json-read-failed",
                source_path.to_owned(),
                None,
            ));
            return Map::new();
        }
    };
    let value: Value = match serde_json::from_str(&content) {
        Ok(value) => value,
        Err(_) => {
            diagnostics.push(file_diagnostic(
                "task-json-invalid",
                source_path.to_owned(),
                None,
            ));
            return Map::new();
        }
    };
    match value {
        Value::Object(record) => record,
        _ => {
            diagnostics.push(SnapshotDiagnostic {
                severity: SnapshotSeverity::Error,
                code: "task-json-structure-invalid".to_owned(),
                message: "root: 字段格式不正确".to_owned(),
                source_path: Some(source_path.to_owned()),
            });
            Map::new()
        }
    }
}

fn read_task_string(
    task: &Map<String, Value>,
    field: &str,
    diagnostics: &mut Vec<SnapshotDiagnostic>,
    source_path: &str,
) -> Option<String> {
    match task.get(field) {
        None | Some(Value::Null) => None,
        Some(Value::String(value)) if value.is_empty() => None,
        Some(Value::String(value)) => Some(value.clone()),
        Some(_) => {
            diagnostics.push(SnapshotDiagnostic {
                severity: SnapshotSeverity::Warning,
                code: "task-field-invalid".to_owned(),
                message: format!("任务字段 {field} 不是字符串，已忽略"),
                source_path: Some(source_path.to_owned()),
            });
            None
        }
    }
}

fn read_task_string_array(
    task: &Map<String, Value>,
    field: &str,
    diagnostics: &mut Vec<SnapshotDiagnostic>,
    source_path: &str,
) -> Vec<String> {
    let Some(value) = task.get(field) else {
        return Vec::new();
    };
    if value.is_null() {
        return Vec::new();
    }
    let Some(items) = value.as_array() else {
        diagnostics.push(task_relation_diagnostic(
            "task-relation-field-invalid",
            source_path,
        ));
        return Vec::new();
    };
    let mut values = Vec::new();
    for item in items {
        if let Some(value) = item.as_str().filter(|value| !value.is_empty()) {
            values.push(value.to_owned());
        } else {
            diagnostics.push(task_relation_diagnostic(
                "task-relation-field-invalid",
                source_path,
            ));
        }
    }
    values
}

fn resolve_task_relationships(
    active: Vec<ParsedTask>,
    archived: Vec<ParsedTask>,
    diagnostics: &mut Vec<SnapshotDiagnostic>,
) -> TaskCollectionSnapshot {
    let active_count = active.len();
    let mut tasks: Vec<ParsedTask> = active.into_iter().chain(archived).collect();
    let mut directory_map = HashMap::<String, usize>::new();
    for (index, task) in tasks.iter().enumerate() {
        if directory_map.contains_key(&task.directory_name) {
            diagnostics.push(task_relation_diagnostic(
                "task-relation-name-duplicate",
                &task.summary.source_path,
            ));
        } else {
            directory_map.insert(task.directory_name.clone(), index);
        }
    }

    let mut candidates = BTreeMap::<(String, String), TaskRelationCandidate>::new();
    for (parent_index, parent) in tasks.iter().enumerate() {
        let mut seen = HashSet::new();
        for (child_order, child_name) in parent.child_names.iter().enumerate() {
            if !seen.insert(child_name) {
                diagnostics.push(task_relation_diagnostic(
                    "task-relation-child-duplicate",
                    &parent.summary.source_path,
                ));
                continue;
            }
            let Some(&child_index) = directory_map.get(child_name) else {
                diagnostics.push(task_relation_diagnostic(
                    "task-relation-child-missing",
                    &parent.summary.source_path,
                ));
                continue;
            };
            if parent_index == child_index {
                diagnostics.push(task_relation_diagnostic(
                    "task-relation-self-reference",
                    &parent.summary.source_path,
                ));
                continue;
            }
            let key = (
                parent.summary.source_path.clone(),
                tasks[child_index].summary.source_path.clone(),
            );
            let candidate = candidates.entry(key).or_insert(TaskRelationCandidate {
                parent_index,
                child_index,
                declared_by_parent: false,
                declared_by_child: false,
                parent_declaration_index: None,
            });
            candidate.declared_by_parent = true;
            candidate
                .parent_declaration_index
                .get_or_insert(child_order);
        }
    }
    for (child_index, child) in tasks.iter().enumerate() {
        let Some(parent_name) = &child.parent_name else {
            continue;
        };
        let Some(&parent_index) = directory_map.get(parent_name) else {
            diagnostics.push(task_relation_diagnostic(
                "task-relation-parent-missing",
                &child.summary.source_path,
            ));
            continue;
        };
        if parent_index == child_index {
            diagnostics.push(task_relation_diagnostic(
                "task-relation-self-reference",
                &child.summary.source_path,
            ));
            continue;
        }
        let key = (
            tasks[parent_index].summary.source_path.clone(),
            child.summary.source_path.clone(),
        );
        let candidate = candidates.entry(key).or_insert(TaskRelationCandidate {
            parent_index,
            child_index,
            declared_by_parent: false,
            declared_by_child: false,
            parent_declaration_index: None,
        });
        candidate.declared_by_child = true;
    }

    let mut candidates: Vec<TaskRelationCandidate> = candidates.into_values().collect();
    candidates.sort_by(|left, right| compare_relation_candidates(left, right, &tasks));
    let mut parent_by_child = HashMap::<String, String>::new();
    for candidate in candidates {
        let parent_path = tasks[candidate.parent_index].summary.source_path.clone();
        let child_path = tasks[candidate.child_index].summary.source_path.clone();
        if candidate.declared_by_parent != candidate.declared_by_child {
            diagnostics.push(task_relation_diagnostic(
                "task-relation-asymmetric",
                &child_path,
            ));
        }
        if parent_by_child
            .get(&child_path)
            .is_some_and(|existing| existing != &parent_path)
        {
            diagnostics.push(task_relation_diagnostic(
                "task-relation-parent-conflict",
                &child_path,
            ));
            continue;
        }
        if would_create_cycle(&parent_path, &child_path, &parent_by_child) {
            diagnostics.push(task_relation_diagnostic("task-relation-cycle", &child_path));
            continue;
        }
        parent_by_child.insert(child_path.clone(), parent_path.clone());
        tasks[candidate.child_index].summary.parent_source_path = Some(parent_path);
        tasks[candidate.parent_index]
            .summary
            .child_source_paths
            .push(child_path);
    }

    let source_to_name: HashMap<String, String> = tasks
        .iter()
        .map(|task| {
            (
                task.summary.source_path.clone(),
                task.directory_name.clone(),
            )
        })
        .collect();
    for task in &mut tasks {
        let order: HashMap<&str, usize> = task
            .child_names
            .iter()
            .enumerate()
            .map(|(index, name)| (name.as_str(), index))
            .collect();
        task.summary.child_source_paths.sort_by(|left, right| {
            let left_order = source_to_name
                .get(left)
                .and_then(|name| order.get(name.as_str()))
                .copied()
                .unwrap_or(usize::MAX);
            let right_order = source_to_name
                .get(right)
                .and_then(|name| order.get(name.as_str()))
                .copied()
                .unwrap_or(usize::MAX);
            left_order.cmp(&right_order).then_with(|| left.cmp(right))
        });
    }

    let mut archived_tasks = tasks.split_off(active_count);
    let mut active_tasks = tasks;
    sort_tasks(&mut active_tasks);
    sort_tasks(&mut archived_tasks);
    TaskCollectionSnapshot {
        active: active_tasks.into_iter().map(|task| task.summary).collect(),
        archived: archived_tasks
            .into_iter()
            .map(|task| task.summary)
            .collect(),
    }
}

fn compare_relation_candidates(
    left: &TaskRelationCandidate,
    right: &TaskRelationCandidate,
    tasks: &[ParsedTask],
) -> std::cmp::Ordering {
    relation_priority(left)
        .cmp(&relation_priority(right))
        .then_with(|| {
            let left_parent = &tasks[left.parent_index];
            let right_parent = &tasks[right.parent_index];
            if left_parent.directory_name == right_parent.directory_name {
                match (
                    left.parent_declaration_index,
                    right.parent_declaration_index,
                ) {
                    (Some(left_index), Some(right_index)) => left_index.cmp(&right_index),
                    _ => std::cmp::Ordering::Equal,
                }
            } else {
                left_parent
                    .directory_name
                    .cmp(&right_parent.directory_name)
                    .then_with(|| {
                        tasks[left.child_index]
                            .directory_name
                            .cmp(&tasks[right.child_index].directory_name)
                    })
            }
        })
}

fn relation_priority(candidate: &TaskRelationCandidate) -> u8 {
    match (candidate.declared_by_parent, candidate.declared_by_child) {
        (true, true) => 0,
        (true, false) => 1,
        (false, true) => 2,
        (false, false) => 3,
    }
}

fn would_create_cycle(
    parent_path: &str,
    child_path: &str,
    parent_by_child: &HashMap<String, String>,
) -> bool {
    let mut visited = HashSet::new();
    let mut current = Some(parent_path);
    while let Some(path) = current {
        if path == child_path {
            return true;
        }
        if !visited.insert(path) {
            return false;
        }
        current = parent_by_child.get(path).map(String::as_str);
    }
    false
}

fn task_relation_diagnostic(code: &str, source_path: &str) -> SnapshotDiagnostic {
    let message = match code {
        "task-relation-field-invalid" => "任务关系字段格式不正确，已忽略非法内容",
        "task-relation-name-duplicate" => "任务目录名称重复，部分父子关系无法解析",
        "task-relation-self-reference" => "任务不能将自身声明为子任务，已忽略该关系",
        "task-relation-parent-conflict" => "任务声明了多个父任务，已按关系一致性保留一条关系",
        "task-relation-cycle" => "任务父子关系形成循环，已忽略该关系",
        "task-relation-child-duplicate" => "父任务重复引用同一子任务，已忽略重复关系",
        "task-relation-child-missing" => "父任务引用的子任务不存在",
        "task-relation-parent-missing" => "任务引用的父任务不存在",
        "task-relation-asymmetric" => "任务父子关系双向声明不一致，已按可解析关系展示",
        _ => "任务父子关系无法解析",
    };
    SnapshotDiagnostic {
        severity: SnapshotSeverity::Warning,
        code: code.to_owned(),
        message: message.to_owned(),
        source_path: Some(source_path.to_owned()),
    }
}

fn validate_active_task_prd(
    project: &ValidatedTrellisProject,
    task_root: &Path,
    diagnostics: &mut Vec<SnapshotDiagnostic>,
) {
    let prd_path = task_root.join("prd.md");
    if !is_regular_file(&prd_path) {
        diagnostics.push(SnapshotDiagnostic {
            severity: SnapshotSeverity::Warning,
            code: "task-prd-missing".to_owned(),
            message: "活动任务缺少 prd.md".to_owned(),
            source_path: Some(source_path(project, &prd_path)),
        });
    }
}

fn validate_task_jsonl_files(
    project: &ValidatedTrellisProject,
    task_root: &Path,
    diagnostics: &mut Vec<SnapshotDiagnostic>,
) {
    let mut pending = vec![task_root.to_path_buf()];
    while let Some(current) = pending.pop() {
        let entries = match fs::read_dir(&current) {
            Ok(entries) => entries,
            Err(_) => {
                diagnostics.push(file_diagnostic(
                    "task-directory-unreadable",
                    source_path(project, &current),
                    Some(SnapshotSeverity::Warning),
                ));
                continue;
            }
        };
        for entry in entries.flatten() {
            let Ok(file_type) = entry.file_type() else {
                continue;
            };
            if file_type.is_symlink() {
                continue;
            }
            if file_type.is_dir() {
                pending.push(entry.path());
            } else if file_type.is_file() && has_extension(&entry.path(), "jsonl") {
                validate_jsonl_file(project, &entry.path(), diagnostics);
            }
        }
    }
}

fn validate_jsonl_file(
    project: &ValidatedTrellisProject,
    file_path: &Path,
    diagnostics: &mut Vec<SnapshotDiagnostic>,
) {
    let source_path = source_path(project, file_path);
    let content = match read_utf8_file(file_path) {
        Ok(content) => content,
        Err(_) => {
            diagnostics.push(file_diagnostic("task-jsonl-read-failed", source_path, None));
            return;
        }
    };
    for (index, line) in content.lines().enumerate() {
        if !line.trim().is_empty() && serde_json::from_str::<Value>(line).is_err() {
            diagnostics.push(SnapshotDiagnostic {
                severity: SnapshotSeverity::Error,
                code: "task-jsonl-invalid".to_owned(),
                message: format!("第 {} 行不是合法 JSON", index + 1),
                source_path: Some(source_path.clone()),
            });
        }
    }
}

fn parse_workflow(
    project: &ValidatedTrellisProject,
    active_tasks: &[TaskSummarySnapshot],
    diagnostics: &mut Vec<SnapshotDiagnostic>,
) -> WorkflowSummarySnapshot {
    let workflow_path = project.trellis_root.join("workflow.md");
    let source_path = source_path(project, &workflow_path);
    let current_phase = infer_current_phase(active_tasks);
    if !is_regular_file(&workflow_path) {
        diagnostics.push(file_diagnostic(
            "workflow-read-failed",
            source_path.clone(),
            Some(SnapshotSeverity::Warning),
        ));
        return WorkflowSummarySnapshot {
            name: None,
            current_phase,
            summary: None,
            source_path: Some(source_path),
        };
    }
    let content = match read_utf8_file(&workflow_path) {
        Ok(content) => content,
        Err(_) => {
            diagnostics.push(file_diagnostic(
                "workflow-read-failed",
                source_path.clone(),
                Some(SnapshotSeverity::Warning),
            ));
            return WorkflowSummarySnapshot {
                name: None,
                current_phase,
                summary: None,
                source_path: Some(source_path),
            };
        }
    };
    let mut name = None;
    let mut phases = HashMap::<String, String>::new();
    for line in content.lines() {
        if name.is_none()
            && let Some(value) = line.strip_prefix("# ").map(str::trim)
            && !value.is_empty()
        {
            name = Some(value.to_owned());
        }
        if let Some(rest) = line.strip_prefix("### Phase ")
            && let Some((number, title)) = rest.split_once(':')
            && let Some(key) = phase_number_to_key(number.trim())
            && !title.trim().is_empty()
        {
            phases
                .entry(key.to_owned())
                .or_insert_with(|| format!("Phase {}: {}", number.trim(), title.trim()));
        }
    }
    let summary = current_phase
        .as_ref()
        .and_then(|phase| phases.get(phase))
        .cloned();
    WorkflowSummarySnapshot {
        name,
        current_phase,
        summary,
        source_path: Some(source_path),
    }
}

fn infer_current_phase(active_tasks: &[TaskSummarySnapshot]) -> Option<String> {
    if active_tasks.iter().any(|task| task.status == "in_progress") {
        Some("execute".to_owned())
    } else if active_tasks.iter().any(|task| task.status == "planning") {
        Some("plan".to_owned())
    } else {
        None
    }
}

fn phase_number_to_key(number: &str) -> Option<&'static str> {
    match number {
        "1" => Some("plan"),
        "2" => Some("execute"),
        "3" => Some("finish"),
        _ => None,
    }
}

fn map_task_status_to_phase(status: &str) -> Option<String> {
    match status {
        "planning" => Some("plan".to_owned()),
        "in_progress" => Some("execute".to_owned()),
        "completed" => Some("completed".to_owned()),
        _ => None,
    }
}

fn read_task_modified_at(task_json_path: &Path, task_root: &Path) -> Option<String> {
    fs::metadata(task_json_path)
        .or_else(|_| fs::metadata(task_root))
        .ok()
        .and_then(|metadata| metadata.modified().ok())
        .map(format_system_time)
}

fn format_system_time(system_time: SystemTime) -> String {
    OffsetDateTime::from(system_time)
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}

fn is_regular_file(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .is_ok_and(|metadata| metadata.is_file() && !metadata.file_type().is_symlink())
}

fn is_regular_directory(path: &Path) -> bool {
    fs::symlink_metadata(path)
        .is_ok_and(|metadata| metadata.is_dir() && !metadata.file_type().is_symlink())
}

fn has_extension(path: &Path, expected: &str) -> bool {
    path.extension()
        .and_then(|extension| extension.to_str())
        .is_some_and(|extension| extension.eq_ignore_ascii_case(expected))
}

fn spec_kind_order(kind: SpecTreeNodeKind) -> u8 {
    match kind {
        SpecTreeNodeKind::Directory => 0,
        SpecTreeNodeKind::File => 1,
    }
}

fn sort_tasks(tasks: &mut [ParsedTask]) {
    tasks.sort_by(|left, right| {
        right
            .summary
            .updated_at
            .cmp(&left.summary.updated_at)
            .then_with(|| left.summary.source_path.cmp(&right.summary.source_path))
    });
}

fn empty_tasks() -> TaskCollectionSnapshot {
    TaskCollectionSnapshot {
        active: Vec::new(),
        archived: Vec::new(),
    }
}

fn source_path(project: &ValidatedTrellisProject, path: &Path) -> String {
    to_project_relative_path(&project.project_root, path).unwrap_or_else(|_| {
        path.strip_prefix(&project.project_root)
            .unwrap_or(path)
            .to_string_lossy()
            .replace('\\', "/")
    })
}

fn file_diagnostic(
    code: &str,
    source_path: String,
    severity: Option<SnapshotSeverity>,
) -> SnapshotDiagnostic {
    let message = match code {
        "config-read-failed" => "config.yaml 读取失败",
        "config-yaml-invalid" => "config.yaml 不是合法 YAML",
        "spec-directory-unreadable" => "Spec 目录无法读取",
        "tasks-directory-unreadable" => "Task 目录无法读取",
        "archive-directory-unreadable" => "归档 Task 目录无法读取",
        "task-json-read-failed" => "task.json 读取失败",
        "task-json-invalid" => "task.json 不是合法 JSON",
        "task-directory-unreadable" => "Task 子目录无法读取",
        "task-jsonl-read-failed" => "Task JSONL 文件读取失败",
        "workflow-read-failed" => "workflow.md 读取失败",
        _ => "文件解析失败",
    };
    SnapshotDiagnostic {
        severity: severity.unwrap_or(SnapshotSeverity::Error),
        code: code.to_owned(),
        message: message.to_owned(),
        source_path: Some(source_path),
    }
}
