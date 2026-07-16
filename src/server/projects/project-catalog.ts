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
  ProjectRegistrationResult,
  ProjectScanResult,
  ValidatedTrellisProject,
} from "./project-models.js";
import { ProjectScanner } from "./project-scanner.js";
import { TrellisIndexer } from "./trellis-indexer.js";
import { ProjectValidator } from "./project-validator.js";

/** 编排项目扫描、索引和应用注册表持久化。 */
export class ProjectCatalog {
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
    const validation = await this.validator.validate(projectPath);
    if (!validation.valid || validation.project === null) {
      return {
        status: "invalid",
        project: null,
        snapshot: null,
        diagnostics: validation.diagnostics,
      };
    }

    const snapshot = await this.indexer.index(validation.project);
    const initialization = await this.storage.initialize();
    const existingProject = initialization.registry.projects.find(
      (project) => project.path === validation.project?.projectRoot,
    );

    const registeredProject = createRegisteredProject(
      validation.project,
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
