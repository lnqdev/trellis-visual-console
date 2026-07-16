import type {
  ProjectError,
  ProjectSnapshot,
  ProjectSnapshotsFile,
  RegisteredProject,
  SnapshotDiagnostic,
} from "../storage/models.js";
import { createApplicationStorage, type ApplicationStorage } from "../storage/application-storage.js";
import type {
  ProjectDiscoveryCandidate,
  ProjectCatalogData,
  ProjectRefreshResult,
  ProjectRegistrationResult,
  ProjectScanResult,
  ValidatedTrellisProject,
} from "./project-models.js";
import { ProjectScanner } from "./project-scanner.js";
import { TrellisIndexer } from "./trellis-indexer.js";
import { ProjectValidator } from "./project-validator.js";

/** 编排项目扫描、索引、生命周期和应用注册表持久化。 */
export class ProjectCatalog {
  private storageQueue: Promise<void> = Promise.resolve();

  /** 创建项目目录服务。 */
  constructor(
    private readonly storage: ApplicationStorage = createApplicationStorage(),
    private readonly validator = new ProjectValidator(),
    private readonly scanner = new ProjectScanner(validator),
    private readonly indexer = new TrellisIndexer(),
  ) {}

  /**
   * 扫描目录并生成未持久化候选。
   *
   * @param scanRoot 扫描根目录
   * @returns 候选项目、摘要和扫描诊断
   */
  async scan(scanRoot: string): Promise<ProjectScanResult> {
    const scanResult = await this.scanner.scan(scanRoot);
    const candidates: ProjectDiscoveryCandidate[] = [];

    for (const project of scanResult.projects) {
      const snapshot = await this.indexer.index(project);
      candidates.push({
        project: createRegisteredProject(project, snapshot, null, null),
        snapshot,
      });
    }

    return { candidates, diagnostics: scanResult.diagnostics };
  }

  /**
   * 校验、索引并登记一个项目。
   *
   * @param projectPath 项目根目录
   * @param label 可选显示名称
   * @returns 新增、更新或无效结果
   */
  async registerProject(projectPath: string, label?: string): Promise<ProjectRegistrationResult> {
    return this.enqueueStorageOperation(async () => {
      const validation = await this.validator.validate(projectPath);
      if (!validation.valid || validation.project === null) {
        return {
          status: "invalid",
          project: null,
          snapshot: null,
          diagnostics: validation.diagnostics,
        };
      }

      const validatedProject = validation.project;
      const snapshot = await this.indexer.index(validatedProject);
      const initialization = await this.storage.initialize();
      const existingProject = initialization.registry.projects.find(
        (project) => project.path === validatedProject.projectRoot,
      );

      const registeredProject = createRegisteredProject(
        validatedProject,
        snapshot,
        existingProject ?? null,
        label ?? null,
      );
      assertNoIdentityCollision(initialization.registry.projects, registeredProject);

      const snapshots: ProjectSnapshotsFile = {
        version: initialization.snapshots.version,
        snapshots: {
          ...initialization.snapshots.snapshots,
          [registeredProject.id]: snapshot,
        },
      };
      const projects = existingProject
        ? initialization.registry.projects.map((project) =>
            project.path === registeredProject.path ? registeredProject : project,
          )
        : [...initialization.registry.projects, registeredProject];

      // 快照先落盘；注册表失败时最多留下无引用快照，不会出现无快照的新注册项。
      await this.storage.snapshots.save(snapshots);
      await this.storage.registry.save({ version: initialization.registry.version, projects });

      return {
        status: existingProject ? "updated" : "added",
        project: registeredProject,
        snapshot,
        diagnostics: snapshot.diagnostics,
      };
    });
  }

  /** 按调用顺序批量登记项目。 */
  async registerProjects(
    projects: Array<{ path: string; label?: string }>,
  ): Promise<ProjectRegistrationResult[]> {
    const results: ProjectRegistrationResult[] = [];
    for (const project of projects) {
      results.push(await this.registerProject(project.path, project.label));
    }
    return results;
  }

  /** 返回当前注册表中的项目列表。 */
  async listProjects(): Promise<RegisteredProject[]> {
    return this.enqueueStorageOperation(async () => {
      const initialization = await this.storage.initialize();
      return initialization.registry.projects;
    });
  }

  /** 返回注册表项目与最后快照的只读配对，不访问源项目。 */
  async listProjectData(): Promise<ProjectCatalogData[]> {
    return this.enqueueStorageOperation(async () => {
      const initialization = await this.storage.initialize();
      return initialization.registry.projects.map((project) => ({
        project,
        snapshot: initialization.snapshots.snapshots[project.id] ?? null,
      }));
    });
  }

  /** 返回单个已登记项目和最后快照，不访问源项目。 */
  async getProjectData(projectId: string): Promise<ProjectCatalogData | null> {
    return this.enqueueStorageOperation(async () => {
      const initialization = await this.storage.initialize();
      const project = initialization.registry.projects.find((item) => item.id === projectId);
      return project === undefined
        ? null
        : {
            project,
            snapshot: initialization.snapshots.snapshots[project.id] ?? null,
          };
    });
  }

