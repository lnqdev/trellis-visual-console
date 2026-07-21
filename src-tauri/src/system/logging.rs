use std::fs::{self, OpenOptions};
use std::io::{self, Write};
use std::path::{Path, PathBuf};
use std::sync::Mutex;
use std::time::{SystemTime, UNIX_EPOCH};

use serde_json::json;
use trellis_core::contracts::ProjectRealtimeEvent;

const MAX_LOG_FILE_SIZE: u64 = 2 * 1024 * 1024;
const MAX_LOG_FILE_COUNT: usize = 5;
const CURRENT_LOG_FILE: &str = "trellis-visual-console.jsonl";

/// 只接受受控结构化字段的本地 JSONL 轮转日志。
pub struct AppLogger {
    directory: PathBuf,
    write_lock: Mutex<()>,
}

impl AppLogger {
    /// 创建固定日志目录的受控日志入口。
    #[must_use]
    pub fn new(directory: PathBuf) -> Self {
        Self {
            directory,
            write_lock: Mutex::new(()),
        }
    }

    /// 返回固定日志目录。
    #[must_use]
    pub fn directory(&self) -> &Path {
        &self.directory
    }

    /// 记录不包含外部输入的桌面生命周期事件。
    pub fn lifecycle(&self, event: &'static str) {
        let _ = self.write(&json!({
            "timestampMs": timestamp_millis(),
            "level": "info",
            "event": event,
        }));
    }

    /// 记录仅含稳定项目 ID 和枚举字段的实时事件。
    pub fn project_event(&self, event: &ProjectRealtimeEvent) {
        let _ = self.write(&json!({
            "timestampMs": timestamp_millis(),
            "level": "info",
            "event": "project-realtime",
            "projectId": event.project_id,
            "eventType": event.event_type,
            "watchMode": event.watch_mode,
        }));
    }

    /// 记录不包含底层错误原文的稳定错误类型。
    pub fn error_type(&self, event: &'static str, error_type: &'static str) {
        let _ = self.write(&json!({
            "timestampMs": timestamp_millis(),
            "level": "error",
            "event": event,
            "errorType": error_type,
        }));
    }

    fn write(&self, value: &serde_json::Value) -> io::Result<()> {
        let _guard = self
            .write_lock
            .lock()
            .map_err(|_| io::Error::other("日志写入锁不可用"))?;
        fs::create_dir_all(&self.directory)?;
        let mut line = serde_json::to_vec(value).map_err(io::Error::other)?;
        line.push(b'\n');
        let current_path = self.directory.join(CURRENT_LOG_FILE);
        let current_size = fs::metadata(&current_path).map_or(0, |metadata| metadata.len());
        if current_size.saturating_add(line.len() as u64) > MAX_LOG_FILE_SIZE {
            rotate(&self.directory)?;
        }
        let mut file = OpenOptions::new()
            .create(true)
            .append(true)
            .open(current_path)?;
        file.write_all(&line)
    }
}

fn rotate(directory: &Path) -> io::Result<()> {
    let oldest = directory.join(format!("{CURRENT_LOG_FILE}.{}", MAX_LOG_FILE_COUNT - 1));
    if oldest.exists() {
        fs::remove_file(oldest)?;
    }
    for index in (1..MAX_LOG_FILE_COUNT - 1).rev() {
        let source = directory.join(format!("{CURRENT_LOG_FILE}.{index}"));
        if source.exists() {
            fs::rename(
                source,
                directory.join(format!("{CURRENT_LOG_FILE}.{}", index + 1)),
            )?;
        }
    }
    let current = directory.join(CURRENT_LOG_FILE);
    if current.exists() {
        fs::rename(current, directory.join(format!("{CURRENT_LOG_FILE}.1")))?;
    }
    Ok(())
}

fn timestamp_millis() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map_or(0, |duration| duration.as_millis())
}
