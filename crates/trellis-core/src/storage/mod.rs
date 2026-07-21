//! 应用自有注册表与摘要快照的持久化边界。

mod application_storage;
mod json_file_store;
mod models;

pub use application_storage::{
    ApplicationPaths, ApplicationStorage, ApplicationStorageInitialization, StorageMigration,
};
pub use json_file_store::{
    JsonFileStore, StorageError, StorageLoadResult, StorageRecovery, StorageRecoveryReason,
};
pub use models::{
    ProjectDisplayState, ProjectError, ProjectOverviewSnapshot, ProjectPackageSnapshot,
    ProjectRegistryFile, ProjectSnapshot, ProjectSnapshotsFile, RegisteredProject, STORAGE_VERSION,
    SnapshotDiagnostic, SnapshotSeverity, SpecTreeNode, SpecTreeNodeKind, TaskCollectionSnapshot,
    TaskSummarySnapshot, VersionedStorageData, WorkflowSummarySnapshot,
};
