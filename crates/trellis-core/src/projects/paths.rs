use std::fs::{self, Metadata};
use std::path::{Component, Path, PathBuf};

use sha2::{Digest, Sha256};

/// 受保护项目路径的解析结果。
#[derive(Debug)]
pub struct SafeProjectPath {
    pub normalized_path: String,
    pub real_project_root: PathBuf,
    pub real_path: PathBuf,
    pub metadata: Metadata,
}

/// 受保护路径不满足项目读取边界。
#[derive(Debug, Clone, PartialEq, Eq, thiserror::Error)]
#[error("{message}")]
pub struct UnsafeProjectPathError {
    message: &'static str,
}

impl UnsafeProjectPathError {
    /// 创建稳定中文路径边界错误。
    #[must_use]
    pub fn new(message: &'static str) -> Self {
        Self { message }
    }
}

/// 根据项目真实路径生成 SHA-256 前 24 位稳定 ID。
pub fn create_stable_project_id(
    real_project_path: &Path,
) -> Result<String, UnsafeProjectPathError> {
    let raw_path = real_project_path
        .to_str()
        .ok_or_else(|| UnsafeProjectPathError::new("项目真实路径不是合法 UTF-8"))?;
    // Windows 上 `fs::canonicalize` 会给路径加上 `\\?\`（或 UNC 变体 `\\?\UNC\`）前缀以支持长路径。
    // 这会让同一项目在"是否经过 canonicalize"两种情况下产生不同 id，导致快照键与 projectId 不一致：
    // 历史数据（v1）的 id 基于未 canonicalize 的原始路径，而 refresh 时 validator 重新 canonicalize
    // 会得到带前缀的路径，二者 hash 不同。剥离 verbatim 前缀后，新旧路径形式统一，id 跨版本稳定。
    // macOS/Linux 的 canonicalize 不加前缀，剥离逻辑对其他平台是空操作。
    let normalized = strip_verbatim_prefix(raw_path);
    let digest = Sha256::digest(normalized.as_bytes());
    Ok(format!("{digest:x}")[..24].to_owned())
}

/// 剥离路径中的 Windows verbatim 前缀，返回与未 canonicalize 路径形式一致的 `PathBuf`。
///
/// 用于 validator canonicalize 后的出口规范化：保证下游（indexer、registry、快照、前端显示）
/// 拿到的路径字符串与用户原始输入一致，不携带 `\\?\` 或 `\\?\UNC\` 前缀。带前缀的路径仍可
/// 用于文件系统访问，但不能直接暴露给持久化或 UI。
pub fn strip_verbatim_prefix_path(path: &Path) -> PathBuf {
    path.to_str()
        .map(strip_verbatim_prefix)
        .map(PathBuf::from)
        .unwrap_or_else(|| path.to_path_buf())
}

/// 剥离 Windows 规范化路径的 verbatim 前缀，使 id 计算基于与未规范化路径一致的形式。
fn strip_verbatim_prefix(path: &str) -> String {
    const VERBATIM: &str = r"\\?\";
    const VERBATIM_UNC: &str = r"\\?\UNC\";
    if let Some(rest) = path.strip_prefix(VERBATIM_UNC) {
        // `\\?\UNC\server\share\path` -> `\\server\share\path`
        format!(r"\\{rest}")
    } else if let Some(rest) = path.strip_prefix(VERBATIM) {
        // `\\?\C:\path` -> `C:\path`
        rest.to_owned()
    } else {
        path.to_owned()
    }
}

/// 判断候选路径是否位于父目录内部或等于父目录。
#[must_use]
pub fn is_path_inside_or_equal(parent_path: &Path, candidate_path: &Path) -> bool {
    candidate_path.strip_prefix(parent_path).is_ok()
}

/// 将绝对路径转换为统一使用正斜杠的项目相对路径。
pub fn to_project_relative_path(
    project_root: &Path,
    absolute_path: &Path,
) -> Result<String, UnsafeProjectPathError> {
    let relative = absolute_path
        .strip_prefix(project_root)
        .map_err(|_| UnsafeProjectPathError::new("路径不在项目根目录内"))?;
    let value = relative
        .to_str()
        .ok_or_else(|| UnsafeProjectPathError::new("项目相对路径不是合法 UTF-8"))?;
    Ok(value.replace('\\', "/"))
}

