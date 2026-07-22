use std::path::PathBuf;
use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};

use tauri::Manager;
use tauri::webview::PageLoadEvent;
use trellis_core::ApplicationService;
use trellis_core::contracts::CommandError;

mod commands;
mod realtime;
mod system;

use system::logging::AppLogger;
use system::updater::UpdateManager;

/// 桌面适配层共享状态。
pub struct AppState {
    core: Result<Arc<ApplicationService>, CommandError>,
    data_directory: Result<PathBuf, CommandError>,
    logger: Arc<AppLogger>,
    update_manager: Arc<UpdateManager>,
    directory_picker_active: Arc<AtomicBool>,
    closing: AtomicBool,
}

impl AppState {
    /// 返回已初始化的 Core，或向 Command 透传稳定初始化错误。
    pub fn core(&self) -> Result<Arc<ApplicationService>, CommandError> {
        self.ensure_active()?;
        self.core.clone()
    }

    /// 确保桌面进程尚未进入关闭或重启阶段。
    pub fn ensure_active(&self) -> Result<(), CommandError> {
        if self.closing.load(Ordering::SeqCst) {
            return Err(CommandError::new(
                "application-closing",
                "客户端正在关闭，已拒绝新的操作",
            ));
        }
        Ok(())
    }

    /// 返回关闭流程使用的 Core，不受新任务拒绝状态影响。
    pub fn core_for_shutdown(&self) -> Result<Arc<ApplicationService>, CommandError> {
        self.core.clone()
    }

    /// 返回固定应用数据目录。
    pub fn data_directory(&self) -> Result<PathBuf, CommandError> {
        self.data_directory.clone()
    }

    /// 返回固定日志入口。
    pub fn logger(&self) -> Arc<AppLogger> {
        Arc::clone(&self.logger)
    }

    /// 返回桌面更新管理器。
    pub fn update_manager(&self) -> Arc<UpdateManager> {
        Arc::clone(&self.update_manager)
    }

    /// 返回跨异步任务共享的目录选择忙碌标记。
    pub fn directory_picker_active(&self) -> Arc<AtomicBool> {
        Arc::clone(&self.directory_picker_active)
    }

    /// 原子进入关闭状态，重复调用返回 false。
    pub fn begin_closing(&self) -> bool {
        self.closing
            .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
            .is_ok()
    }
}

/// 创建并运行 Tauri 桌面应用。
pub fn run() {
    tauri::Builder::default()
        // 单实例插件必须最先注册，避免第二个进程初始化业务资源。
        .plugin(tauri_plugin_single_instance::init(
            |app, _arguments, _cwd| {
                if let Some(window) = app.get_webview_window("main") {
                    let _ = window.show();
                    let _ = window.unminimize();
                    let _ = window.set_focus();
                }
            },
        ))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_updater::Builder::new().build())
        .setup(|app| {
            let data_directory = resolve_application_data_directory();
            let update_manager = Arc::new(UpdateManager::new(data_directory.clone()));
            let log_directory = data_directory.as_ref().map_or_else(
                |_| std::env::temp_dir().join("trellis-visual-console-logs"),
                |directory| directory.join("logs"),
            );
            let logger = Arc::new(AppLogger::new(log_directory));
            logger.lifecycle("desktop-starting");
            let core = data_directory
                .clone()
                .and_then(|data_directory| {
                    ApplicationService::with_event_sink(
                        data_directory,
                        Arc::new(realtime::TauriEventSink::new(
                            app.handle().clone(),
                            Arc::clone(&logger),
                        )),
                    )
                })
                .map(Arc::new);

            // 窗口创建后先恢复焦点项目，再补齐其余迁移快照，避免焦点重复索引。
            if let Ok(core) = &core {
                let background_core = Arc::clone(core);
                tauri::async_runtime::spawn_blocking(move || {
                    let _ = background_core.restore_focus_projects();
                    let _ = background_core.rebuild_migrated_projects();
                });
            }
            logger.lifecycle("desktop-ready");
            app.manage(AppState {
                core,
                data_directory,
                logger,
                update_manager,
                directory_picker_active: Arc::new(AtomicBool::new(false)),
                closing: AtomicBool::new(false),
            });
            Ok(())
        })
        .on_page_load(|webview, payload| {
            if payload.event() == PageLoadEvent::Finished
                && let Some(state) = webview.try_state::<AppState>()
            {
                state.logger().lifecycle("desktop-page-loaded");
            }
        })
        .invoke_handler(tauri::generate_handler![
            commands::list_projects,
            commands::list_tasks,
            commands::get_project,
            commands::scan_projects,
            commands::register_projects,
            commands::set_project_focus,
            commands::refresh_project,
            commands::read_spec_document,
            commands::read_task_detail,
            commands::read_task_document,
            commands::select_directory,
            commands::open_project_path,
            commands::open_log_directory,
            commands::check_for_update,
            commands::install_update,
            commands::restart_application,
            commands::clear_application_data_and_exit,
        ])
        .on_window_event(|window, event| {
            if let tauri::WindowEvent::CloseRequested { api, .. } = event {
                api.prevent_close();
                let state = window.state::<AppState>();
                if !state.begin_closing() {
                    return;
                }
                let app = window.app_handle().clone();
                let logger = state.logger();
                match state.core_for_shutdown() {
                    Ok(core) => {
                        tauri::async_runtime::spawn_blocking(move || {
                            logger.lifecycle("desktop-closing");
                            let _ = core.close();
                            logger.lifecycle("desktop-closed");
                            app.exit(0);
                        });
                    }
                    Err(_) => app.exit(0),
                }
            }
        })
        .run(tauri::generate_context!())
        .expect("Trellis Visual Console 桌面进程启动失败");
}

/// 解析开发覆盖目录或 Tauri 固定应用数据目录。
fn resolve_application_data_directory() -> Result<PathBuf, CommandError> {
    if let Some(path) = std::env::var_os("TRELLIS_VISUAL_CONSOLE_DATA_DIR") {
        let path = PathBuf::from(path);
        return if path.is_absolute() {
            Ok(path)
        } else {
            std::env::current_dir()
                .map(|directory| directory.join(path))
                .map_err(|_| {
                    CommandError::new(
                        "application-data-path-unavailable",
                        "无法解析应用数据目录，请重启客户端",
                    )
                })
        };
    }
    #[cfg(target_os = "macos")]
    if let Some(home) = std::env::var_os("HOME") {
        return Ok(PathBuf::from(home).join("Library/Application Support/Trellis Visual Console"));
    }
    #[cfg(target_os = "windows")]
    {
        if let Some(app_data) = std::env::var_os("APPDATA").filter(|value| !value.is_empty()) {
            return Ok(PathBuf::from(app_data).join("Trellis Visual Console"));
        }
        if let Some(profile) = std::env::var_os("USERPROFILE").filter(|value| !value.is_empty()) {
            return Ok(PathBuf::from(profile).join("AppData/Roaming/Trellis Visual Console"));
        }
    }
    Err(CommandError::new(
        "application-data-path-unavailable",
        "无法确定应用数据目录，请重启客户端",
    ))
}
