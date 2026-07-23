use std::fs;
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicBool, Ordering};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::{SystemTime, UNIX_EPOCH};

use atomic_write_file::AtomicWriteFile;
use serde::{Deserialize, Serialize};
use tauri_plugin_updater::Update;
use time::format_description::well_known::Rfc3339;
use time::{Duration, OffsetDateTime};
use trellis_core::contracts::CommandError;

const UPDATE_STATE_VERSION: u32 = 1;
const UPDATE_STATE_FILE: &str = "updater-state.json";
const AUTOMATIC_CHECK_INTERVAL: Duration = Duration::minutes(30);

/// 桌面更新检查时间文件。
#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct UpdateCheckState {
    version: u32,
    last_automatic_check_at: Option<String>,
}

impl Default for UpdateCheckState {
    /// 创建尚未执行自动检查的初始状态。
    fn default() -> Self {
        Self {
            version: UPDATE_STATE_VERSION,
            last_automatic_check_at: None,
        }
    }
}

/// 更新状态文件错误，不向 Command 泄漏路径或底层错误。
enum UpdateStateError {
    UnsupportedVersion,
    Unavailable,
}

/// 保护更新状态文件的读取、隔离和原子写入。
struct UpdateCheckStore {
    file_path: PathBuf,
    write_lock: Mutex<()>,
}

impl UpdateCheckStore {
    /// 在固定应用数据目录下创建更新状态存储。
    fn new(data_directory: PathBuf) -> Self {
        Self {
            file_path: data_directory.join(UPDATE_STATE_FILE),
            write_lock: Mutex::new(()),
        }
    }

    /// 判断当前时间是否已经超过自动检查间隔。
    fn automatic_check_due(&self, now: OffsetDateTime) -> Result<bool, UpdateStateError> {
        let _guard = self.lock()?;
        let state = self.load_locked()?;
        let Some(last_checked_at) = state.last_automatic_check_at else {
            return Ok(true);
        };
        let last_checked_at = match OffsetDateTime::parse(&last_checked_at, &Rfc3339) {
            Ok(value) => value,
            Err(_) => {
                self.isolate_corrupt_locked()?;
                return Ok(true);
            }
        };

        // 系统时钟回拨时允许重新检查，避免错误时间戳长期阻止更新。
        Ok(last_checked_at > now || now - last_checked_at >= AUTOMATIC_CHECK_INTERVAL)
    }

    /// 原子记录一次自动检查结束时间。
    fn record_automatic_check(&self, now: OffsetDateTime) -> Result<(), UpdateStateError> {
        let _guard = self.lock()?;
        let state = UpdateCheckState {
            version: UPDATE_STATE_VERSION,
            last_automatic_check_at: Some(
                now.format(&Rfc3339)
                    .map_err(|_| UpdateStateError::Unavailable)?,
            ),
        };
        self.write_locked(&state)
    }

    /// 在写锁内读取并校验状态；损坏内容隔离后恢复为空状态。
    fn load_locked(&self) -> Result<UpdateCheckState, UpdateStateError> {
        let bytes = match fs::read(&self.file_path) {
            Ok(bytes) => bytes,
            Err(error) if error.kind() == io::ErrorKind::NotFound => {
                return Ok(UpdateCheckState::default());
            }
            Err(_) => return Err(UpdateStateError::Unavailable),
        };
        let value: serde_json::Value = match serde_json::from_slice(&bytes) {
            Ok(value) => value,
            Err(_) => {
                self.isolate_corrupt_locked()?;
                return Ok(UpdateCheckState::default());
            }
        };
        let version = value.get("version").and_then(serde_json::Value::as_u64);
        if version.is_some_and(|version| version > u64::from(UPDATE_STATE_VERSION)) {
            return Err(UpdateStateError::UnsupportedVersion);
        }
        if version != Some(u64::from(UPDATE_STATE_VERSION)) {
            self.isolate_corrupt_locked()?;
            return Ok(UpdateCheckState::default());
        }
        match serde_json::from_value(value) {
            Ok(state) => Ok(state),
            Err(_) => {
                self.isolate_corrupt_locked()?;
                Ok(UpdateCheckState::default())
            }
        }
    }

    /// 隔离损坏状态文件，保留原始字节用于诊断。
    fn isolate_corrupt_locked(&self) -> Result<(), UpdateStateError> {
        if !self.file_path.exists() {
            return Ok(());
        }
        let timestamp = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .map_or(0, |duration| duration.as_nanos());
        let backup_path = self
            .file_path
            .with_file_name(format!("updater-state.corrupt-{timestamp}.json"));
        fs::rename(&self.file_path, backup_path).map_err(|_| UpdateStateError::Unavailable)
    }

