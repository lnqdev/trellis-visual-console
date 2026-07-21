use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard, Weak, mpsc};
use std::thread::{self, JoinHandle};
use std::time::{Duration, Instant};

use crate::application::catalog::{ProjectCatalog, ProjectRefreshResult, ProjectRefreshStatus};
use crate::contracts::{
    ProjectEventResource, ProjectInvalidationScope, ProjectRealtimeEventType, ProjectRuntimeStatus,
    ProjectRuntimeWatchMode,
};
use crate::storage::{ProjectDisplayState, RegisteredProject};

use super::event::{EventSink, ProjectEventPublisher, ProjectRealtimeEventInput};
use super::watcher::{
    NotifyProjectFileWatcherFactory, ProjectFileWatcher, ProjectFileWatcherFactory,
    ProjectFileWatcherOptions, ProjectWatcherEvent,
};

const DEFAULT_DEBOUNCE: Duration = Duration::from_millis(300);
const DEFAULT_POLLING_INTERVAL: Duration = Duration::from_secs(10);

/// 启动恢复焦点集合后的汇总。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectRestoreResult {
    pub restored_project_ids: Vec<String>,
    pub failed_project_ids: Vec<String>,
}

/// 实时生命周期无法继续执行的稳定领域错误。
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
pub enum ProjectRealtimeError {
    #[error("实时管理器正在关闭")]
    Closing,
    #[error("实时管理器状态不可用")]
    StateUnavailable,
    #[error("未找到指定项目")]
    ProjectNotFound,
    #[error("项目文件监听器不可用")]
    WatcherUnavailable,
    #[error("项目数据操作失败")]
    CatalogUnavailable,
}

struct ActiveProjectRuntime {
    project_root: PathBuf,
    watcher: Box<dyn ProjectFileWatcher>,
    watch_mode: ProjectRuntimeWatchMode,
    pending_paths: HashSet<String>,
}

struct RealtimeState {
    runtimes: HashMap<String, ActiveProjectRuntime>,
    project_locks: HashMap<String, Arc<Mutex<()>>>,
    closing: bool,
}

enum RealtimeMessage {
    Paths {
        project_id: String,
        paths: Vec<PathBuf>,
    },
    WatcherFailed {
        project_id: String,
    },
    Shutdown,
}

/// 管理焦点项目的索引、监听、事件批处理和资源释放。
pub struct ProjectRealtimeManager {
    catalog: Arc<ProjectCatalog>,
    events: ProjectEventPublisher,
    watcher_factory: Arc<dyn ProjectFileWatcherFactory>,
    debounce: Duration,
    polling_interval: Duration,
    sender: mpsc::Sender<RealtimeMessage>,
    state: Mutex<RealtimeState>,
    worker: Mutex<Option<JoinHandle<()>>>,
}

impl ProjectRealtimeManager {
    /// 使用生产 watcher 和默认时间参数创建实时管理器。
    pub fn new(
        catalog: Arc<ProjectCatalog>,
        event_sink: Arc<dyn EventSink>,
    ) -> Result<Arc<Self>, ProjectRealtimeError> {
        Self::with_options(
            catalog,
            event_sink,
            Arc::new(NotifyProjectFileWatcherFactory),
            DEFAULT_DEBOUNCE,
            DEFAULT_POLLING_INTERVAL,
        )
    }

