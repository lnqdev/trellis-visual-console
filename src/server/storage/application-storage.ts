import {
  createEmptyProjectRegistry,
  createEmptyProjectSnapshots,
  ProjectRegistryFileSchema,
  ProjectSnapshotsFileSchema,
  STORAGE_VERSION,
  type ProjectRegistryFile,
  type ProjectSnapshotsFile,
} from "./models.js";
import { resolveApplicationPaths, type ApplicationPaths } from "./application-paths.js";
import {
  JsonFileStore,
  type StorageLoadResult,
  type StorageRecovery,
} from "./json-file-store.js";

/** 应用存储初始化后可直接使用的数据。 */
export interface ApplicationStorageInitialization {
  registry: ProjectRegistryFile;
  snapshots: ProjectSnapshotsFile;
  recoveries: StorageRecovery[];
}

/** 管理项目注册表和摘要快照两个应用自有文件。 */
export class ApplicationStorage {
  readonly registry: JsonFileStore<ProjectRegistryFile>;
  readonly snapshots: JsonFileStore<ProjectSnapshotsFile>;

  /** 创建应用存储入口。 */
  constructor(public readonly paths: ApplicationPaths) {
    this.registry = new JsonFileStore({
      filePath: paths.registryFile,
      currentVersion: STORAGE_VERSION,
      schema: ProjectRegistryFileSchema,
      createDefault: createEmptyProjectRegistry,
    });
    this.snapshots = new JsonFileStore({
      filePath: paths.snapshotsFile,
      currentVersion: STORAGE_VERSION,
      schema: ProjectSnapshotsFileSchema,
      createDefault: createEmptyProjectSnapshots,
    });
  }

  /**
   * 初始化并加载两个数据文件。
   *
   * @returns 当前注册表、摘要快照和恢复记录
   */
  async initialize(): Promise<ApplicationStorageInitialization> {
    const [registryResult, snapshotsResult] = await Promise.all([
      this.registry.load(),
      this.snapshots.load(),
    ]);

    return {
      registry: registryResult.data,
      snapshots: snapshotsResult.data,
      recoveries: collectRecoveries(registryResult, snapshotsResult),
    };
  }
}

/** 创建使用默认或指定数据目录的应用存储。 */
export function createApplicationStorage(dataDirectoryOverride?: string): ApplicationStorage {
  return new ApplicationStorage(resolveApplicationPaths(dataDirectoryOverride));
}

/** 汇总多个加载结果中的损坏恢复记录。 */
function collectRecoveries(
  ...results: Array<StorageLoadResult<ProjectRegistryFile> | StorageLoadResult<ProjectSnapshotsFile>>
): StorageRecovery[] {
  return results.flatMap((result) => (result.recovery === null ? [] : [result.recovery]));
}
