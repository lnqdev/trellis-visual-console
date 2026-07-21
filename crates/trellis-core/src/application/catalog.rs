use std::path::{Path, PathBuf};
use std::sync::{Mutex, MutexGuard};

use time::{OffsetDateTime, format_description::well_known::Rfc3339};

use crate::contracts::{
    ProjectRegisterInput, ProjectRegistrationResult, ProjectRegistrationStatus,
    ProjectScanCandidate, ProjectScanResponse,
};
use crate::projects::{ProjectScanner, ProjectValidator, TrellisIndexer, ValidatedTrellisProject};
use crate::storage::{
    ApplicationStorage, ProjectDisplayState, ProjectError, ProjectRegistryFile, ProjectSnapshot,
    ProjectSnapshotsFile, RegisteredProject, SnapshotDiagnostic, SnapshotSeverity, StorageError,
};

/// 注册表项目与可空摘要快照的只读配对。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectCatalogData {
    pub project: RegisteredProject,
    pub snapshot: Option<ProjectSnapshot>,
}

/// 已登记项目刷新结果状态。
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum ProjectRefreshStatus {
    Refreshed,
    Unavailable,
    NotFound,
}

/// 已登记项目重新校验和索引后的结果。
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ProjectRefreshResult {
    pub status: ProjectRefreshStatus,
    pub project: Option<RegisteredProject>,
    pub snapshot: Option<ProjectSnapshot>,
    pub diagnostics: Vec<SnapshotDiagnostic>,
}

/// 项目目录与应用存储编排期间的稳定领域错误。
#[derive(Debug, thiserror::Error)]
pub enum ProjectCatalogError {
    #[error("应用数据操作失败")]
    Storage(#[from] StorageError),
    #[error("项目目录操作队列不可用")]
    QueueUnavailable,
    #[error("项目稳定 ID 冲突")]
    IdentityCollision,
}

/// 编排项目扫描、索引、生命周期和应用注册表持久化。
pub struct ProjectCatalog {
    storage: ApplicationStorage,
    validator: ProjectValidator,
    scanner: ProjectScanner,
    indexer: TrellisIndexer,
    operation_lock: Mutex<()>,
    migration_rebuild_project_ids: Mutex<Vec<String>>,
}

impl ProjectCatalog {
    /// 使用桌面适配层解析出的应用数据目录创建并初始化项目目录。
    pub fn new(data_directory: PathBuf) -> Result<Self, ProjectCatalogError> {
        let storage = ApplicationStorage::new(data_directory);
        let initialization = storage.initialize()?;
        // 迁移提交后若进程提前退出，下次启动仍能通过缺失快照识别并继续重建。
        let migration_rebuild_project_ids = initialization
            .registry
            .projects
            .iter()
            .filter(|project| !initialization.snapshots.snapshots.contains_key(&project.id))
            .map(|project| project.id.clone())
            .collect();
        Ok(Self {
            storage,
            validator: ProjectValidator::new(),
            scanner: ProjectScanner::new(),
            indexer: TrellisIndexer::new(),
            operation_lock: Mutex::new(()),
            migration_rebuild_project_ids: Mutex::new(migration_rebuild_project_ids),
        })
    }

    /// 扫描目录并生成未持久化候选。
    pub fn scan(&self, scan_root: &Path) -> ProjectScanResponse {
        let discovery = self.scanner.scan(scan_root);
        let candidates = discovery
            .projects
            .iter()
            .map(|project| {
                let snapshot = self.indexer.index(project);
                ProjectScanCandidate {
                    project: create_registered_project(project, &snapshot, None, None),
                    snapshot,
                }
            })
            .collect();
        ProjectScanResponse {
            candidates,
            diagnostics: discovery.diagnostics,
        }
    }

    /// 按调用顺序校验、索引并登记一个或多个项目。
    pub fn register_projects(
        &self,
        projects: &[ProjectRegisterInput],
    ) -> Result<Vec<ProjectRegistrationResult>, ProjectCatalogError> {
        let _guard = self.lock_operations()?;
        projects
            .iter()
            .map(|project| self.register_project_locked(project))
            .collect()
    }

    /// 返回注册表项目与最后快照的只读配对，不访问源项目。
    pub fn list_project_data(&self) -> Result<Vec<ProjectCatalogData>, ProjectCatalogError> {
        let _guard = self.lock_operations()?;
        let initialization = self.storage.initialize()?;
        Ok(initialization
            .registry
            .projects
            .into_iter()
            .map(|project| ProjectCatalogData {
                snapshot: initialization.snapshots.snapshots.get(&project.id).cloned(),
                project,
            })
            .collect())
    }

    /// 返回单个已登记项目和最后快照，不访问源项目。
    pub fn get_project_data(
        &self,
        project_id: &str,
    ) -> Result<Option<ProjectCatalogData>, ProjectCatalogError> {
        let _guard = self.lock_operations()?;
        let initialization = self.storage.initialize()?;
        Ok(initialization
            .registry
            .projects
            .into_iter()
            .find(|project| project.id == project_id)
            .map(|project| ProjectCatalogData {
                snapshot: initialization.snapshots.snapshots.get(&project.id).cloned(),
                project,
            }))
    }