    /// 使用可注入 watcher 和时间参数创建实时管理器。
    pub fn with_options(
        catalog: Arc<ProjectCatalog>,
        event_sink: Arc<dyn EventSink>,
        watcher_factory: Arc<dyn ProjectFileWatcherFactory>,
        debounce: Duration,
        polling_interval: Duration,
    ) -> Result<Arc<Self>, ProjectRealtimeError> {
        let (sender, receiver) = mpsc::channel();
        let manager = Arc::new(Self {
            catalog,
            events: ProjectEventPublisher::new(event_sink),
            watcher_factory,
            debounce,
            polling_interval,
            sender,
            state: Mutex::new(RealtimeState {
                runtimes: HashMap::new(),
                project_locks: HashMap::new(),
                closing: false,
            }),
            worker: Mutex::new(None),
        });
        let weak_manager = Arc::downgrade(&manager);
        let worker = thread::Builder::new()
            .name("trellis-realtime".to_owned())
            .spawn(move || worker_loop(weak_manager, receiver))
            .map_err(|_| ProjectRealtimeError::StateUnavailable)?;
        *manager
            .worker
            .lock()
            .map_err(|_| ProjectRealtimeError::StateUnavailable)? = Some(worker);
        Ok(manager)
    }

    /// 启动时只恢复注册表中持久化为焦点的项目。
    pub fn restore_focus_projects(&self) -> Result<ProjectRestoreResult, ProjectRealtimeError> {
        self.assert_open()?;
        let projects = self
            .catalog
            .list_project_data()
            .map_err(|_| ProjectRealtimeError::CatalogUnavailable)?;
        let mut restored_project_ids = Vec::new();
        let mut failed_project_ids = Vec::new();
        for data in projects {
            if data.project.state != ProjectDisplayState::Focus {
                continue;
            }
            match self.focus_project(&data.project.id) {
                Ok(status) if status.watch_mode != ProjectRuntimeWatchMode::Stopped => {
                    restored_project_ids.push(data.project.id);
                }
                Ok(_) | Err(_) => failed_project_ids.push(data.project.id),
            }
        }
        Ok(ProjectRestoreResult {
            restored_project_ids,
            failed_project_ids,
        })
    }

    /// 聚焦一个已登记项目，先刷新快照再建立监听。
    pub fn focus_project(
        &self,
        project_id: &str,
    ) -> Result<ProjectRuntimeStatus, ProjectRealtimeError> {
        let project_lock = self.project_lock(project_id)?;
        let _guard = project_lock
            .lock()
            .map_err(|_| ProjectRealtimeError::StateUnavailable)?;
        if self.has_runtime(project_id)? {
            return Ok(self.get_runtime_status(project_id));
        }

        let refresh_result = self
            .catalog
            .refresh_project(project_id)
            .map_err(|_| ProjectRealtimeError::CatalogUnavailable)?;
        match refresh_result.status {
            ProjectRefreshStatus::NotFound => return Err(ProjectRealtimeError::ProjectNotFound),
            ProjectRefreshStatus::Unavailable => {
                self.publish_unavailable(project_id);
                return Ok(self.get_runtime_status(project_id));
            }
            ProjectRefreshStatus::Refreshed => {}
        }
        let project = refresh_result
            .project
            .ok_or(ProjectRealtimeError::CatalogUnavailable)?;
        let runtime = self.start_runtime(&project, project_id)?;
        self.insert_runtime(project_id, runtime)?;

        if self
            .catalog
            .update_project_state(project_id, ProjectDisplayState::Focus)
            .map_err(|_| ProjectRealtimeError::CatalogUnavailable)?
            .is_none()
        {
            let _ = self.deactivate_project(project_id);
            return Err(ProjectRealtimeError::ProjectNotFound);
        }
        let status = self.get_runtime_status(project_id);
        self.events.publish(ProjectRealtimeEventInput {
            event_type: ProjectRealtimeEventType::ProjectFocused,
            project_id,
            resource: ProjectEventResource::Project,
            scope: ProjectInvalidationScope::All,
            watch_mode: status.watch_mode,
        });
        Ok(status)
    }

    /// 将项目移出焦点并释放对应监听资源。
    pub fn unfocus_project(&self, project_id: &str) -> Result<(), ProjectRealtimeError> {
        let project_lock = self.project_lock(project_id)?;
        let _guard = project_lock
            .lock()
            .map_err(|_| ProjectRealtimeError::StateUnavailable)?;
        if self
            .catalog
            .update_project_state(project_id, ProjectDisplayState::History)
            .map_err(|_| ProjectRealtimeError::CatalogUnavailable)?
            .is_none()
        {
            return Err(ProjectRealtimeError::ProjectNotFound);
        }
        self.deactivate_project(project_id)
    }