/// 规范化项目相对路径，并在规范化前拒绝绝对路径和上级目录片段。
pub fn normalize_project_relative_path(
    relative_path: &str,
) -> Result<String, UnsafeProjectPathError> {
    let slash_path = relative_path.replace('\\', "/");
    if slash_path.starts_with('/') || is_windows_absolute_path(&slash_path) {
        return Err(UnsafeProjectPathError::new("项目路径必须是相对路径"));
    }
    if slash_path.split('/').any(|segment| segment == "..") {
        return Err(UnsafeProjectPathError::new("项目路径不能包含上级目录片段"));
    }

    let segments: Vec<&str> = slash_path
        .split('/')
        .filter(|segment| !segment.is_empty() && *segment != ".")
        .collect();
    if segments.is_empty() {
        return Err(UnsafeProjectPathError::new("项目相对路径无效"));
    }
    Ok(segments.join("/"))
}

/// 将项目相对路径解析到指定边界内，并拒绝任意路径段中的符号链接。
pub fn resolve_safe_project_path(
    project_root: &Path,
    relative_path: &str,
    boundary_path: &str,
) -> Result<SafeProjectPath, UnsafeProjectPathError> {
    let normalized_path = normalize_project_relative_path(relative_path)?;
    let normalized_boundary = normalize_project_relative_path(boundary_path)?;
    if normalized_path != normalized_boundary
        && !normalized_path.starts_with(&format!("{normalized_boundary}/"))
    {
        return Err(UnsafeProjectPathError::new("项目路径超出允许读取边界"));
    }

    let root_metadata = fs::symlink_metadata(project_root)
        .map_err(|_| UnsafeProjectPathError::new("项目根目录无法访问"))?;
    if root_metadata.file_type().is_symlink() || !root_metadata.is_dir() {
        return Err(UnsafeProjectPathError::new("项目根目录无效或为符号链接"));
    }
    let real_project_root = fs::canonicalize(project_root)
        .map_err(|_| UnsafeProjectPathError::new("项目根目录无法访问"))?;
    let boundary_absolute_path = join_normalized(&real_project_root, &normalized_boundary);
    let boundary_metadata = fs::symlink_metadata(&boundary_absolute_path)
        .map_err(|_| UnsafeProjectPathError::new("项目读取边界无法访问"))?;
    if boundary_metadata.file_type().is_symlink() || !boundary_metadata.is_dir() {
        return Err(UnsafeProjectPathError::new("项目读取边界无效或为符号链接"));
    }

    let candidate_absolute_path = join_normalized(&real_project_root, &normalized_path);
    if !is_path_inside_or_equal(&boundary_absolute_path, &candidate_absolute_path) {
        return Err(UnsafeProjectPathError::new("项目路径超出允许读取边界"));
    }

    let relative_to_boundary = candidate_absolute_path
        .strip_prefix(&boundary_absolute_path)
        .map_err(|_| UnsafeProjectPathError::new("项目路径超出允许读取边界"))?;
    let mut current_path = boundary_absolute_path.clone();
    for component in relative_to_boundary.components() {
        if !matches!(component, Component::Normal(_)) {
            return Err(UnsafeProjectPathError::new("项目相对路径无效"));
        }
        current_path.push(component.as_os_str());
        let metadata = fs::symlink_metadata(&current_path)
            .map_err(|_| UnsafeProjectPathError::new("项目路径无法访问"))?;
        if metadata.file_type().is_symlink() {
            return Err(UnsafeProjectPathError::new("项目路径不能包含符号链接"));
        }
    }

    let real_boundary_path = fs::canonicalize(&boundary_absolute_path)
        .map_err(|_| UnsafeProjectPathError::new("项目读取边界无法访问"))?;
    let real_candidate_path = fs::canonicalize(&candidate_absolute_path)
        .map_err(|_| UnsafeProjectPathError::new("项目路径无法访问"))?;
    if !is_path_inside_or_equal(&real_boundary_path, &real_candidate_path) {
        return Err(UnsafeProjectPathError::new("项目路径超出真实读取边界"));
    }
    let metadata = fs::symlink_metadata(&real_candidate_path)
        .map_err(|_| UnsafeProjectPathError::new("项目路径无法访问"))?;

    Ok(SafeProjectPath {
        normalized_path,
        // 剥离 verbatim 前缀，保证返回给调用方的路径形式与用户原始输入一致，
        // 不携带 Windows canonicalize 的 `\\?\` 前缀。文件读取不受影响。
        real_project_root: strip_verbatim_prefix_path(&real_project_root),
        real_path: strip_verbatim_prefix_path(&real_candidate_path),
        metadata,
    })
}

