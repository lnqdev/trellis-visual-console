//! 桌面与未来 Web 适配层共享的应用服务入口。

pub(crate) mod catalog;

use std::collections::{HashMap, HashSet};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex, MutexGuard};
use std::time::Duration;

use catalog::{ProjectCatalog, ProjectCatalogData, ProjectCatalogError, ProjectRefreshStatus};

use crate::contracts::{
    CommandError, ProjectActionResponse, ProjectDetailResponse, ProjectListItem,
    ProjectListResponse, ProjectRegisterInput, ProjectRegisterResponse, ProjectRuntimeWatchMode,
    ProjectScanResponse, TaskCenterItem, TaskCenterResponse, TaskCollection, TaskDetailResponse,
};
use crate::projects::{
    ProjectReadError, UnsafeProjectPathError, read_project_markdown, read_project_task_detail,
    read_project_task_document,
};
use crate::realtime::{
    EventSink, NoopEventSink, ProjectFileWatcherFactory, ProjectRealtimeError,
    ProjectRealtimeManager, ProjectRestoreResult,
};
use crate::storage::{ProjectDisplayState, SpecTreeNode, SpecTreeNodeKind};

/// Trellis 业务能力的统一应用服务。
pub struct ApplicationService {
    catalog: Arc<ProjectCatalog>,
    realtime: Arc<ProjectRealtimeManager>,
    refreshed_history_projects: Mutex<HashSet<String>>,
}

impl ApplicationService {
    /// 使用桌面适配层解析出的应用数据目录创建并初始化应用服务。
    pub fn new(data_directory: PathBuf) -> Result<Self, CommandError> {
        Self::with_event_sink(data_directory, Arc::new(NoopEventSink))
    }

    /// 使用指定事件 adapter 创建并初始化应用服务。
    pub fn with_event_sink(
        data_directory: PathBuf,
        event_sink: Arc<dyn EventSink>,
    ) -> Result<Self, CommandError> {
        let catalog = Arc::new(ProjectCatalog::new(data_directory)?);
        let realtime = ProjectRealtimeManager::new(Arc::clone(&catalog), event_sink)?;
        Ok(Self {
            catalog,
            realtime,
            refreshed_history_projects: Mutex::new(HashSet::new()),
        })
    }

    /// 使用可注入 watcher 和时间参数创建应用服务，供平台适配与隔离验证使用。
    pub fn with_realtime_options(
        data_directory: PathBuf,
        event_sink: Arc<dyn EventSink>,
        watcher_factory: Arc<dyn ProjectFileWatcherFactory>,
        debounce: Duration,
        polling_interval: Duration,
    ) -> Result<Self, CommandError> {
        let catalog = Arc::new(ProjectCatalog::new(data_directory)?);
        let realtime = ProjectRealtimeManager::with_options(
            Arc::clone(&catalog),
            event_sink,
            watcher_factory,
            debounce,
            polling_interval,
        )?;
        Ok(Self {
            catalog,
            realtime,
            refreshed_history_projects: Mutex::new(HashSet::new()),
        })
    }

    /// 返回全部已登记项目和运行时状态。
    pub fn list_projects(&self) -> Result<ProjectListResponse, CommandError> {
        let project_data = self.catalog.list_project_data()?;
        Ok(ProjectListResponse {
            projects: project_data
                .iter()
                .map(|data| create_project_list_item(data, &self.realtime))
                .collect(),
        })
    }

    /// 返回全部项目元数据和可聚合的扁平 Task 摘要。
    pub fn list_tasks(&self) -> Result<TaskCenterResponse, CommandError> {
        let project_data = self.catalog.list_project_data()?;
        let projects = project_data
            .iter()
            .map(|data| create_project_list_item(data, &self.realtime))
            .collect();
        let tasks = project_data
            .iter()
            .flat_map(create_task_center_items)
            .collect();
        Ok(TaskCenterResponse { projects, tasks })
    }

    /// 返回单个项目的注册项、运行时状态和最后快照。
    pub fn get_project(&self, project_id: &str) -> Result<ProjectDetailResponse, CommandError> {
        let data = self.require_project_data(project_id)?;
        self.create_project_detail(data)
    }