    /// 手动刷新项目快照，不自动改变焦点状态。
    pub fn refresh_project(
        &self,
        project_id: &str,
    ) -> Result<ProjectRefreshResult, ProjectRealtimeError> {
        let project_lock = self.project_lock(project_id)?;
        let _guard = project_lock
            .lock()
            .map_err(|_| ProjectRealtimeError::StateUnavailable)?;
        let result = self
            .catalog
            .refresh_project(project_id)
            .map_err(|_| ProjectRealtimeError::CatalogUnavailable)?;
        if result.status == ProjectRefreshStatus::NotFound {
            return Err(ProjectRealtimeError::ProjectNotFound);
        }
        if result.status == ProjectRefreshStatus::Unavailable {
            self.deactivate_project(project_id)?;
            self.publish_unavailable(project_id);
            return Ok(result);
        }
        let watch_mode = self.get_runtime_status(project_id).watch_mode;
        self.publish_reindexed(project_id, watch_mode, ProjectInvalidationScope::All);
        Ok(result)
    }

    /// 返回单个项目当前的进程内监听状态。
    #[must_use]
    pub fn get_runtime_status(&self, project_id: &str) -> ProjectRuntimeStatus {
        self.state.lock().map_or_else(
            |_| stopped_runtime(project_id),
            |state| {
                state.runtimes.get(project_id).map_or_else(
                    || stopped_runtime(project_id),
                    |runtime| ProjectRuntimeStatus {
                        project_id: project_id.to_owned(),
                        watch_mode: runtime.watch_mode,
                        realtime: runtime.watch_mode == ProjectRuntimeWatchMode::Native,
                        pending_changes: runtime.pending_paths.len(),
                    },
                )
            },
        )
    }

    /// 返回当前活动项目监听器数量。
    #[must_use]
    pub fn active_watcher_count(&self) -> usize {
        self.state.lock().map_or(0, |state| state.runtimes.len())
    }

    /// 停止接收新任务，等待事件线程并关闭全部监听器。
    pub fn close(&self) -> Result<(), ProjectRealtimeError> {
        let runtimes = {
            let mut state = self.lock_state()?;
            if state.closing {
                return Ok(());
            }
            state.closing = true;
            state
                .runtimes
                .drain()
                .map(|(_, runtime)| runtime)
                .collect::<Vec<_>>()
        };
        let mut watcher_close_failed = false;
        for mut runtime in runtimes {
            if runtime.watcher.close().is_err() {
                watcher_close_failed = true;
            }
        }
        let _ = self.sender.send(RealtimeMessage::Shutdown);
        let worker = self
            .worker
            .lock()
            .map_err(|_| ProjectRealtimeError::StateUnavailable)?
            .take();
        if let Some(worker) = worker {
            worker
                .join()
                .map_err(|_| ProjectRealtimeError::StateUnavailable)?;
        }
        if watcher_close_failed {
            Err(ProjectRealtimeError::WatcherUnavailable)
        } else {
            Ok(())
        }
    }

    fn start_runtime(
        &self,
        project: &RegisteredProject,
        project_id: &str,
    ) -> Result<ActiveProjectRuntime, ProjectRealtimeError> {
        match self.start_watcher(project, project_id, ProjectRuntimeWatchMode::Native) {
            Ok(runtime) => Ok(runtime),
            Err(_) => self.start_watcher(project, project_id, ProjectRuntimeWatchMode::Polling),
        }
    }

