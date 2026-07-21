use std::fs;
use std::path::{Path, PathBuf};
use std::sync::Arc;
use std::time::Duration;

use notify::{
    Config, Event, PollWatcher, RecommendedWatcher, RecursiveMode, Watcher, recommended_watcher,
};

use crate::contracts::ProjectRuntimeWatchMode;

/// 底层 watcher 交给实时管理器的归一事件。
#[derive(Debug)]
pub enum ProjectWatcherEvent {
    Paths(Vec<PathBuf>),
    Failed,
}

/// 单个项目 watcher 的事件回调。
pub type ProjectWatcherCallback = Arc<dyn Fn(ProjectWatcherEvent) + Send + Sync>;

/// 创建 watcher 时需要的稳定参数。
pub struct ProjectFileWatcherOptions {
    pub project_root: PathBuf,
    pub mode: ProjectRuntimeWatchMode,
    pub polling_interval: Duration,
    pub callback: ProjectWatcherCallback,
}

/// 实时管理器依赖的最小文件监听接口。
pub trait ProjectFileWatcher: Send {
    /// 启动固定 Trellis 路径监听。
    fn start(&mut self) -> Result<(), ProjectWatcherError>;

    /// 关闭底层 watcher 并释放系统资源。
    fn close(&mut self) -> Result<(), ProjectWatcherError>;
}

/// watcher 工厂端口，仓库外验证可替换为受控实现。
pub trait ProjectFileWatcherFactory: Send + Sync + 'static {
    /// 创建一个尚未启动的项目 watcher。
    fn create(&self, options: ProjectFileWatcherOptions) -> Box<dyn ProjectFileWatcher>;
}

/// `notify` watcher 无法启动或关闭。
#[derive(Debug, Clone, Copy, PartialEq, Eq, thiserror::Error)]
#[error("项目文件监听器不可用")]
pub struct ProjectWatcherError;

/// 生产环境使用的跨平台 `notify` watcher 工厂。
#[derive(Debug, Default)]
pub struct NotifyProjectFileWatcherFactory;

impl ProjectFileWatcherFactory for NotifyProjectFileWatcherFactory {
    fn create(&self, options: ProjectFileWatcherOptions) -> Box<dyn ProjectFileWatcher> {
        Box::new(NotifyProjectFileWatcher {
            options,
            watcher: None,
        })
    }
}

enum NotifyWatcherHandle {
    Native(RecommendedWatcher),
    Polling(PollWatcher),
}

impl NotifyWatcherHandle {
    fn watch(&mut self, path: &Path, mode: RecursiveMode) -> notify::Result<()> {
        match self {
            Self::Native(watcher) => watcher.watch(path, mode),
            Self::Polling(watcher) => watcher.watch(path, mode),
        }
    }
}

/// 使用 `notify` 封装原生事件和低频轮询模式。
struct NotifyProjectFileWatcher {
    options: ProjectFileWatcherOptions,
    watcher: Option<NotifyWatcherHandle>,
}

impl ProjectFileWatcher for NotifyProjectFileWatcher {
    fn start(&mut self) -> Result<(), ProjectWatcherError> {
        if self.watcher.is_some() {
            return Ok(());
        }
        let callback = Arc::clone(&self.options.callback);
        let handler = move |result: notify::Result<Event>| match result {
            Ok(event) if !event.paths.is_empty() => {
                callback(ProjectWatcherEvent::Paths(event.paths))
            }
            Ok(_) => {}
            Err(_) => callback(ProjectWatcherEvent::Failed),
        };
        let mut watcher = match self.options.mode {
            ProjectRuntimeWatchMode::Native => recommended_watcher(handler)
                .map(NotifyWatcherHandle::Native)
                .map_err(|_| ProjectWatcherError)?,
            ProjectRuntimeWatchMode::Polling => PollWatcher::new(
                handler,
                Config::default().with_poll_interval(self.options.polling_interval),
            )
            .map(NotifyWatcherHandle::Polling)
            .map_err(|_| ProjectWatcherError)?,
            ProjectRuntimeWatchMode::Stopped => return Err(ProjectWatcherError),
        };

        // Spec 与 Task 递归监听；配置和 Workflow 只监听明确文件，绝不监听整个仓库。
        let trellis_root = self.options.project_root.join(".trellis");
        watcher
            .watch(&trellis_root.join("spec"), RecursiveMode::Recursive)
            .map_err(|_| ProjectWatcherError)?;
        watcher
            .watch(&trellis_root.join("tasks"), RecursiveMode::Recursive)
            .map_err(|_| ProjectWatcherError)?;
        watcher
            .watch(
                &trellis_root.join("config.yaml"),
                RecursiveMode::NonRecursive,
            )
            .map_err(|_| ProjectWatcherError)?;
        let workflow_path = trellis_root.join("workflow.md");
        if fs::symlink_metadata(&workflow_path)
            .is_ok_and(|metadata| metadata.is_file() && !metadata.file_type().is_symlink())
        {
            watcher
                .watch(&workflow_path, RecursiveMode::NonRecursive)
                .map_err(|_| ProjectWatcherError)?;
        } else {
            // `notify` 不能直接监听不存在的文件；非递归父目录哨兵只用于捕获 Workflow 创建。
            watcher
                .watch(&trellis_root, RecursiveMode::NonRecursive)
                .map_err(|_| ProjectWatcherError)?;
        }
        self.watcher = Some(watcher);
        Ok(())
    }

    fn close(&mut self) -> Result<(), ProjectWatcherError> {
        self.watcher.take();
        Ok(())
    }
}