    /// 扫描目录并返回未持久化候选。
    pub fn scan_projects(&self, root_path: &str) -> ProjectScanResponse {
        self.catalog.scan(Path::new(root_path))
    }

    /// 登记一个或多个已选择项目。
    pub fn register_projects(
        &self,
        projects: Vec<ProjectRegisterInput>,
    ) -> Result<ProjectRegisterResponse, CommandError> {
        if projects.is_empty() {
            return Err(CommandError::new(
                "invalid-request",
                "至少需要提供一个待登记项目",
            ));
        }
        Ok(ProjectRegisterResponse {
            results: self.catalog.register_projects(&projects)?,
        })
    }

    /// 切换项目焦点状态并返回最新详情。
    pub fn set_project_focus(
        &self,
        project_id: &str,
        focused: bool,
    ) -> Result<ProjectActionResponse, CommandError> {
        if focused {
            self.realtime.focus_project(project_id)?;
        } else {
            self.realtime.unfocus_project(project_id)?;
        }
        // 焦点项目本身不需要临时授权；移出焦点后立即恢复为纯摘要历史项目。
        self.clear_content_authorization(project_id)?;
        self.get_project(project_id)
    }

    /// 显式刷新项目并返回最新详情。
    pub fn refresh_project(&self, project_id: &str) -> Result<ProjectActionResponse, CommandError> {
        let result = self.realtime.refresh_project(project_id)?;
        match result.status {
            ProjectRefreshStatus::NotFound => return Err(project_not_found()),
            ProjectRefreshStatus::Refreshed
                if result
                    .project
                    .as_ref()
                    .is_some_and(|project| project.state == ProjectDisplayState::History) =>
            {
                self.lock_content_authorizations()?
                    .insert(project_id.to_owned());
            }
            ProjectRefreshStatus::Refreshed | ProjectRefreshStatus::Unavailable => {
                self.clear_content_authorization(project_id)?;
            }
        }
        self.get_project(project_id)
    }

    /// 读取快照 Spec 树中已知的 Markdown 文档。
    pub fn read_spec_document(
        &self,
        project_id: &str,
        source_path: &str,
    ) -> Result<crate::contracts::ProjectDocumentResponse, CommandError> {
        let data = self.require_readable_project_data(project_id)?;
        if data
            .snapshot
            .as_ref()
            .is_none_or(|snapshot| !contains_spec_file(&snapshot.spec_tree, source_path))
        {
            return Err(CommandError::new(
                "resource-not-found",
                "当前项目快照中不存在指定 Spec 文档",
            ));
        }
        Ok(read_project_markdown(
            Path::new(&data.project.path),
            source_path,
        )?)
    }

    /// 返回快照中已知 Task 的文档清单。
    pub fn read_task_detail(
        &self,
        project_id: &str,
        task_source_path: &str,
    ) -> Result<TaskDetailResponse, CommandError> {
        let data = self.require_readable_project_data(project_id)?;
        let snapshot = data
            .snapshot
            .ok_or_else(|| CommandError::new("resource-not-found", "当前项目没有可用快照"))?;
        Ok(read_project_task_detail(
            Path::new(&data.project.path),
            &snapshot,
            task_source_path,
        )?)
    }

    /// 读取 Task 清单中已知的 Markdown 或 JSONL 文档。
    pub fn read_task_document(
        &self,
        project_id: &str,
        task_source_path: &str,
        document_path: &str,
    ) -> Result<crate::contracts::ProjectDocumentResponse, CommandError> {
        let data = self.require_readable_project_data(project_id)?;
        let snapshot = data
            .snapshot
            .ok_or_else(|| CommandError::new("resource-not-found", "当前项目没有可用快照"))?;
        Ok(read_project_task_document(
            Path::new(&data.project.path),
            &snapshot,
            task_source_path,
            document_path,
        )?)
    }