    fn start_watcher(
        &self,
        project: &RegisteredProject,
        project_id: &str,
        watch_mode: ProjectRuntimeWatchMode,
    ) -> Result<ActiveProjectRuntime, ProjectRealtimeError> {
        let sender = self.sender.clone();
        let callback_project_id = project_id.to_owned();
        let callback = Arc::new(move |event| match event {
            ProjectWatcherEvent::Paths(paths) => {
                let _ = sender.send(RealtimeMessage::Paths {
                    project_id: callback_project_id.clone(),
                    paths,
                });
            }
            ProjectWatcherEvent::Failed => {
                let _ = sender.send(RealtimeMessage::WatcherFailed {
                    project_id: callback_project_id.clone(),
                });
            }
        });
        let mut watcher = self.watcher_factory.create(ProjectFileWatcherOptions {
            project_root: PathBuf::from(&project.path),
            mode: watch_mode,
            polling_interval: self.polling_interval,
            callback,
        });
        watcher
            .start()
            .map_err(|_| ProjectRealtimeError::WatcherUnavailable)?;
        Ok(ActiveProjectRuntime {
            project_root: PathBuf::from(&project.path),
            watcher,
            watch_mode,
            pending_paths: HashSet::new(),
        })
    }

    fn queue_paths(
        &self,
        project_id: &str,
        paths: Vec<PathBuf>,
    ) -> Result<bool, ProjectRealtimeError> {
        let mut state = self.lock_state()?;
        if state.closing {
            return Ok(false);
        }
        let Some(runtime) = state.runtimes.get_mut(project_id) else {
            return Ok(false);
        };
        let normalized_paths = paths
            .into_iter()
            .filter_map(|path| normalize_watched_path(&runtime.project_root, &path));
        runtime.pending_paths.extend(normalized_paths);
        Ok(!runtime.pending_paths.is_empty())
    }

    fn process_file_batch(&self, project_id: &str) -> Result<(), ProjectRealtimeError> {
        let project_lock = self.project_lock(project_id)?;
        let _guard = project_lock
            .lock()
            .map_err(|_| ProjectRealtimeError::StateUnavailable)?;
        let (changed_paths, watch_mode) = {
            let mut state = self.lock_state()?;
            let Some(runtime) = state.runtimes.get_mut(project_id) else {
                return Ok(());
            };
            (
                runtime.pending_paths.drain().collect::<Vec<_>>(),
                runtime.watch_mode,
            )
        };
        if changed_paths.is_empty() {
            return Ok(());
        }
        let refresh_result = self
            .catalog
            .refresh_project(project_id)
            .map_err(|_| ProjectRealtimeError::CatalogUnavailable)?;
        if refresh_result.status == ProjectRefreshStatus::Unavailable {
            self.deactivate_project(project_id)?;
            self.publish_unavailable(project_id);
            return Ok(());
        }
        if refresh_result.status == ProjectRefreshStatus::NotFound {
            self.deactivate_project(project_id)?;
            return Err(ProjectRealtimeError::ProjectNotFound);
        }
        let changes = classify_changed_resources(&changed_paths);
        if changes.spec {
            self.events.publish(ProjectRealtimeEventInput {
                event_type: ProjectRealtimeEventType::SpecChanged,
                project_id,
                resource: ProjectEventResource::Spec,
                scope: ProjectInvalidationScope::Tree,
                watch_mode,
            });
        }
        if changes.tasks {
            self.events.publish(ProjectRealtimeEventInput {
                event_type: ProjectRealtimeEventType::TasksChanged,
                project_id,
                resource: ProjectEventResource::Tasks,
                scope: ProjectInvalidationScope::Summary,
                watch_mode,
            });
        }
        if changes.project {
            self.events.publish(ProjectRealtimeEventInput {
                event_type: ProjectRealtimeEventType::ProjectInvalidated,
                project_id,
                resource: ProjectEventResource::Project,
                scope: ProjectInvalidationScope::Summary,
                watch_mode,
            });
        }
        self.events.publish(ProjectRealtimeEventInput {
            event_type: ProjectRealtimeEventType::ProjectReindexed,
            project_id,
            resource: ProjectEventResource::Project,
            scope: ProjectInvalidationScope::All,
            watch_mode,
        });
        Ok(())
    }

