use std::fs;
use std::io;
use std::path::{Path, PathBuf};

use crate::storage::{SnapshotDiagnostic, SnapshotSeverity};

use super::paths::{create_stable_project_id, strip_verbatim_prefix_path};

struct RequiredTrellisEntry {
    name: &'static str,
    kind: RequiredEntryKind,
}

enum RequiredEntryKind {
    File,
    Directory,
}

const REQUIRED_TRELLIS_ENTRIES: [RequiredTrellisEntry; 3] = [
    RequiredTrellisEntry {
        name: "config.yaml",
        kind: RequiredEntryKind::File,
    },
    RequiredTrellisEntry {
        name: "spec",
        kind: RequiredEntryKind::Directory,
    },
    RequiredTrellisEntry {
        name: "tasks",
        kind: RequiredEntryKind::Directory,
    },
];

/// 已通过结构校验的 Trellis 项目。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ValidatedTrellisProject {
    pub id: String,
    pub project_root: PathBuf,
    pub trellis_root: PathBuf,
    pub label: String,
}

/// 单项目结构校验结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectValidationResult {
    pub valid: bool,
    pub project: Option<ValidatedTrellisProject>,
    pub diagnostics: Vec<SnapshotDiagnostic>,
}

/// 校验项目根目录是否包含可读取的 Trellis 基础结构。
#[derive(Debug, Default)]
pub struct ProjectValidator;

impl ProjectValidator {
    /// 创建项目结构校验器。
    #[must_use]
    pub fn new() -> Self {
        Self
    }

    /// 校验单个项目目录，不跟随根目录或必需入口符号链接。
    pub fn validate(&self, project_path: &Path) -> ProjectValidationResult {
        let mut diagnostics = Vec::new();
        let input_metadata = match fs::symlink_metadata(project_path) {
            Ok(metadata) => metadata,
            Err(error) => {
                diagnostics.push(file_system_diagnostic(
                    "project-path-unavailable",
                    &error,
                    project_path,
                    "项目路径",
                    SnapshotSeverity::Error,
                ));
                return invalid_result(diagnostics);
            }
        };
        if input_metadata.file_type().is_symlink() {
            diagnostics.push(diagnostic(
                SnapshotSeverity::Error,
                "project-symlink-rejected",
                "项目根目录不能是符号链接",
                project_path,
            ));
            return invalid_result(diagnostics);
        }
        if !input_metadata.is_dir() {
            diagnostics.push(diagnostic(
                SnapshotSeverity::Error,
                "project-not-directory",
                "项目路径不是目录",
                project_path,
            ));
            return invalid_result(diagnostics);
        }

        let project_root = match fs::canonicalize(project_path) {
            Ok(path) => path,
            Err(error) => {
                diagnostics.push(file_system_diagnostic(
                    "project-path-unavailable",
                    &error,
                    project_path,
                    "项目路径",
                    SnapshotSeverity::Error,
                ));
                return invalid_result(diagnostics);
            }
        };
        let trellis_root = project_root.join(".trellis");
        let trellis_valid = validate_entry(
            &trellis_root,
            &RequiredTrellisEntry {
                name: ".trellis",
                kind: RequiredEntryKind::Directory,
            },
            &mut diagnostics,
        );
        if trellis_valid {
            for entry in &REQUIRED_TRELLIS_ENTRIES {
                validate_entry(&trellis_root.join(entry.name), entry, &mut diagnostics);
            }
        }

        if diagnostics
            .iter()
            .any(|diagnostic| diagnostic.severity == SnapshotSeverity::Error)
        {
            return invalid_result(diagnostics);
        }
        let Some(label) = project_root
            .file_name()
            .and_then(|name| name.to_str())
            .map(str::to_owned)
        else {
            diagnostics.push(diagnostic(
                SnapshotSeverity::Error,
                "project-path-invalid-utf8",
                "项目路径不是合法 UTF-8",
                &project_root,
            ));
            return invalid_result(diagnostics);
        };
        let id = match create_stable_project_id(&project_root) {
            Ok(id) => id,
            Err(_) => {
                diagnostics.push(diagnostic(
                    SnapshotSeverity::Error,
                    "project-path-invalid-utf8",
                    "项目路径不是合法 UTF-8",
                    &project_root,
                ));
                return invalid_result(diagnostics);
            }
        };

        ProjectValidationResult {
            valid: true,
            project: Some(ValidatedTrellisProject {
                id,
                // canonicalize 在 Windows 上会加 `\\?\` 前缀，剥离后保证传给下游（indexer、registry、
                // 快照、前端显示）的路径与用户原始输入形式一致。剥离对 macOS/Linux 是空操作。
                project_root: strip_verbatim_prefix_path(&project_root),
                trellis_root: strip_verbatim_prefix_path(&trellis_root),
                label,
            }),
            diagnostics,
        }
    }
}

fn validate_entry(
    entry_path: &Path,
    entry: &RequiredTrellisEntry,
    diagnostics: &mut Vec<SnapshotDiagnostic>,
) -> bool {
    let metadata = match fs::symlink_metadata(entry_path) {
        Ok(metadata) => metadata,
        Err(error) => {
            diagnostics.push(file_system_diagnostic(
                "trellis-entry-unavailable",
                &error,
                entry_path,
                "Trellis 必需文件或目录",
                SnapshotSeverity::Error,
            ));
            return false;
        }
    };
    if metadata.file_type().is_symlink() {
        diagnostics.push(diagnostic(
            SnapshotSeverity::Error,
            "trellis-symlink-rejected",
            &format!("{} 不能是符号链接", entry.name),
            entry_path,
        ));
        return false;
    }
    let kind_matches = match entry.kind {
        RequiredEntryKind::File => metadata.is_file(),
        RequiredEntryKind::Directory => metadata.is_dir(),
    };
    if !kind_matches {
        let expected = match entry.kind {
            RequiredEntryKind::File => "文件",
            RequiredEntryKind::Directory => "目录",
        };
        diagnostics.push(diagnostic(
            SnapshotSeverity::Error,
            "trellis-entry-type-invalid",
            &format!("{} 类型不正确，期望为{expected}", entry.name),
            entry_path,
        ));
        return false;
    }
    true
}

pub(super) fn file_system_diagnostic(
    code: &str,
    error: &io::Error,
    source_path: &Path,
    target_label: &str,
    severity: SnapshotSeverity,
) -> SnapshotDiagnostic {
    let message = match error.kind() {
        io::ErrorKind::NotFound => format!("{target_label}不存在"),
        io::ErrorKind::PermissionDenied => format!("没有权限访问{target_label}"),
        _ => format!("{target_label}无法访问"),
    };
    diagnostic(severity, code, &message, source_path)
}

pub(super) fn diagnostic(
    severity: SnapshotSeverity,
    code: &str,
    message: &str,
    source_path: &Path,
) -> SnapshotDiagnostic {
    SnapshotDiagnostic {
        severity,
        code: code.to_owned(),
        message: message.to_owned(),
        source_path: Some(source_path.to_string_lossy().into_owned()),
    }
}

fn invalid_result(diagnostics: Vec<SnapshotDiagnostic>) -> ProjectValidationResult {
    ProjectValidationResult {
        valid: false,
        project: None,
        diagnostics,
    }
}
