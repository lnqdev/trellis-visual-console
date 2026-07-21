use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use atomic_write_file::AtomicWriteFile;
use serde::{Serialize, de::DeserializeOwned};
use serde_json::Value;
use uuid::Uuid;

use super::models::{StorageValidationError, VersionedStorageData};

/// 损坏文件的恢复原因。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum StorageRecoveryReason {
    InvalidJson,
    InvalidStructure,
}

/// 损坏文件隔离后留下的审计信息。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StorageRecovery {
    pub file_path: PathBuf,
    pub backup_path: PathBuf,
    pub reason: StorageRecoveryReason,
    pub details: Vec<String>,
}

/// 单次读取的结果和可能发生的恢复记录。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct StorageLoadResult<T> {
    pub data: T,
    pub created: bool,
    pub recovery: Option<StorageRecovery>,
}

/// 应用存储读写错误。
#[derive(Debug, thiserror::Error)]
pub enum StorageError {
    #[error("数据文件版本不兼容：当前为 {actual_version}，期望为 {expected_version}")]
    UnsupportedVersion {
        file_path: PathBuf,
        actual_version: u32,
        expected_version: u32,
    },
    #[error("存储数据结构不合法")]
    InvalidStructure {
        file_path: PathBuf,
        details: Vec<String>,
    },
    #[error("应用数据文件操作失败")]
    Io {
        operation: &'static str,
        file_path: PathBuf,
        #[source]
        source: io::Error,
    },
    #[error("应用数据写入队列不可用")]
    QueueUnavailable,
}

/// 提供版本校验、损坏隔离和原子写入的 JSON 文件存储。
pub struct JsonFileStore<T> {
    file_path: PathBuf,
    current_version: u32,
    create_default: fn() -> T,
    write_lock: Mutex<()>,
}