    fn handle_watcher_failure(&self, project_id: &str) -> Result<(), ProjectRealtimeError> {
        let project_lock = self.project_lock(project_id)?;
        let _guard = project_lock
            .lock()
            .map_err(|_| ProjectRealtimeError::StateUnavailable)?;
        let watch_mode = self.get_runtime_status(project_id).watch_mode;
        if watch_mode == ProjectRuntimeWatchMode::Stopped {
            return Ok(());
        }
        if watch_mode == ProjectRuntimeWatchMode::Polling {
            self.deactivate_project(project_id)?;
            self.publish_reindexed(
                project_id,
                ProjectRuntimeWatchMode::Stopped,
                ProjectInvalidationScope::All,
            );
            return Ok(());
        }

        let refresh_result = self
            .catalog
            .refresh_project(project_id)
            .map_err(|_| ProjectRealtimeError::CatalogUnavailable)?;
        if refresh_result.status == ProjectRefreshStatus::Unavailable {
            self.deactivate_project(project_id)?;
            self.publish_unavailable(project_id);
            return Ok(());
        }
        let project = refresh_result
            .project
            .ok_or(ProjectRealtimeError::ProjectNotFound)?;
        self.deactivate_project(project_id)?;
        let runtime =
            match self.start_watcher(&project, project_id, ProjectRuntimeWatchMode::Polling) {
                Ok(runtime) => runtime,
                Err(error) => {
                    self.publish_reindexed(
                        project_id,
                        ProjectRuntimeWatchMode::Stopped,
                        ProjectInvalidationScope::All,
                    );
                    return Err(error);
                }
            };
        self.insert_runtime(project_id, runtime)?;
        self.publish_reindexed(
            project_id,
            ProjectRuntimeWatchMode::Polling,
            ProjectInvalidationScope::All,
        );
        Ok(())
    }

    fn publish_unavailable(&self, project_id: &str) {
        self.events.publish(ProjectRealtimeEventInput {
            event_type: ProjectRealtimeEventType::ProjectUnavailable,
            project_id,
            resource: ProjectEventResource::Project,
            scope: ProjectInvalidationScope::All,
            watch_mode: ProjectRuntimeWatchMode::Stopped,
        });
    }

    fn publish_reindexed(
        &self,
        project_id: &str,
        watch_mode: ProjectRuntimeWatchMode,
        scope: ProjectInvalidationScope,
    ) {
        self.events.publish(ProjectRealtimeEventInput {
            event_type: ProjectRealtimeEventType::ProjectInvalidated,
            project_id,
            resource: ProjectEventResource::Project,
            scope,
            watch_mode,
        });
        self.events.publish(ProjectRealtimeEventInput {
            event_type: ProjectRealtimeEventType::ProjectReindexed,
            project_id,
            resource: ProjectEventResource::Project,
            scope: ProjectInvalidationScope::All,
            watch_mode,
        });
    }

    fn deactivate_project(&self, project_id: &str) -> Result<(), ProjectRealtimeError> {
        let runtime = self.lock_state()?.runtimes.remove(project_id);
        if let Some(mut runtime) = runtime {
            runtime
                .watcher
                .close()
                .map_err(|_| ProjectRealtimeError::WatcherUnavailable)?;
        }
        Ok(())
    }

    fn insert_runtime(
        &self,
        project_id: &str,
        runtime: ActiveProjectRuntime,
    ) -> Result<(), ProjectRealtimeError> {
        self.lock_state()?
            .runtimes
            .insert(project_id.to_owned(), runtime);
        Ok(())
    }

    fn has_runtime(&self, project_id: &str) -> Result<bool, ProjectRealtimeError> {
        Ok(self.lock_state()?.runtimes.contains_key(project_id))
    }

    fn project_lock(&self, project_id: &str) -> Result<Arc<Mutex<()>>, ProjectRealtimeError> {
        let mut state = self.lock_state()?;
        if state.closing {
            return Err(ProjectRealtimeError::Closing);
        }
        Ok(Arc::clone(
            state
                .project_locks
                .entry(project_id.to_owned())
                .or_insert_with(|| Arc::new(Mutex::new(()))),
        ))
    }