    /// 解析已登记项目根目录或 `.trellis` 内受保护源路径，供系统 adapter 打开。
    pub fn resolve_open_project_path(
        &self,
        project_id: &str,
        source_path: Option<&str>,
    ) -> Result<PathBuf, CommandError> {
        let data = self.require_project_data(project_id)?;
        let project_root = Path::new(&data.project.path);
        let Some(source_path) = source_path else {
            let metadata = std::fs::symlink_metadata(project_root)
                .map_err(|_| CommandError::new("project-access-denied", "项目根目录无法访问"))?;
            if metadata.file_type().is_symlink() || !metadata.is_dir() {
                return Err(CommandError::new(
                    "unsafe-project-path",
                    "项目根目录无效或为符号链接",
                ));
            }
            return std::fs::canonicalize(project_root)
                .map_err(|_| CommandError::new("project-access-denied", "项目根目录无法访问"));
        };
        let normalized_path = crate::projects::normalize_project_relative_path(source_path)?;
        if !normalized_path.starts_with(".trellis/") {
            return Err(CommandError::new(
                "unsafe-project-path",
                "只允许打开项目 .trellis 内的源路径",
            ));
        }
        let safe_path =
            crate::projects::resolve_safe_project_path(project_root, &normalized_path, ".trellis")?;
        if !safe_path.metadata.is_file() && !safe_path.metadata.is_dir() {
            return Err(CommandError::new(
                "unsafe-project-path",
                "源路径不是普通文件或目录",
            ));
        }
        Ok(safe_path.real_path)
    }

    /// 后台重建版本迁移后不再信任的旧快照。
    pub fn rebuild_migrated_projects(&self) -> Result<usize, CommandError> {
        Ok(self.catalog.rebuild_migrated_projects()?)
    }

    /// 启动时恢复注册表中持久化的焦点项目集合。
    pub fn restore_focus_projects(&self) -> Result<ProjectRestoreResult, CommandError> {
        Ok(self.realtime.restore_focus_projects()?)
    }

    /// 停止接收实时任务并释放全部 watcher 和事件线程。
    pub fn close(&self) -> Result<(), CommandError> {
        Ok(self.realtime.close()?)
    }

    /// 返回当前活动项目 watcher 数量，供生命周期指标和隔离验证使用。
    #[must_use]
    pub fn active_watcher_count(&self) -> usize {
        self.realtime.active_watcher_count()
    }

    fn require_project_data(&self, project_id: &str) -> Result<ProjectCatalogData, CommandError> {
        self.catalog
            .get_project_data(project_id)?
            .ok_or_else(project_not_found)
    }

    fn require_readable_project_data(
        &self,
        project_id: &str,
    ) -> Result<ProjectCatalogData, CommandError> {
        let data = self.require_project_data(project_id)?;
        if !self.is_project_content_readable(&data)? {
            return Err(CommandError::new(
                "project-content-unavailable",
                "当前项目尚未显式刷新或加入焦点，不能读取完整正文",
            ));
        }
        Ok(data)
    }

    fn is_project_content_readable(&self, data: &ProjectCatalogData) -> Result<bool, CommandError> {
        Ok(data.project.state == ProjectDisplayState::Focus
            || (data.project.state == ProjectDisplayState::History
                && self
                    .lock_content_authorizations()?
                    .contains(&data.project.id)))
    }

    fn create_project_detail(
        &self,
        data: ProjectCatalogData,
    ) -> Result<ProjectDetailResponse, CommandError> {
        let runtime = self.realtime.get_runtime_status(&data.project.id);
        Ok(ProjectDetailResponse {
            possibly_stale: data.project.state != ProjectDisplayState::Focus
                || runtime.watch_mode != ProjectRuntimeWatchMode::Native,
            content_readable: self.is_project_content_readable(&data)?,
            project: data.project,
            runtime,
            snapshot: data.snapshot,
        })
    }

    fn clear_content_authorization(&self, project_id: &str) -> Result<(), CommandError> {
        self.lock_content_authorizations()?.remove(project_id);
        Ok(())
    }

    fn lock_content_authorizations(&self) -> Result<MutexGuard<'_, HashSet<String>>, CommandError> {
        self.refreshed_history_projects.lock().map_err(|_| {
            CommandError::new(
                "application-state-unavailable",
                "应用运行状态不可用，请重启客户端",
            )
        })
    }
}

impl From<ProjectCatalogError> for CommandError {
    fn from(error: ProjectCatalogError) -> Self {
        match error {
            ProjectCatalogError::Storage(error) => error.into(),
            ProjectCatalogError::QueueUnavailable => Self::new(
                "storage-queue-unavailable",
                "项目数据操作队列不可用，请重启客户端",
            ),
            ProjectCatalogError::IdentityCollision => Self::new(
                "project-identity-collision",
                "项目稳定 ID 冲突，拒绝覆盖已有项目",
            ),
        }
    }
}