impl<T> JsonFileStore<T>
where
    T: Clone + Serialize + DeserializeOwned + VersionedStorageData,
{
    /// 创建版本化 JSON 文件存储。
    #[must_use]
    pub fn new(file_path: PathBuf, current_version: u32, create_default: fn() -> T) -> Self {
        Self {
            file_path,
            current_version,
            create_default,
            write_lock: Mutex::new(()),
        }
    }

    /// 返回当前存储管理的固定文件路径。
    #[must_use]
    pub fn file_path(&self) -> &Path {
        &self.file_path
    }

    /// 加载并校验数据文件，缺失或损坏时按合同恢复。
    pub fn load(&self) -> Result<StorageLoadResult<T>, StorageError> {
        let _guard = self.lock_writes()?;
        let bytes = match fs::read(&self.file_path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                let data = (self.create_default)();
                self.validate_for_save(&data)?;
                self.write_atomically(&data)?;
                return Ok(StorageLoadResult {
                    data,
                    created: true,
                    recovery: None,
                });
            }
            Err(source) => return Err(self.io_error("读取", source)),
        };

        let content = match String::from_utf8(bytes) {
            Ok(content) => content,
            Err(_) => {
                return self.recover(
                    StorageRecoveryReason::InvalidStructure,
                    vec!["root: 数据文件必须使用 UTF-8 编码".to_owned()],
                );
            }
        };
        let value: Value = match serde_json::from_str(&content) {
            Ok(value) => value,
            Err(_) => {
                return self.recover(
                    StorageRecoveryReason::InvalidJson,
                    vec!["root: JSON 内容不合法".to_owned()],
                );
            }
        };

        if let Some(actual_version) = read_numeric_version(&value)
            && actual_version != self.current_version
        {
            return Err(StorageError::UnsupportedVersion {
                file_path: self.file_path.clone(),
                actual_version,
                expected_version: self.current_version,
            });
        }

        let data: T = match serde_json::from_value(value) {
            Ok(data) => data,
            Err(_) => {
                return self.recover(
                    StorageRecoveryReason::InvalidStructure,
                    vec!["root: JSON 字段结构不合法".to_owned()],
                );
            }
        };
        if let Err(error) = data.validate(self.current_version) {
            return self.recover(
                StorageRecoveryReason::InvalidStructure,
                error.details().to_vec(),
            );
        }

        Ok(StorageLoadResult {
            data,
            created: false,
            recovery: None,
        })
    }

    /// 校验并按调用顺序保存完整数据文件。
    pub fn save(&self, data: &T) -> Result<(), StorageError> {
        self.validate_for_save(data)?;
        let _guard = self.lock_writes()?;
        self.write_atomically(data)
    }

    fn recover(
        &self,
        reason: StorageRecoveryReason,
        details: Vec<String>,
    ) -> Result<StorageLoadResult<T>, StorageError> {
        let backup_path = create_corrupt_backup_path(&self.file_path);
        fs::rename(&self.file_path, &backup_path)
            .map_err(|source| self.io_error("隔离", source))?;
        let data = (self.create_default)();
        self.validate_for_save(&data)?;
        self.write_atomically(&data)?;

        Ok(StorageLoadResult {
            data,
            created: false,
            recovery: Some(StorageRecovery {
                file_path: self.file_path.clone(),
                backup_path,
                reason,
                details,
            }),
        })
    }

    fn validate_for_save(&self, data: &T) -> Result<(), StorageError> {
        if data.version() != self.current_version {
            return Err(StorageError::UnsupportedVersion {
                file_path: self.file_path.clone(),
                actual_version: data.version(),
                expected_version: self.current_version,
            });
        }
        data.validate(self.current_version)
            .map_err(
                |error: StorageValidationError| StorageError::InvalidStructure {
                    file_path: self.file_path.clone(),
                    details: error.details().to_vec(),
                },
            )
    }

    fn write_atomically(&self, data: &T) -> Result<(), StorageError> {
        let parent = self
            .file_path
            .parent()
            .ok_or_else(|| StorageError::InvalidStructure {
                file_path: self.file_path.clone(),
                details: vec!["root: 数据文件必须位于有效目录".to_owned()],
            })?;
        fs::create_dir_all(parent).map_err(|source| self.io_error("创建目录", source))?;

        let mut bytes =
            serde_json::to_vec_pretty(data).map_err(|_| StorageError::InvalidStructure {
                file_path: self.file_path.clone(),
                details: vec!["root: 数据无法序列化为 JSON".to_owned()],
            })?;
        bytes.push(b'\n');

        let mut file = open_atomic_file(&self.file_path)
            .map_err(|source| self.io_error("创建临时文件", source))?;
        file.write_all(&bytes)
            .map_err(|source| self.io_error("写入", source))?;
        file.sync_all()
            .map_err(|source| self.io_error("同步", source))?;
        file.commit()
            .map_err(|source| self.io_error("替换", source))?;
        Ok(())
    }

    fn lock_writes(&self) -> Result<MutexGuard<'_, ()>, StorageError> {
        self.write_lock
            .lock()
            .map_err(|_| StorageError::QueueUnavailable)
    }

    fn io_error(&self, operation: &'static str, source: io::Error) -> StorageError {
        StorageError::Io {
            operation,
            file_path: self.file_path.clone(),
            source,
        }
    }
}

fn read_numeric_version(value: &Value) -> Option<u32> {
    value.get("version")?.as_u64()?.try_into().ok()
}

fn create_corrupt_backup_path(file_path: &Path) -> PathBuf {
    let extension = file_path
        .extension()
        .and_then(|value| value.to_str())
        .unwrap_or_default();
    let stem = file_path
        .file_stem()
        .and_then(|value| value.to_str())
        .unwrap_or("data");
    let timestamp = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis());
    let suffix = Uuid::new_v4();
    let file_name = if extension.is_empty() {
        format!("{stem}.corrupt-{timestamp}-{suffix}")
    } else {
        format!("{stem}.corrupt-{timestamp}-{suffix}.{extension}")
    };
    file_path.with_file_name(file_name)
}

fn open_atomic_file(file_path: &Path) -> io::Result<AtomicWriteFile> {
    #[cfg(unix)]
    let mut options = AtomicWriteFile::options();
    #[cfg(not(unix))]
    let options = AtomicWriteFile::options();
    #[cfg(unix)]
    {
        use std::os::unix::fs::OpenOptionsExt;
        options.mode(0o600);
    }
    options.open(file_path)
}
