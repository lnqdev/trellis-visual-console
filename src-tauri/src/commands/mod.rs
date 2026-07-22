use std::fs;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use tauri_plugin_updater::{Error as UpdaterError, UpdaterExt};
use time::format_description::well_known::Rfc3339;
use trellis_core::contracts::{
    CommandError, DirectoryPickerResponse, OpenProjectPathResponse, ProjectActionResponse,
    ProjectDetailResponse, ProjectDocumentResponse, ProjectListResponse, ProjectRegisterInput,
    ProjectRegisterResponse, ProjectScanResponse, TaskCenterResponse, TaskDetailResponse,
};

use crate::AppState;

const APPROVED_UPDATE_HOST: &str = "gitee.com";
const APPROVED_UPDATE_RELEASE_PATH: &str = "/wanglinqiao/trellis-visual-console/releases/download/";

/// 更新检查触发方式。
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum UpdateCheckMode {
    Automatic,
    Manual,
}

/// 可用更新的受控展示信息。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateMetadataResponse {
    current_version: String,
    version: String,
    notes: String,
    published_at: String,
    platform: &'static str,
}

/// 更新检查结果。
#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "status",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum UpdateCheckResponse {
    Skipped {
        current_version: String,
        platform: &'static str,
    },
    UpToDate {
        current_version: String,
        platform: &'static str,
    },
    Available {
        update: UpdateMetadataResponse,
    },
}

/// 更新包下载进度事件。
#[derive(Debug, Clone, Serialize)]
#[serde(
    tag = "event",
    rename_all = "camelCase",
    rename_all_fields = "camelCase"
)]
pub enum UpdateDownloadProgress {
    Started {
        content_length: Option<u64>,
    },
    Progress {
        downloaded: u64,
        content_length: Option<u64>,
    },
    DownloadFinished,
}

/// 更新安装完成响应。
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct UpdateInstallResponse {
    restart_required: bool,
}

/// 返回全部已登记项目和最后成功快照摘要。
#[tauri::command]
pub async fn list_projects(
    state: State<'_, AppState>,
) -> Result<ProjectListResponse, CommandError> {
    let core = state.core()?;
    run_core(move || core.list_projects()).await
}

/// 返回跨项目任务中心的扁平摘要。
#[tauri::command]
pub async fn list_tasks(state: State<'_, AppState>) -> Result<TaskCenterResponse, CommandError> {
    let core = state.core()?;
    run_core(move || core.list_tasks()).await
}

