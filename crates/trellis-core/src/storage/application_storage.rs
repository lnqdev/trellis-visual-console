use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::Value;
use uuid::Uuid;

#[cfg(unix)]
use std::fs::File;

use super::{
    JsonFileStore, ProjectRegistryFile, ProjectSnapshotsFile, STORAGE_VERSION, StorageError,
    StorageRecovery, VersionedStorageData,
};

const LEGACY_STORAGE_VERSION: u32 = 1;

/// 应用持久化目录与固定数据文件路径。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApplicationPaths {
    pub data_directory: PathBuf,
    pub registry_file: PathBuf,
    pub snapshots_file: PathBuf,
}

impl ApplicationPaths {
    /// 使用桌面适配层提供的应用数据目录创建固定路径集合。
    #[must_use]
    pub fn new(data_directory: PathBuf) -> Self {
        Self {
            registry_file: data_directory.join("registry.json"),
            snapshots_file: data_directory.join("snapshots.json"),
            data_directory,
        }
    }
}

/// 版本 1 数据迁移留下的备份和重建信息。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StorageMigration {
    pub registry_backup: PathBuf,
    pub snapshots_backup: Option<PathBuf>,
    pub rebuild_project_ids: Vec<String>,
}

/// 应用存储初始化后的完整状态。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ApplicationStorageInitialization {
    pub registry: ProjectRegistryFile,
    pub snapshots: ProjectSnapshotsFile,
    pub recoveries: Vec<StorageRecovery>,
    pub migration: Option<StorageMigration>,
}

/// 管理注册表、摘要快照和一次性版本迁移。
pub struct ApplicationStorage {
    paths: ApplicationPaths,
    registry: JsonFileStore<ProjectRegistryFile>,
    snapshots: JsonFileStore<ProjectSnapshotsFile>,
    operation_lock: Mutex<()>,
}

impl ApplicationStorage {
    /// 使用桌面适配层解析出的应用数据目录创建存储入口。
    #[must_use]
    pub fn new(data_directory: PathBuf) -> Self {
        let paths = ApplicationPaths::new(data_directory);
        Self {
            registry: JsonFileStore::new(
                paths.registry_file.clone(),
                STORAGE_VERSION,
                ProjectRegistryFile::empty,
            ),
            snapshots: JsonFileStore::new(
                paths.snapshots_file.clone(),
                STORAGE_VERSION,
                ProjectSnapshotsFile::empty,
            ),
            paths,
            operation_lock: Mutex::new(()),
        }
    }

    /// 返回应用数据目录和固定文件路径。
    #[must_use]
    pub fn paths(&self) -> &ApplicationPaths {
        &self.paths
    }

    /// 返回项目注册表存储。
    #[must_use]
    pub fn registry(&self) -> &JsonFileStore<ProjectRegistryFile> {
        &self.registry
    }

    /// 返回项目摘要快照存储。
    #[must_use]
    pub fn snapshots(&self) -> &JsonFileStore<ProjectSnapshotsFile> {
        &self.snapshots
    }

    /// 初始化当前版本文件，或将合法版本 1 数据幂等迁移为版本 2。
    pub fn initialize(&self) -> Result<ApplicationStorageInitialization, StorageError> {
        let _guard = self.lock_operations()?;
        match read_existing_version(&self.paths.registry_file)? {
            None => self.initialize_empty(),
            Some(LEGACY_STORAGE_VERSION) => self.migrate_legacy(),
            Some(STORAGE_VERSION) => self.load_current(),
            Some(actual_version) => Err(StorageError::UnsupportedVersion {
                file_path: self.paths.registry_file.clone(),
                actual_version,
                expected_version: STORAGE_VERSION,
            }),
        }
    }

    fn initialize_empty(&self) -> Result<ApplicationStorageInitialization, StorageError> {
        if self.paths.snapshots_file.exists() {
            return Err(StorageError::InvalidStructure {
                file_path: self.paths.registry_file.clone(),
                details: vec![
                    "registry.json 缺失但 snapshots.json 已存在，已停止初始化".to_owned(),
                ],
            });
        }
        self.load_current()
    }

    fn load_current(&self) -> Result<ApplicationStorageInitialization, StorageError> {
        let registry = self.registry.load()?;
        let snapshots = self.snapshots.load()?;
        let recoveries = [registry.recovery, snapshots.recovery]
            .into_iter()
            .flatten()
            .collect();
        Ok(ApplicationStorageInitialization {
            registry: registry.data,
            snapshots: snapshots.data,
            recoveries,
            migration: None,
        })
    }