    fn assert_open(&self) -> Result<(), ProjectRealtimeError> {
        if self.lock_state()?.closing {
            Err(ProjectRealtimeError::Closing)
        } else {
            Ok(())
        }
    }

    fn lock_state(&self) -> Result<MutexGuard<'_, RealtimeState>, ProjectRealtimeError> {
        self.state
            .lock()
            .map_err(|_| ProjectRealtimeError::StateUnavailable)
    }
}

fn worker_loop(manager: Weak<ProjectRealtimeManager>, receiver: mpsc::Receiver<RealtimeMessage>) {
    let mut deadlines = HashMap::<String, Instant>::new();
    loop {
        let timeout = next_timeout(&deadlines);
        match receiver.recv_timeout(timeout) {
            Ok(RealtimeMessage::Paths { project_id, paths }) => {
                if let Some(manager) = manager.upgrade()
                    && manager.queue_paths(&project_id, paths).unwrap_or(false)
                {
                    deadlines.insert(project_id, Instant::now() + manager.debounce);
                }
            }
            Ok(RealtimeMessage::WatcherFailed { project_id }) => {
                if let Some(manager) = manager.upgrade() {
                    let _ = manager.handle_watcher_failure(&project_id);
                }
            }
            Ok(RealtimeMessage::Shutdown) | Err(mpsc::RecvTimeoutError::Disconnected) => break,
            Err(mpsc::RecvTimeoutError::Timeout) => {}
        }

        let now = Instant::now();
        let due_project_ids = deadlines
            .iter()
            .filter_map(|(project_id, deadline)| (*deadline <= now).then_some(project_id.clone()))
            .collect::<Vec<_>>();
        for project_id in due_project_ids {
            deadlines.remove(&project_id);
            if let Some(manager) = manager.upgrade() {
                let _ = manager.process_file_batch(&project_id);
            }
        }
        if manager.upgrade().is_none() {
            break;
        }
    }
}

fn next_timeout(deadlines: &HashMap<String, Instant>) -> Duration {
    deadlines
        .values()
        .min()
        .map_or(Duration::from_secs(60), |deadline| {
            deadline.saturating_duration_since(Instant::now())
        })
}

fn normalize_watched_path(project_root: &Path, absolute_path: &Path) -> Option<String> {
    if !absolute_path.is_absolute() {
        return None;
    }
    let relative_path = absolute_path.strip_prefix(project_root).ok()?;
    let relative_path = relative_path.to_str()?.replace('\\', "/");
    let allowed = relative_path == ".trellis/spec"
        || relative_path.starts_with(".trellis/spec/")
        || relative_path == ".trellis/tasks"
        || relative_path.starts_with(".trellis/tasks/")
        || relative_path == ".trellis/config.yaml"
        || relative_path == ".trellis/workflow.md";
    allowed.then_some(relative_path)
}

struct ChangedResources {
    spec: bool,
    tasks: bool,
    project: bool,
}

fn classify_changed_resources(changed_paths: &[String]) -> ChangedResources {
    let mut changes = ChangedResources {
        spec: false,
        tasks: false,
        project: false,
    };
    for relative_path in changed_paths {
        if relative_path == ".trellis/spec" || relative_path.starts_with(".trellis/spec/") {
            changes.spec = true;
        } else if relative_path == ".trellis/tasks" || relative_path.starts_with(".trellis/tasks/")
        {
            changes.tasks = true;
        } else {
            changes.project = true;
        }
    }
    changes
}

fn stopped_runtime(project_id: &str) -> ProjectRuntimeStatus {
    ProjectRuntimeStatus {
        project_id: project_id.to_owned(),
        watch_mode: ProjectRuntimeWatchMode::Stopped,
        realtime: false,
        pending_changes: 0,
    }
}