    /// 以 UTF-8 JSON、文件同步和同目录原子替换保存完整状态。
    fn write_locked(&self, state: &UpdateCheckState) -> Result<(), UpdateStateError> {
        let parent = self
            .file_path
            .parent()
            .ok_or(UpdateStateError::Unavailable)?;
        fs::create_dir_all(parent).map_err(|_| UpdateStateError::Unavailable)?;
        let mut bytes =
            serde_json::to_vec_pretty(state).map_err(|_| UpdateStateError::Unavailable)?;
        bytes.push(b'\n');
        let mut file =
            open_atomic_file(&self.file_path).map_err(|_| UpdateStateError::Unavailable)?;
        file.write_all(&bytes)
            .map_err(|_| UpdateStateError::Unavailable)?;
        file.sync_all().map_err(|_| UpdateStateError::Unavailable)?;
        file.commit().map_err(|_| UpdateStateError::Unavailable)
    }

    /// 获取更新状态写锁。
    fn lock(&self) -> Result<MutexGuard<'_, ()>, UpdateStateError> {
        self.write_lock
            .lock()
            .map_err(|_| UpdateStateError::Unavailable)
    }
}

/// 管理单进程更新检查、待安装句柄和安装互斥。
pub struct UpdateManager {
    store: Result<Arc<UpdateCheckStore>, CommandError>,
    pending_update: Mutex<Option<Update>>,
    operation_active: AtomicBool,
}

impl UpdateManager {
    /// 根据应用数据目录初始化更新管理器。
    #[must_use]
    pub fn new(data_directory: Result<PathBuf, CommandError>) -> Self {
        Self {
            store: data_directory.map(|path| Arc::new(UpdateCheckStore::new(path))),
            pending_update: Mutex::new(None),
            operation_active: AtomicBool::new(false),
        }
    }

    /// 返回更新检查时间存储。
    fn store(&self) -> Result<Arc<UpdateCheckStore>, CommandError> {
        self.store.clone()
    }

    /// 在线程池判断自动检查是否到期。
    pub async fn automatic_check_due(&self) -> Result<bool, CommandError> {
        let store = self.store()?;
        tauri::async_runtime::spawn_blocking(move || {
            store
                .automatic_check_due(OffsetDateTime::now_utc())
                .map_err(map_state_error)
        })
        .await
        .map_err(|_| update_state_unavailable())?
    }

    /// 在线程池记录自动检查完成时间。
    pub async fn record_automatic_check(&self) -> Result<(), CommandError> {
        let store = self.store()?;
        tauri::async_runtime::spawn_blocking(move || {
            store
                .record_automatic_check(OffsetDateTime::now_utc())
                .map_err(map_state_error)
        })
        .await
        .map_err(|_| update_state_unavailable())?
    }

    /// 尝试独占一次更新检查。
    pub fn begin_check(&self) -> Result<UpdateOperationGuard<'_>, CommandError> {
        UpdateOperationGuard::begin(
            &self.operation_active,
            "update-check-busy",
            "正在执行更新操作，请稍候",
        )
    }

    /// 尝试独占一次更新安装。
    pub fn begin_install(&self) -> Result<UpdateOperationGuard<'_>, CommandError> {
        UpdateOperationGuard::begin(
            &self.operation_active,
            "update-install-busy",
            "正在执行更新操作，请稍候",
        )
    }

    /// 替换当前待安装更新；没有新版本时清除旧句柄。
    pub fn set_pending_update(&self, update: Option<Update>) -> Result<(), CommandError> {
        *self.pending_update.lock().map_err(|_| {
            CommandError::new("update-state-unavailable", "更新状态暂时不可用，请重试")
        })? = update;
        Ok(())
    }

    /// 取出待安装更新，安装失败后要求用户重新检查。
    pub fn take_pending_update(&self) -> Result<Update, CommandError> {
        self.pending_update
            .lock()
            .map_err(|_| {
                CommandError::new("update-state-unavailable", "更新状态暂时不可用，请重试")
            })?
            .take()
            .ok_or_else(|| {
                CommandError::new("update-not-available", "没有可安装的更新，请重新检查")
            })
    }
}

/// 通过析构可靠释放检查或安装互斥标记。
pub struct UpdateOperationGuard<'a> {
    flag: &'a AtomicBool,
}

impl<'a> UpdateOperationGuard<'a> {
    /// 原子占用操作标记。
    fn begin(
        flag: &'a AtomicBool,
        code: &'static str,
        message: &'static str,
    ) -> Result<Self, CommandError> {
        flag.compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .map_err(|_| CommandError::new(code, message))?;
        Ok(Self { flag })
    }
}

impl Drop for UpdateOperationGuard<'_> {
    /// 释放操作标记。
    fn drop(&mut self) {
        self.flag.store(false, Ordering::SeqCst);
    }
}

fn map_state_error(error: UpdateStateError) -> CommandError {
    match error {
        UpdateStateError::UnsupportedVersion => CommandError::new(
            "update-state-version-unsupported",
            "更新检查状态来自更高版本客户端，请升级后重试",
        ),
        UpdateStateError::Unavailable => update_state_unavailable(),
    }
}

fn update_state_unavailable() -> CommandError {
    CommandError::new(
        "update-state-unavailable",
        "更新检查状态无法访问，请稍后重试",
    )
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
