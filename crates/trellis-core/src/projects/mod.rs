//! Trellis 项目的只读路径、校验与发现能力。

mod indexer;
mod paths;
mod reader;
mod scanner;
mod validator;

pub use indexer::TrellisIndexer;
pub use paths::{
    SafeProjectPath, UnsafeProjectPathError, create_stable_project_id, is_path_inside_or_equal,
    normalize_project_relative_path, read_utf8_file, resolve_safe_project_path,
    to_project_relative_path,
};
pub use reader::{
    ProjectReadError, read_project_markdown, read_project_task_detail, read_project_task_document,
};
pub use scanner::{ProjectScanDiscovery, ProjectScanner};
pub use validator::{ProjectValidationResult, ProjectValidator, ValidatedTrellisProject};