/// 以严格 UTF-8 方式读取文本，非法字节会返回稳定错误。
pub fn read_utf8_file(file_path: &Path) -> Result<String, UnsafeProjectPathError> {
    let bytes = fs::read(file_path).map_err(|_| UnsafeProjectPathError::new("项目文件无法读取"))?;
    String::from_utf8(bytes).map_err(|_| UnsafeProjectPathError::new("项目文件不是合法 UTF-8"))
}

fn is_windows_absolute_path(path: &str) -> bool {
    let bytes = path.as_bytes();
    path.starts_with("//")
        || (bytes.len() >= 3
            && bytes[0].is_ascii_alphabetic()
            && bytes[1] == b':'
            && bytes[2] == b'/')
}

fn join_normalized(root: &Path, normalized_path: &str) -> PathBuf {
    normalized_path
        .split('/')
        .fold(root.to_path_buf(), |path, segment| path.join(segment))
}

#[cfg(test)]
mod tests {
    use super::{create_stable_project_id, strip_verbatim_prefix};

    #[test]
    fn strip_verbatim_prefix_leaves_plain_paths_untouched() {
        assert_eq!(
            strip_verbatim_prefix(r"D:\develop\llm\project"),
            r"D:\develop\llm\project"
        );
        assert_eq!(
            strip_verbatim_prefix(r"\\server\share\path"),
            r"\\server\share\path"
        );
        assert_eq!(
            strip_verbatim_prefix("/Users/foo/project"),
            "/Users/foo/project"
        );
    }

    #[test]
    fn strip_verbatim_prefix_removes_drive_verbatim_prefix() {
        assert_eq!(
            strip_verbatim_prefix(r"\\?\D:\develop\llm\project"),
            r"D:\develop\llm\project"
        );
    }

    #[test]
    fn strip_verbatim_prefix_removes_unc_verbatim_prefix_and_restores_double_slash() {
        assert_eq!(
            strip_verbatim_prefix(r"\\?\UNC\server\share\path"),
            r"\\server\share\path"
        );
    }

    #[test]
    fn stable_project_id_is_identical_for_raw_and_canonicalized_forms() {
        // 同一项目的"原始路径"与"canonicalize 后路径"必须产生相同 id，
        // 否则快照键与 projectId 校验失败（Windows 上 canonicalize 会加 \\?\ 前缀）。
        let raw = r"D:\develop\llm\project";
        let verbatim = r"\\?\D:\develop\llm\project";
        let id_raw = create_stable_project_id(std::path::Path::new(raw)).unwrap();
        let id_verbatim = create_stable_project_id(std::path::Path::new(verbatim)).unwrap();
        assert_eq!(
            id_raw, id_verbatim,
            "id must be stable across canonicalize states"
        );
        assert_eq!(id_raw.len(), 24, "id is SHA-256 first 24 hex chars");
    }

    #[test]
    fn stable_project_id_is_identical_for_unc_raw_and_verbatim_forms() {
        let raw = r"\\server\share\path";
        let verbatim = r"\\?\UNC\server\share\path";
        let id_raw = create_stable_project_id(std::path::Path::new(raw)).unwrap();
        let id_verbatim = create_stable_project_id(std::path::Path::new(verbatim)).unwrap();
        assert_eq!(
            id_raw, id_verbatim,
            "UNC id must be stable across canonicalize states"
        );
    }
}