/// 返回单个已登记项目的详情。
#[tauri::command(rename_all = "camelCase")]
pub async fn get_project(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<ProjectDetailResponse, CommandError> {
    let core = state.core()?;
    run_core(move || core.get_project(&project_id)).await
}

/// 扫描目录并返回不落盘的 Trellis 项目候选。
#[tauri::command(rename_all = "camelCase")]
pub async fn scan_projects(
    root_path: String,
    state: State<'_, AppState>,
) -> Result<ProjectScanResponse, CommandError> {
    let core = state.core()?;
    run_core(move || Ok(core.scan_projects(&root_path))).await
}

/// 按调用顺序登记一个或多个项目。
#[tauri::command(rename_all = "camelCase")]
pub async fn register_projects(
    projects: Vec<ProjectRegisterInput>,
    state: State<'_, AppState>,
) -> Result<ProjectRegisterResponse, CommandError> {
    let core = state.core()?;
    run_core(move || core.register_projects(projects)).await
}

/// 切换项目焦点状态并返回最新详情。
#[tauri::command(rename_all = "camelCase")]
pub async fn set_project_focus(
    project_id: String,
    focused: bool,
    state: State<'_, AppState>,
) -> Result<ProjectActionResponse, CommandError> {
    let core = state.core()?;
    run_core(move || core.set_project_focus(&project_id, focused)).await
}

/// 显式刷新单个项目并返回最新详情。
#[tauri::command(rename_all = "camelCase")]
pub async fn refresh_project(
    project_id: String,
    state: State<'_, AppState>,
) -> Result<ProjectActionResponse, CommandError> {
    let core = state.core()?;
    run_core(move || core.refresh_project(&project_id)).await
}

/// 读取快照白名单中的 Spec Markdown 文档。
#[tauri::command(rename_all = "camelCase")]
pub async fn read_spec_document(
    project_id: String,
    source_path: String,
    state: State<'_, AppState>,
) -> Result<ProjectDocumentResponse, CommandError> {
    let core = state.core()?;
    run_core(move || core.read_spec_document(&project_id, &source_path)).await
}

/// 返回快照中已知 Task 的文档清单。
#[tauri::command(rename_all = "camelCase")]
pub async fn read_task_detail(
    project_id: String,
    source_path: String,
    state: State<'_, AppState>,
) -> Result<TaskDetailResponse, CommandError> {
    let core = state.core()?;
    run_core(move || core.read_task_detail(&project_id, &source_path)).await
}

/// 读取 Task 清单中已知的 Markdown 或 JSONL 文档。
#[tauri::command(rename_all = "camelCase")]
pub async fn read_task_document(
    project_id: String,
    task_source_path: String,
    document_path: String,
    state: State<'_, AppState>,
) -> Result<ProjectDocumentResponse, CommandError> {
    let core = state.core()?;
    run_core(move || core.read_task_document(&project_id, &task_source_path, &document_path)).await
}

/// 打开系统原生目录选择对话框，取消属于正常结果。
#[tauri::command]
pub async fn select_directory(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<DirectoryPickerResponse, CommandError> {
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        let _ = (app, state);
        return Err(CommandError::new(
            "directory-picker-unsupported",
            "当前操作系统暂不支持目录选择，请手工输入路径",
        ));
    }
    #[cfg(any(target_os = "macos", target_os = "windows"))]
    {
        let active = state.directory_picker_active();
        if active
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_err()
        {
            return Err(CommandError::new(
                "directory-picker-busy",
                "已有目录选择窗口正在等待操作",
            ));
        }
        run_core(move || {
            let _guard = DirectoryPickerGuard(active);
            let selected = app
                .dialog()
                .file()
                .set_title("选择目录")
                .blocking_pick_folder();
            selected.map_or(Ok(DirectoryPickerResponse::Cancelled), |path| {
                let path = path.into_path().map_err(|_| {
                    CommandError::new(
                        "directory-picker-unavailable",
                        "系统目录选择器返回了无效路径，请手工输入",
                    )
                })?;
                Ok(DirectoryPickerResponse::Selected {
                    path: path.to_string_lossy().into_owned(),
                })
            })
        })
        .await
    }
}

/// 将已登记项目根目录或合法 `.trellis` 路径交给系统打开。
#[tauri::command(rename_all = "camelCase")]
pub async fn open_project_path(
    project_id: String,
    source_path: Option<String>,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<OpenProjectPathResponse, CommandError> {
    let core = state.core()?;
    run_core(move || {
        let path = core.resolve_open_project_path(&project_id, source_path.as_deref())?;
        app.opener()
            .open_path(path.to_string_lossy().into_owned(), None::<String>)
            .map_err(|_| CommandError::new("project-open-failed", "系统无法打开指定项目路径"))?;
        Ok(OpenProjectPathResponse::opened())
    })
    .await
}

/// 打开固定应用日志目录。
#[tauri::command]
pub async fn open_log_directory(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<OpenProjectPathResponse, CommandError> {
    let data_directory = state.data_directory()?;
    run_core(move || {
        let log_directory = data_directory.join("logs");
        fs::create_dir_all(&log_directory)
            .map_err(|_| CommandError::new("log-directory-unavailable", "应用日志目录无法访问"))?;
        app.opener()
            .open_path(log_directory.to_string_lossy().into_owned(), None::<String>)
            .map_err(|_| {
                CommandError::new("log-directory-open-failed", "系统无法打开应用日志目录")
            })?;
        Ok(OpenProjectPathResponse::opened())
    })
    .await
}

/// 按自动限频或用户手动触发检查在线更新。
#[tauri::command(rename_all = "camelCase")]
pub async fn check_for_update(
    mode: UpdateCheckMode,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<UpdateCheckResponse, CommandError> {
    state.ensure_active()?;
    let manager = state.update_manager();
    let _guard = manager.begin_check()?;
    let current_version = app.package_info().version.to_string();

    if matches!(mode, UpdateCheckMode::Automatic) && !manager.automatic_check_due().await? {
        return Ok(UpdateCheckResponse::Skipped {
            current_version,
            platform: current_platform(),
        });
    }

    let logger = state.logger();
    logger.lifecycle("update-check-started");
    // 每次真实检查都废弃旧句柄，避免网络或清单失败后继续安装过期结果。
    manager.set_pending_update(None)?;
    let update_result = build_updater(&app);
    let update_result = match update_result {
        Ok(updater) => updater.check().await,
        Err(error) => Err(error),
    };

    if matches!(mode, UpdateCheckMode::Automatic)
        && let Err(error) = manager.record_automatic_check().await
    {
        logger.error_type("update-check-failed", "state-write");
        return Err(error);
    }

    let update = update_result.map_err(|error| {
        logger.error_type("update-check-failed", update_error_type(&error));
        map_check_error(error)
    })?;
    let Some(update) = update else {
        manager.set_pending_update(None)?;
        logger.lifecycle("update-check-up-to-date");
        return Ok(UpdateCheckResponse::UpToDate {
            current_version,
            platform: current_platform(),
        });
    };

    let notes = update
        .body
        .as_deref()
        .map(str::trim)
        .filter(|notes| contains_chinese(notes))
        .ok_or_else(|| {
            logger.error_type("update-check-failed", "notes-missing");
            CommandError::new(
                "update-notes-missing",
                "更新清单缺少中文更新说明，已拒绝安装",
            )
        })?
        .to_owned();
    let published_at = update
        .date
        .ok_or_else(|| {
            logger.error_type("update-check-failed", "date-missing");
            CommandError::new("update-date-missing", "更新清单缺少发布时间，已拒绝安装")
        })?
        .format(&Rfc3339)
        .map_err(|_| {
            logger.error_type("update-check-failed", "date-invalid");
            CommandError::new("update-date-invalid", "更新清单发布时间不正确，已拒绝安装")
        })?;
    let download_url = &update.download_url;
    if download_url.scheme() != "https"
        || download_url.host_str() != Some(APPROVED_UPDATE_HOST)
        || !download_url
            .path()
            .starts_with(APPROVED_UPDATE_RELEASE_PATH)
        || !download_url.path().contains(&update.version)
        || !download_url.username().is_empty()
        || download_url.password().is_some()
        || download_url.query().is_some()
        || download_url.fragment().is_some()
    {
        logger.error_type("update-check-failed", "download-endpoint");
        return Err(CommandError::new(
            "update-download-endpoint-invalid",
            "更新包地址不在批准的发布范围内，已拒绝安装",
        ));
    }
    let response = UpdateCheckResponse::Available {
        update: UpdateMetadataResponse {
            current_version: update.current_version.clone(),
            version: update.version.clone(),
            notes,
            published_at,
            platform: current_platform(),
        },
    };
    manager.set_pending_update(Some(update))?;
    logger.lifecycle("update-check-available");
    Ok(response)
}

/// 下载、验证并安装用户已经确认的更新包。
#[tauri::command(rename_all = "camelCase")]
pub async fn install_update(
    on_progress: Channel<UpdateDownloadProgress>,
    state: State<'_, AppState>,
) -> Result<UpdateInstallResponse, CommandError> {
    state.ensure_active()?;
    let manager = state.update_manager();
    let _guard = manager.begin_install()?;
    let update = manager.take_pending_update()?;
    let logger = state.logger();
    logger.lifecycle("update-install-started");

    let finish_channel = on_progress.clone();
    let mut started = false;
    let mut downloaded = 0_u64;
    let result = update
        .download_and_install(
            move |chunk_length, content_length| {
                if !started {
                    let _ = on_progress.send(UpdateDownloadProgress::Started { content_length });
                    started = true;
                }
                downloaded = downloaded.saturating_add(chunk_length as u64);
                let _ = on_progress.send(UpdateDownloadProgress::Progress {
                    downloaded,
                    content_length,
                });
            },
            move || {
                let _ = finish_channel.send(UpdateDownloadProgress::DownloadFinished);
            },
        )
        .await;

    result.map_err(|error| {
        logger.error_type("update-install-failed", update_error_type(&error));
        map_install_error(error)
    })?;
    logger.lifecycle("update-installed");
    Ok(UpdateInstallResponse {
        restart_required: cfg!(target_os = "macos"),
    })
}

/// 关闭 Core 后重启应用，使已安装的 macOS 更新生效。
#[tauri::command]
pub async fn restart_application(
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    if !state.begin_closing() {
        return Err(CommandError::new(
            "application-closing",
            "客户端正在关闭，已拒绝新的操作",
        ));
    }
    let core = state.core_for_shutdown().ok();
    let logger = state.logger();
    tauri::async_runtime::spawn_blocking(move || {
        logger.lifecycle("update-restart-started");
        if let Some(core) = core {
            core.close()?;
        }
        logger.lifecycle("update-restarting");
        app.restart();
    })
    .await
    .map_err(|_| CommandError::new("update-restart-failed", "应用重启失败，请手动重启"))?
}

/// 二次确认后关闭 Core、删除固定应用数据目录并退出。
#[tauri::command(rename_all = "camelCase")]
pub async fn clear_application_data_and_exit(
    confirmed: bool,
    app: AppHandle,
    state: State<'_, AppState>,
) -> Result<(), CommandError> {
    if !confirmed {
        return Err(CommandError::new(
            "clear-application-data-unconfirmed",
            "清除应用数据需要明确确认",
        ));
    }
    if !state.begin_closing() {
        return Err(CommandError::new(
            "application-closing",
            "客户端正在关闭，已拒绝新的操作",
        ));
    }
    let core = state.core_for_shutdown().ok();
    let data_directory = state.data_directory()?;
    let logger = state.logger();
    tauri::async_runtime::spawn_blocking(move || {
        logger.lifecycle("application-data-clear-started");
        if let Some(core) = core {
            core.close()?;
        }
        match fs::remove_dir_all(&data_directory) {
            Ok(()) => {}
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => {}
            Err(_) => {
                return Err(CommandError::new(
                    "application-data-clear-failed",
                    "应用数据删除失败，请关闭客户端后重试",
                ));
            }
        }
        app.exit(0);
        Ok(())
    })
    .await
    .map_err(|_| CommandError::new("core-task-failed", "应用数据清理任务执行失败"))?
}

/// 构建带 Windows 退出清理回调的更新器。
fn build_updater(app: &AppHandle) -> Result<tauri_plugin_updater::Updater, UpdaterError> {
    let exit_app = app.clone();
    app.updater_builder()
        .on_before_exit(move || {
            close_for_update(&exit_app);
            exit_app.cleanup_before_exit();
        })
        .build()
}

/// Windows 启动安装器前同步关闭 Core 和受控日志。
fn close_for_update(app: &AppHandle) {
    if let Some(state) = app.try_state::<AppState>() {
        let logger = state.logger();
        if state.begin_closing() {
            logger.lifecycle("update-closing");
            if let Ok(core) = state.core_for_shutdown()
                && core.close().is_err()
            {
                logger.error_type("update-close-failed", "core-close");
            }
            logger.lifecycle("update-closed");
        }
    }
}

/// 将更新检查错误转换为稳定中文 Command 错误。
fn map_check_error(error: UpdaterError) -> CommandError {
    match error {
        UpdaterError::Serialization(_) | UpdaterError::Semver(_) | UpdaterError::UrlParse(_) => {
            CommandError::new("update-manifest-invalid", "更新清单格式不正确，请稍后重试")
        }
        UpdaterError::TargetNotFound(_)
        | UpdaterError::TargetsNotFound(_)
        | UpdaterError::UnsupportedArch
        | UpdaterError::UnsupportedOs => CommandError::new(
            "update-platform-unsupported",
            "更新清单不支持当前系统或架构",
        ),
        UpdaterError::InsecureTransportProtocol => CommandError::new(
            "update-endpoint-insecure",
            "更新地址不是安全的 HTTPS 连接，已拒绝访问",
        ),
        _ => CommandError::new("update-check-failed", "暂时无法检查更新，请确认网络后重试"),
    }
}

/// 将下载、签名与安装错误转换为稳定中文 Command 错误。
fn map_install_error(error: UpdaterError) -> CommandError {
    match error {
        UpdaterError::Minisign(_) | UpdaterError::Base64(_) | UpdaterError::SignatureUtf8(_) => {
            CommandError::new("update-signature-invalid", "更新包签名无效，已拒绝安装")
        }
        UpdaterError::Network(_) | UpdaterError::Reqwest(_) => CommandError::new(
            "update-download-failed",
            "更新包下载失败，请确认网络后重新检查",
        ),
        _ => CommandError::new(
            "update-install-failed",
            "更新安装失败，当前版本未被替换，请重新检查",
        ),
    }
}

/// 返回日志允许记录的稳定更新错误类型。
fn update_error_type(error: &UpdaterError) -> &'static str {
    match error {
        UpdaterError::Minisign(_) | UpdaterError::Base64(_) | UpdaterError::SignatureUtf8(_) => {
            "signature"
        }
        UpdaterError::Serialization(_) | UpdaterError::Semver(_) | UpdaterError::UrlParse(_) => {
            "manifest"
        }
        UpdaterError::TargetNotFound(_)
        | UpdaterError::TargetsNotFound(_)
        | UpdaterError::UnsupportedArch
        | UpdaterError::UnsupportedOs => "platform",
        UpdaterError::InsecureTransportProtocol => "transport",
        UpdaterError::Network(_) | UpdaterError::Reqwest(_) => "network",
        _ => "plugin",
    }
}

/// 判断更新说明是否至少包含一个常用中文字符。
fn contains_chinese(value: &str) -> bool {
    value
        .chars()
        .any(|character| matches!(character, '\u{3400}'..='\u{4dbf}' | '\u{4e00}'..='\u{9fff}'))
}

/// 返回前端展示所需的平台枚举。
const fn current_platform() -> &'static str {
    #[cfg(target_os = "macos")]
    {
        "macos"
    }
    #[cfg(target_os = "windows")]
    {
        "windows"
    }
    #[cfg(not(any(target_os = "macos", target_os = "windows")))]
    {
        "unsupported"
    }
}

struct DirectoryPickerGuard(Arc<AtomicBool>);

impl Drop for DirectoryPickerGuard {
    fn drop(&mut self) {
        self.0.store(false, Ordering::SeqCst);
    }
}

/// 在线程池执行同步文件系统业务，避免阻塞桌面窗口线程。
async fn run_core<T, F>(operation: F) -> Result<T, CommandError>
where
    T: Send + 'static,
    F: FnOnce() -> Result<T, CommandError> + Send + 'static,
{
    tauri::async_runtime::spawn_blocking(operation)
        .await
        .map_err(|_| {
            CommandError::new(
                "core-task-failed",
                "桌面后端任务执行失败，请重试或重启客户端",
            )
        })?
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::{UpdateCheckResponse, UpdateDownloadProgress, UpdateMetadataResponse};

    /// 断言检查结果与前端 Zod 合同使用相同的 camelCase 字段。
    #[test]
    fn update_check_response_uses_camel_case_wire_fields() {
        let cases = [
            (
                UpdateCheckResponse::Skipped {
                    current_version: "0.2.0-beta.2".to_owned(),
                    platform: "macos",
                },
                json!({
                    "status": "skipped",
                    "currentVersion": "0.2.0-beta.2",
                    "platform": "macos"
                }),
            ),
            (
                UpdateCheckResponse::UpToDate {
                    current_version: "0.2.0-beta.2".to_owned(),
                    platform: "macos",
                },
                json!({
                    "status": "upToDate",
                    "currentVersion": "0.2.0-beta.2",
                    "platform": "macos"
                }),
            ),
            (
                UpdateCheckResponse::Available {
                    update: UpdateMetadataResponse {
                        current_version: "0.2.0-beta.2".to_owned(),
                        version: "0.2.0-beta.3".to_owned(),
                        notes: "修复在线更新返回格式。".to_owned(),
                        published_at: "2026-07-22T10:30:00Z".to_owned(),
                        platform: "macos",
                    },
                },
                json!({
                    "status": "available",
                    "update": {
                        "currentVersion": "0.2.0-beta.2",
                        "version": "0.2.0-beta.3",
                        "notes": "修复在线更新返回格式。",
                        "publishedAt": "2026-07-22T10:30:00Z",
                        "platform": "macos"
                    }
                }),
            ),
        ];

        for (response, expected) in cases {
            assert_eq!(
                serde_json::to_value(response).expect("检查结果应可序列化"),
                expected
            );
        }
    }

    /// 断言 Channel 进度事件与前端 Zod 合同使用相同的 camelCase 字段。
    #[test]
    fn update_download_progress_uses_camel_case_wire_fields() {
        let cases = [
            (
                UpdateDownloadProgress::Started {
                    content_length: Some(128),
                },
                json!({ "event": "started", "contentLength": 128 }),
            ),
            (
                UpdateDownloadProgress::Progress {
                    downloaded: 64,
                    content_length: Some(128),
                },
                json!({
                    "event": "progress",
                    "downloaded": 64,
                    "contentLength": 128
                }),
            ),
            (
                UpdateDownloadProgress::DownloadFinished,
                json!({ "event": "downloadFinished" }),
            ),
        ];

        for (event, expected) in cases {
            assert_eq!(
                serde_json::to_value(event).expect("进度事件应可序列化"),
                expected
            );
        }
    }
}