    /// 重新校验并索引一个已登记项目。
    pub fn refresh_project(
        &self,
        project_id: &str,
    ) -> Result<ProjectRefreshResult, ProjectCatalogError> {
        let _guard = self.lock_operations()?;
        self.refresh_project_locked(project_id)
    }

    /// 将已登记项目切换为焦点或历史状态。
    pub fn update_project_state(
        &self,
        project_id: &str,
        state: ProjectDisplayState,
    ) -> Result<Option<RegisteredProject>, ProjectCatalogError> {
        let _guard = self.lock_operations()?;
        let initialization = self.storage.initialize()?;
        let Some(existing_project) = initialization
            .registry
            .projects
            .iter()
            .find(|project| project.id == project_id)
        else {
            return Ok(None);
        };
        let mut updated_project = existing_project.clone();
        updated_project.state = state;
        let projects = initialization
            .registry
            .projects
            .into_iter()
            .map(|project| {
                if project.id == project_id {
                    updated_project.clone()
                } else {
                    project
                }
            })
            .collect();
        self.storage.registry().save(&ProjectRegistryFile {
            version: initialization.registry.version,
            projects,
        })?;
        Ok(Some(updated_project))
    }

    /// 重建版本迁移后被明确标记为不可信的旧快照。
    pub fn rebuild_migrated_projects(&self) -> Result<usize, ProjectCatalogError> {
        let project_ids = {
            let mut pending = self.lock_migration_rebuild_ids()?;
            std::mem::take(&mut *pending)
        };
        let mut rebuilt_count = 0;
        for project_id in project_ids {
            if self
                .get_project_data(&project_id)?
                .is_some_and(|data| data.snapshot.is_some())
            {
                continue;
            }
            if self.refresh_project(&project_id)?.status == ProjectRefreshStatus::Refreshed {
                rebuilt_count += 1;
            }
        }
        Ok(rebuilt_count)
    }

    fn register_project_locked(
        &self,
        input: &ProjectRegisterInput,
    ) -> Result<ProjectRegistrationResult, ProjectCatalogError> {
        let validation = self.validator.validate(Path::new(&input.path));
        let Some(validated_project) = validation.project else {
            return Ok(ProjectRegistrationResult {
                status: ProjectRegistrationStatus::Invalid,
                project: None,
                snapshot: None,
                diagnostics: validation.diagnostics,
            });
        };
        let snapshot = self.indexer.index(&validated_project);
        let initialization = self.storage.initialize()?;
        let existing_project = initialization
            .registry
            .projects
            .iter()
            .find(|project| project.path == validated_project.project_root.to_string_lossy())
            .cloned();
        let registered_project = create_registered_project(
            &validated_project,
            &snapshot,
            existing_project.as_ref(),
            input.label.as_deref(),
        );
        assert_no_identity_collision(&initialization.registry.projects, &registered_project)?;

        let mut snapshots = initialization.snapshots.snapshots;
        snapshots.insert(registered_project.id.clone(), snapshot.clone());
        let projects = if existing_project.is_some() {
            initialization
                .registry
                .projects
                .into_iter()
                .map(|project| {
                    if project.path == registered_project.path {
                        registered_project.clone()
                    } else {
                        project
                    }
                })
                .collect()
        } else {
            initialization
                .registry
                .projects
                .into_iter()
                .chain(std::iter::once(registered_project.clone()))
                .collect()
        };

        // 快照先落盘；注册表失败时最多留下无引用快照，不会出现无快照的新注册项。
        self.storage.snapshots().save(&ProjectSnapshotsFile {
            version: initialization.snapshots.version,
            snapshots,
        })?;
        self.storage.registry().save(&ProjectRegistryFile {
            version: initialization.registry.version,
            projects,
        })?;
        Ok(ProjectRegistrationResult {
            status: if existing_project.is_some() {
                ProjectRegistrationStatus::Updated
            } else {
                ProjectRegistrationStatus::Added
            },
            project: Some(registered_project),
            snapshot: Some(snapshot.clone()),
            diagnostics: snapshot.diagnostics,
        })
    }