impl From<ProjectReadError> for CommandError {
    fn from(error: ProjectReadError) -> Self {
        match error {
            ProjectReadError::UnsafePath(error) => error.into(),
            ProjectReadError::TaskNotFound => {
                Self::new("resource-not-found", "当前项目快照中不存在指定 Task")
            }
            ProjectReadError::TaskDocumentNotFound => {
                Self::new("resource-not-found", "当前 Task 中不存在指定文档")
            }
            ProjectReadError::TaskDirectoryUnreadable => {
                Self::new("project-access-denied", "Task 文档目录无法读取")
            }
        }
    }
}

impl From<ProjectRealtimeError> for CommandError {
    fn from(error: ProjectRealtimeError) -> Self {
        match error {
            ProjectRealtimeError::ProjectNotFound => project_not_found(),
            ProjectRealtimeError::Closing => {
                Self::new("application-closing", "客户端正在关闭，已拒绝新的项目操作")
            }
            ProjectRealtimeError::WatcherUnavailable => {
                Self::new("project-watcher-unavailable", "项目文件监听器不可用")
            }
            ProjectRealtimeError::StateUnavailable => Self::new(
                "application-state-unavailable",
                "应用运行状态不可用，请重启客户端",
            ),
            ProjectRealtimeError::CatalogUnavailable => {
                Self::new("project-operation-failed", "项目数据操作失败，请重试")
            }
        }
    }
}

impl From<UnsafeProjectPathError> for CommandError {
    fn from(error: UnsafeProjectPathError) -> Self {
        Self::new("unsafe-project-path", error.to_string())
    }
}

fn create_project_list_item(
    data: &ProjectCatalogData,
    realtime: &ProjectRealtimeManager,
) -> ProjectListItem {
    let runtime = realtime.get_runtime_status(&data.project.id);
    ProjectListItem {
        possibly_stale: data.project.state != ProjectDisplayState::Focus
            || runtime.watch_mode != ProjectRuntimeWatchMode::Native,
        active_task_count: data
            .snapshot
            .as_ref()
            .map_or(0, |snapshot| snapshot.tasks.active.len()),
        archived_task_count: data
            .snapshot
            .as_ref()
            .map_or(0, |snapshot| snapshot.tasks.archived.len()),
        diagnostic_count: data
            .snapshot
            .as_ref()
            .map_or(0, |snapshot| snapshot.diagnostics.len()),
        project: data.project.clone(),
        runtime,
        has_snapshot: data.snapshot.is_some(),
    }
}

fn create_task_center_items(data: &ProjectCatalogData) -> Vec<TaskCenterItem> {
    if data.project.state == ProjectDisplayState::Unavailable || data.snapshot.is_none() {
        return Vec::new();
    }
    let snapshot = data.snapshot.as_ref().expect("已检查快照存在");
    let title_by_source_path: HashMap<&str, &str> = snapshot
        .tasks
        .active
        .iter()
        .chain(&snapshot.tasks.archived)
        .map(|task| (task.source_path.as_str(), task.title.as_str()))
        .collect();
    snapshot
        .tasks
        .active
        .iter()
        .map(|task| (TaskCollection::Active, task))
        .chain(
            snapshot
                .tasks
                .archived
                .iter()
                .map(|task| (TaskCollection::Archived, task)),
        )
        .map(|(collection, task)| TaskCenterItem {
            project_id: data.project.id.clone(),
            collection,
            parent_title: task
                .parent_source_path
                .as_deref()
                .and_then(|path| title_by_source_path.get(path).copied())
                .map(str::to_owned),
            task: task.clone(),
        })
        .collect()
}

fn contains_spec_file(nodes: &[SpecTreeNode], source_path: &str) -> bool {
    nodes.iter().any(|node| {
        (node.kind == SpecTreeNodeKind::File && node.relative_path == source_path)
            || (node.kind == SpecTreeNodeKind::Directory
                && contains_spec_file(&node.children, source_path))
    })
}

fn project_not_found() -> CommandError {
    CommandError::new("resource-not-found", "未找到指定项目")
}