    fn migrate_legacy(&self) -> Result<ApplicationStorageInitialization, StorageError> {
        let registry_bytes = read_required_bytes(&self.paths.registry_file)?;
        let legacy_registry = parse_legacy_registry(&self.paths.registry_file, &registry_bytes)?;
        let snapshots_bytes = read_optional_bytes(&self.paths.snapshots_file)?;

        // 所有源文件先完成字节级备份，任何备份失败都不会修改原数据文件。
        let registry_backup = write_backup(&self.paths.registry_file, &registry_bytes)?;
        let snapshots_backup = snapshots_bytes
            .as_deref()
            .map(|bytes| write_backup(&self.paths.snapshots_file, bytes))
            .transpose()?;

        let registry = ProjectRegistryFile {
            version: STORAGE_VERSION,
            projects: legacy_registry.projects,
        };
        let snapshots = ProjectSnapshotsFile::empty();

        // 空快照先落盘，注册表版本 2 最后写入并作为迁移提交标记。
        self.snapshots.save(&snapshots)?;
        self.registry.save(&registry)?;

        let rebuild_project_ids = registry
            .projects
            .iter()
            .map(|project| project.id.clone())
            .collect();
        Ok(ApplicationStorageInitialization {
            registry,
            snapshots,
            recoveries: Vec::new(),
            migration: Some(StorageMigration {
                registry_backup,
                snapshots_backup,
                rebuild_project_ids,
            }),
        })
    }

    fn lock_operations(&self) -> Result<MutexGuard<'_, ()>, StorageError> {
        self.operation_lock
            .lock()
            .map_err(|_| StorageError::QueueUnavailable)
    }
}

fn parse_legacy_registry(
    file_path: &Path,
    bytes: &[u8],
) -> Result<ProjectRegistryFile, StorageError> {
    let registry: ProjectRegistryFile =
        serde_json::from_slice(bytes).map_err(|_| StorageError::InvalidStructure {
            file_path: file_path.to_path_buf(),
            details: vec!["版本 1 registry.json 的 JSON 字段结构不合法".to_owned()],
        })?;
    registry
        .validate(LEGACY_STORAGE_VERSION)
        .map_err(|error| StorageError::InvalidStructure {
            file_path: file_path.to_path_buf(),
            details: error.details().to_vec(),
        })?;
    Ok(registry)
}

fn read_existing_version(file_path: &Path) -> Result<Option<u32>, StorageError> {
    let bytes = match fs::read(file_path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(source) => return Err(io_error("读取", file_path, source)),
    };
    let value: Value =
        serde_json::from_slice(&bytes).map_err(|_| StorageError::InvalidStructure {
            file_path: file_path.to_path_buf(),
            details: vec!["registry.json 无法确认存储版本，已保留原文件".to_owned()],
        })?;
    let version = value
        .get("version")
        .and_then(Value::as_u64)
        .and_then(|version| version.try_into().ok())
        .ok_or_else(|| StorageError::InvalidStructure {
            file_path: file_path.to_path_buf(),
            details: vec!["registry.json 缺少合法数值版本，已保留原文件".to_owned()],
        })?;
    Ok(Some(version))
}

fn read_required_bytes(file_path: &Path) -> Result<Vec<u8>, StorageError> {
    fs::read(file_path).map_err(|source| io_error("读取", file_path, source))
}

fn read_optional_bytes(file_path: &Path) -> Result<Option<Vec<u8>>, StorageError> {
    match fs::read(file_path) {
        Ok(bytes) => Ok(Some(bytes)),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(None),
        Err(source) => Err(io_error("读取", file_path, source)),
    }
}

fn write_backup(source_path: &Path, bytes: &[u8]) -> Result<PathBuf, StorageError> {
    let backup_path = create_migration_backup_path(source_path);
    let mut options = OpenOptions::new();
    options.write(true).create_new(true);
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    let mut file = options
        .open(&backup_path)
        .map_err(|source| io_error("创建迁移备份", &backup_path, source))?;
    file.write_all(bytes)
        .map_err(|source| io_error("写入迁移备份", &backup_path, source))?;
    file.sync_all()
        .map_err(|source| io_error("同步迁移备份", &backup_path, source))?;
    sync_parent_directory(source_path)?;
    Ok(backup_path)
}

fn create_migration_backup_path(source_path: &Path) -> PathBuf {
    let extension = source_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let stem = source_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("data");
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis());
    let suffix = Uuid::new_v4();
    let file_name = if extension.is_empty() {
        format!("{stem}.v1-backup-{timestamp}-{suffix}")
    } else {
        format!("{stem}.v1-backup-{timestamp}-{suffix}.{extension}")
    };
    source_path.with_file_name(file_name)
}

#[cfg(unix)]
fn sync_parent_directory(file_path: &Path) -> Result<(), StorageError> {
    let parent = file_path
        .parent()
        .ok_or_else(|| StorageError::InvalidStructure {
            file_path: file_path.to_path_buf(),
            details: vec!["数据文件必须位于有效目录".to_owned()],
        })?;
    File::open(parent)
        .and_then(|directory| directory.sync_all())
        .map_err(|source| io_error("同步数据目录", parent, source))
}

#[cfg(not(unix))]
fn sync_parent_directory(_file_path: &Path) -> Result<(), StorageError> {
    Ok(())
}

fn io_error(operation: &'static str, file_path: &Path, source: io::Error) -> StorageError {
    StorageError::Io {
        operation,
        file_path: file_path.to_path_buf(),
        source,
    }
}