    fn refresh_project_locked(
        &self,
        project_id: &str,
    ) -> Result<ProjectRefreshResult, ProjectCatalogError> {
        let initialization = self.storage.initialize()?;
        let Some(existing_project) = initialization
            .registry
            .projects
            .iter()
            .find(|project| project.id == project_id)
            .cloned()
        else {
            return Ok(ProjectRefreshResult {
                status: ProjectRefreshStatus::NotFound,
                project: None,
                snapshot: None,
                diagnostics: Vec::new(),
            });
        };
        let validation = self.validator.validate(Path::new(&existing_project.path));
        let Some(validated_project) = validation.project else {
            let occurred_at = now_iso();
            let mut unavailable_project = existing_project;
            unavailable_project.state = ProjectDisplayState::Unavailable;
            unavailable_project.last_accessed_at = Some(occurred_at.clone());
            unavailable_project.error = create_project_error(&validation.diagnostics, &occurred_at);
            let projects = initialization
                .registry
                .projects
                .into_iter()
                .map(|project| {
                    if project.id == project_id {
                        unavailable_project.clone()
                    } else {
                        project
                    }
                })
                .collect();

            // 项目不可用时只更新注册表，旧快照必须原样保留。
            self.storage.registry().save(&ProjectRegistryFile {
                version: initialization.registry.version,
                projects,
            })?;
            return Ok(ProjectRefreshResult {
                status: ProjectRefreshStatus::Unavailable,
                project: Some(unavailable_project),
                snapshot: initialization.snapshots.snapshots.get(project_id).cloned(),
                diagnostics: validation.diagnostics,
            });
        };

        let snapshot = self.indexer.index(&validated_project);
        let mut refreshed_project = existing_project;
        refreshed_project.path = validated_project
            .project_root
            .to_string_lossy()
            .into_owned();
        if refreshed_project.state == ProjectDisplayState::Unavailable {
            refreshed_project.state = ProjectDisplayState::History;
        }
        refreshed_project.last_accessed_at = Some(snapshot.indexed_at.clone());
        refreshed_project.last_indexed_at = Some(snapshot.indexed_at.clone());
        refreshed_project.error = create_project_error(&snapshot.diagnostics, &snapshot.indexed_at);
        let mut snapshots = initialization.snapshots.snapshots;
        snapshots.insert(project_id.to_owned(), snapshot.clone());
        let projects = initialization
            .registry
            .projects
            .into_iter()
            .map(|project| {
                if project.id == project_id {
                    refreshed_project.clone()
                } else {
                    project
                }
            })
            .collect();
        self.storage.snapshots().save(&ProjectSnapshotsFile {
            version: initialization.snapshots.version,
            snapshots,
        })?;
        self.storage.registry().save(&ProjectRegistryFile {
            version: initialization.registry.version,
            projects,
        })?;
        Ok(ProjectRefreshResult {
            status: ProjectRefreshStatus::Refreshed,
            project: Some(refreshed_project),
            snapshot: Some(snapshot.clone()),
            diagnostics: snapshot.diagnostics,
        })
    }

    fn lock_operations(&self) -> Result<MutexGuard<'_, ()>, ProjectCatalogError> {
        self.operation_lock
            .lock()
            .map_err(|_| ProjectCatalogError::QueueUnavailable)
    }

    fn lock_migration_rebuild_ids(
        &self,
    ) -> Result<MutexGuard<'_, Vec<String>>, ProjectCatalogError> {
        self.migration_rebuild_project_ids
            .lock()
            .map_err(|_| ProjectCatalogError::QueueUnavailable)
    }
}

fn create_registered_project(
    project: &ValidatedTrellisProject,
    snapshot: &ProjectSnapshot,
    existing_project: Option<&RegisteredProject>,
    label: Option<&str>,
) -> RegisteredProject {
    let normalized_label = label
        .map(str::trim)
        .filter(|label| !label.is_empty())
        .or_else(|| existing_project.map(|project| project.label.as_str()))
        .unwrap_or(&project.label)
        .to_owned();
    RegisteredProject {
        id: existing_project.map_or_else(|| project.id.clone(), |project| project.id.clone()),
        path: project.project_root.to_string_lossy().into_owned(),
        label: normalized_label,
        state: existing_project.map_or(ProjectDisplayState::History, |project| project.state),
        last_accessed_at: Some(snapshot.indexed_at.clone()),
        last_indexed_at: Some(snapshot.indexed_at.clone()),
        error: create_project_error(&snapshot.diagnostics, &snapshot.indexed_at),
    }
}

fn create_project_error(
    diagnostics: &[SnapshotDiagnostic],
    occurred_at: &str,
) -> Option<ProjectError> {
    diagnostics
        .iter()
        .find(|diagnostic| diagnostic.severity == SnapshotSeverity::Error)
        .map(|diagnostic| ProjectError {
            code: diagnostic.code.clone(),
            message: diagnostic.message.clone(),
            occurred_at: occurred_at.to_owned(),
        })
}

fn assert_no_identity_collision(
    projects: &[RegisteredProject],
    candidate: &RegisteredProject,
) -> Result<(), ProjectCatalogError> {
    if projects
        .iter()
        .any(|project| project.id == candidate.id && project.path != candidate.path)
    {
        Err(ProjectCatalogError::IdentityCollision)
    } else {
        Ok(())
    }
}

fn now_iso() -> String {
    OffsetDateTime::now_utc()
        .format(&Rfc3339)
        .unwrap_or_else(|_| "1970-01-01T00:00:00Z".to_owned())
}
