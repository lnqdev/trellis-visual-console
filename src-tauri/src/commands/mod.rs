use std::fs;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::{AppHandle, State};
use tauri_plugin_dialog::DialogExt;
use tauri_plugin_opener::OpenerExt;
use trellis_core::contracts::{
    CommandError, DirectoryPickerResponse, OpenProjectPathResponse, ProjectActionResponse,
    ProjectDetailResponse, ProjectDocumentResponse, ProjectListResponse, ProjectRegisterInput,
    ProjectRegisterResponse, ProjectScanResponse, TaskCenterResponse, TaskDetailResponse,
};

use crate::AppState;

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
