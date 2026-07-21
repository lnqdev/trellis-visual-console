use std::collections::HashSet;
use std::fs;
use std::path::{Path, PathBuf};

use crate::storage::{SnapshotDiagnostic, SnapshotSeverity};

use super::validator::{
    ProjectValidator, ValidatedTrellisProject, diagnostic, file_system_diagnostic,
};

const IGNORED_DIRECTORY_NAMES: [&str; 12] = [
    ".cache",
    ".git",
    ".hg",
    ".next",
    ".svn",
    ".turbo",
    "build",
    "coverage",
    "dist",
    "node_modules",
    "out",
    "target",
];

/// 扫描得到的有效项目与稳定诊断。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectScanDiscovery {
    pub projects: Vec<ValidatedTrellisProject>,
    pub diagnostics: Vec<SnapshotDiagnostic>,
}

/// 递归发现有效 Trellis 项目，不跟随符号链接。
#[derive(Debug, Default)]
pub struct ProjectScanner {
    validator: ProjectValidator,
}

impl ProjectScanner {
    /// 创建使用默认项目结构校验器的扫描器。
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// 递归扫描用户指定目录，仅返回只读发现结果。
    pub fn scan(&self, scan_root: &Path) -> ProjectScanDiscovery {
        let mut result = ProjectScanDiscovery {
            projects: Vec::new(),
            diagnostics: Vec::new(),
        };
        let root_metadata = match fs::symlink_metadata(scan_root) {
            Ok(metadata) => metadata,
            Err(error) => {
                result.diagnostics.push(file_system_diagnostic(
                    "scan-root-unavailable",
                    &error,
                    scan_root,
                    "扫描根目录",
                    SnapshotSeverity::Error,
                ));
                return result;
            }
        };
        if root_metadata.file_type().is_symlink() || !root_metadata.is_dir() {
            let message = if root_metadata.file_type().is_symlink() {
                "扫描根目录不能是符号链接"
            } else {
                "扫描根路径不是目录"
            };
            result.diagnostics.push(diagnostic(
                SnapshotSeverity::Error,
                "scan-root-invalid",
                message,
                scan_root,
            ));
            return result;
        }
        let real_scan_root = match fs::canonicalize(scan_root) {
            Ok(path) => path,
            Err(error) => {
                result.diagnostics.push(file_system_diagnostic(
                    "scan-root-unavailable",
                    &error,
                    scan_root,
                    "扫描根目录",
                    SnapshotSeverity::Error,
                ));
                return result;
            }
        };

        let mut pending_directories = vec![real_scan_root];
        let mut discovered_paths = HashSet::<PathBuf>::new();
        while let Some(current_directory) = pending_directories.pop() {
            let entries = match fs::read_dir(&current_directory) {
                Ok(entries) => entries,
                Err(error) => {
                    result.diagnostics.push(file_system_diagnostic(
                        "scan-directory-unreadable",
                        &error,
                        &current_directory,
                        "扫描目录",
                        SnapshotSeverity::Warning,
                    ));
                    continue;
                }
            };
            for entry_result in entries {
                let entry = match entry_result {
                    Ok(entry) => entry,
                    Err(error) => {
                        result.diagnostics.push(file_system_diagnostic(
                            "scan-directory-unreadable",
                            &error,
                            &current_directory,
                            "扫描目录",
                            SnapshotSeverity::Warning,
                        ));
                        continue;
                    }
                };
                let entry_path = entry.path();
                let file_type = match entry.file_type() {
                    Ok(file_type) => file_type,
                    Err(error) => {
                        result.diagnostics.push(file_system_diagnostic(
                            "scan-directory-unreadable",
                            &error,
                            &entry_path,
                            "扫描目录",
                            SnapshotSeverity::Warning,
                        ));
                        continue;
                    }
                };
                if file_type.is_symlink() {
                    if entry.file_name() == ".trellis" {
                        result.diagnostics.push(diagnostic(
                            SnapshotSeverity::Warning,
                            "scan-trellis-symlink-skipped",
                            "跳过符号链接形式的 .trellis 目录",
                            &entry_path,
                        ));
                    }
                    continue;
                }
                if !file_type.is_dir() {
                    continue;
                }
                if entry.file_name() == ".trellis" {
                    let validation = self.validator.validate(&current_directory);
                    result.diagnostics.extend(validation.diagnostics);
                    if let Some(project) = validation.project
                        && discovered_paths.insert(project.project_root.clone())
                    {
                        result.projects.push(project);
                    }
                    continue;
                }
                if !is_ignored_directory(&entry.file_name()) {
                    pending_directories.push(entry_path);
                }
            }
        }
        result
            .projects
            .sort_by(|left, right| left.project_root.cmp(&right.project_root));
        result
    }
}

fn is_ignored_directory(name: &std::ffi::OsStr) -> bool {
    name.to_str()
        .is_some_and(|name| IGNORED_DIRECTORY_NAMES.contains(&name))
}