  /**
   * 重新校验并索引一个已登记项目。
   *
   * @param projectId 稳定项目 ID
   * @returns 新快照、不可用状态或未找到结果
   */
  async refreshProject(projectId: string): Promise<ProjectRefreshResult> {
    return this.enqueueStorageOperation(async () => {
      const initialization = await this.storage.initialize();
      const existingProject = initialization.registry.projects.find(
        (project) => project.id === projectId,
      );
      if (existingProject === undefined) {
        return {
          status: "not-found",
          project: null,
          snapshot: null,
          diagnostics: [],
        };
      }

      const validation = await this.validator.validate(existingProject.path);
      if (!validation.valid || validation.project === null) {
        const occurredAt = new Date().toISOString();
        const unavailableProject: RegisteredProject = {
          ...existingProject,
          state: "unavailable",
          lastAccessedAt: occurredAt,
          error: createProjectError(validation.diagnostics, occurredAt),
        };
        const projects = initialization.registry.projects.map((project) =>
          project.id === projectId ? unavailableProject : project,
        );

        // 项目不可用时只更新注册表，旧快照必须原样保留。
        await this.storage.registry.save({ version: initialization.registry.version, projects });
        return {
          status: "unavailable",
          project: unavailableProject,
          snapshot: initialization.snapshots.snapshots[projectId] ?? null,
          diagnostics: validation.diagnostics,
        };
      }

      const snapshot = await this.indexer.index(validation.project);
      const refreshedProject: RegisteredProject = {
        ...existingProject,
        path: validation.project.projectRoot,
        lastAccessedAt: snapshot.indexedAt,
        lastIndexedAt: snapshot.indexedAt,
        error: createProjectError(snapshot.diagnostics, snapshot.indexedAt),
      };
      const snapshots: ProjectSnapshotsFile = {
        version: initialization.snapshots.version,
        snapshots: {
          ...initialization.snapshots.snapshots,
          [projectId]: snapshot,
        },
      };
      const projects = initialization.registry.projects.map((project) =>
        project.id === projectId ? refreshedProject : project,
      );

      await this.storage.snapshots.save(snapshots);
      await this.storage.registry.save({ version: initialization.registry.version, projects });
      return {
        status: "refreshed",
        project: refreshedProject,
        snapshot,
        diagnostics: snapshot.diagnostics,
      };
    });
  }

  /** 将已登记项目切换为焦点或历史状态。 */
  async updateProjectState(
    projectId: string,
    state: "focus" | "history",
  ): Promise<RegisteredProject | null> {
    return this.enqueueStorageOperation(async () => {
      const initialization = await this.storage.initialize();
      const existingProject = initialization.registry.projects.find(
        (project) => project.id === projectId,
      );
      if (existingProject === undefined) {
        return null;
      }

      const updatedProject: RegisteredProject = { ...existingProject, state };
      const projects = initialization.registry.projects.map((project) =>
        project.id === projectId ? updatedProject : project,
      );
      await this.storage.registry.save({ version: initialization.registry.version, projects });
      return updatedProject;
    });
  }

  /** 将跨注册表和快照的读改写放入同一串行队列。 */
  private enqueueStorageOperation<T>(operation: () => Promise<T>): Promise<T> {
    const result = this.storageQueue.then(operation);
    this.storageQueue = result.then(
      () => undefined,
      () => undefined,
    );
    return result;
  }
}

/** 创建候选或已登记项目记录。 */
function createRegisteredProject(
  project: ValidatedTrellisProject,
  snapshot: ProjectSnapshot,
  existingProject: RegisteredProject | null,
  label: string | null,
): RegisteredProject {
  const normalizedLabel = label?.trim() || existingProject?.label || project.label;
  return {
    id: existingProject?.id ?? project.id,
    path: project.projectRoot,
    label: normalizedLabel,
    state: existingProject?.state ?? "history",
    lastAccessedAt: snapshot.indexedAt,
    lastIndexedAt: snapshot.indexedAt,
    error: createProjectError(snapshot.diagnostics, snapshot.indexedAt),
  };
}

/** 将第一条错误诊断压缩为注册表错误摘要。 */
function createProjectError(
  diagnostics: SnapshotDiagnostic[],
  occurredAt: string,
): ProjectError | null {
  const error = diagnostics.find((diagnostic) => diagnostic.severity === "error");
  return error
    ? {
        code: error.code,
        message: error.message,
        occurredAt,
      }
    : null;
}

/** 防止极低概率的稳定 ID 碰撞覆盖另一个项目。 */
function assertNoIdentityCollision(
  projects: RegisteredProject[],
  candidate: RegisteredProject,
): void {
  const collision = projects.find(
    (project) => project.id === candidate.id && project.path !== candidate.path,
  );
  if (collision) {
    throw new Error("项目稳定 ID 冲突，拒绝覆盖已有项目");
  }
}
