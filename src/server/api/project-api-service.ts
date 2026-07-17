import {
  ProjectActionResponseSchema,
  ProjectDetailResponseSchema,
  ProjectDocumentResponseSchema,
  ProjectListResponseSchema,
  ProjectRegisterResponseSchema,
  ProjectScanResponseSchema,
  TaskDetailResponseSchema,
  type ProjectActionResponse,
  type ProjectDetailResponse,
  type ProjectDocumentResponse,
  type ProjectListItem,
  type ProjectListResponse,
  type ProjectRegisterInput,
  type ProjectRegisterResponse,
  type ProjectScanResponse,
  type TaskDetailResponse,
} from "../../shared/api.js";
import { ProjectCatalog } from "../projects/project-catalog.js";
import type { ProjectCatalogData } from "../projects/project-models.js";
import { readProjectMarkdown } from "../projects/markdown-reader.js";
import { openProjectSourcePath } from "../projects/project-file-opener.js";
import {
  readProjectTaskDetail,
  readProjectTaskDocument,
} from "../projects/task-reader.js";
import { ProjectRealtimeManager } from "../realtime/project-realtime-manager.js";
import type { SpecTreeNode } from "../storage/models.js";

/** API 查询的项目不存在。 */
export class ProjectApiNotFoundError extends Error {
  /** 创建项目不存在错误。 */
  constructor(message: string) {
    super(message);
    this.name = "ProjectApiNotFoundError";
  }
}

/** 当前项目状态不允许读取源文件正文。 */
export class ProjectApiContentUnavailableError extends Error {
  /** 创建正文读取不可用错误。 */
  constructor() {
    super("当前项目尚未显式刷新或加入焦点，不能读取完整正文");
    this.name = "ProjectApiContentUnavailableError";
  }
}

/** 编排项目 API 所需的存储、实时状态和受保护内容读取。 */
export class ProjectApiService {
  private readonly refreshedHistoryProjects = new Set<string>();

  /** 创建项目 API 服务。 */
  constructor(
    private readonly catalog: ProjectCatalog,
    private readonly realtimeManager: ProjectRealtimeManager,
  ) {}

  /** 返回全部已登记项目和运行时状态。 */
  async listProjects(): Promise<ProjectListResponse> {
    const projectData = await this.catalog.listProjectData();
    return ProjectListResponseSchema.parse({
      projects: projectData.map((data) => this.createProjectListItem(data)),
    });
  }

  /** 扫描目录并返回未持久化候选。 */
  async scanProjects(rootPath: string): Promise<ProjectScanResponse> {
    const result = await this.catalog.scan(rootPath);
    return ProjectScanResponseSchema.parse(result);
  }

  /** 登记一个或多个已选择项目。 */
  async registerProjects(projects: ProjectRegisterInput[]): Promise<ProjectRegisterResponse> {
    const results = await this.catalog.registerProjects(
      projects.map((project) =>
        project.label === undefined
          ? { path: project.path }
          : { path: project.path, label: project.label },
      ),
    );
    return ProjectRegisterResponseSchema.parse({ results });
  }

  /** 返回单个项目的注册项、运行时状态和最后快照。 */
  async getProject(projectId: string): Promise<ProjectDetailResponse> {
    const data = await this.requireProjectData(projectId);
    return this.createProjectDetail(data);
  }

  /** 切换项目焦点状态并返回最新详情。 */
  async setProjectFocus(projectId: string, focused: boolean): Promise<ProjectActionResponse> {
    if (focused) {
      await this.realtimeManager.focusProject(projectId);
    } else {
      await this.realtimeManager.unfocusProject(projectId);
    }
    // 移出焦点后立即恢复为纯摘要历史项目；焦点项目本身不需要临时授权。
    this.refreshedHistoryProjects.delete(projectId);
    return ProjectActionResponseSchema.parse(await this.getProject(projectId));
  }

  /** 显式刷新项目并返回最新详情。 */
  async refreshProject(projectId: string): Promise<ProjectActionResponse> {
    const result = await this.realtimeManager.refreshProject(projectId);
    if (result.status === "refreshed" && result.project?.state === "history") {
      // 历史项目只有经过本进程内的用户显式刷新后，才临时开放按需正文读取。
      this.refreshedHistoryProjects.add(projectId);
    } else {
      this.refreshedHistoryProjects.delete(projectId);
    }
    return ProjectActionResponseSchema.parse(await this.getProject(projectId));
  }

  /** 读取快照 Spec 树中已知的 Markdown 文档。 */
  async readSpecDocument(projectId: string, sourcePath: string): Promise<ProjectDocumentResponse> {
    const data = await this.requireReadableProjectData(projectId);
    if (data.snapshot === null || !containsSpecFile(data.snapshot.specTree, sourcePath)) {
      throw new ProjectApiNotFoundError("当前项目快照中不存在指定 Spec 文档");
    }

    const document = await readProjectMarkdown(data.project.path, sourcePath);
    return ProjectDocumentResponseSchema.parse({ ...document, format: "markdown" });
  }

  /** 返回快照中已知 Task 的文档清单。 */
  async readTaskDetail(projectId: string, taskSourcePath: string): Promise<TaskDetailResponse> {
    const data = await this.requireReadableProjectData(projectId);
    if (data.snapshot === null) {
      throw new ProjectApiNotFoundError("当前项目没有可用快照");
    }

    const detail = await readProjectTaskDetail(
      data.project.path,
      data.snapshot,
      taskSourcePath,
    );
    return TaskDetailResponseSchema.parse({ projectId, ...detail });
  }

  /** 读取 Task 清单中已知的 Markdown 或 JSONL 文档。 */
  async readTaskDocument(
    projectId: string,
    taskSourcePath: string,
    documentPath: string,
  ): Promise<ProjectDocumentResponse> {
    const data = await this.requireReadableProjectData(projectId);
    if (data.snapshot === null) {
      throw new ProjectApiNotFoundError("当前项目没有可用快照");
    }

    const document = await readProjectTaskDocument(
      data.project.path,
      data.snapshot,
      taskSourcePath,
      documentPath,
    );
    return ProjectDocumentResponseSchema.parse(document);
  }

  /** 将项目目录或合法 `.trellis` 源路径交给系统外部应用打开。 */
  async openProjectPath(projectId: string, sourcePath?: string): Promise<void> {
    const data = await this.requireProjectData(projectId);
    await openProjectSourcePath(data.project.path, sourcePath);
  }

  /** 要求项目已登记并返回缓存数据。 */
  private async requireProjectData(projectId: string): Promise<ProjectCatalogData> {
    const data = await this.catalog.getProjectData(projectId);
    if (data === null) {
      throw new ProjectApiNotFoundError("未找到指定项目");
    }
    return data;
  }

  /** 要求项目已显式刷新或处于焦点状态，避免历史项目直接访问源文件正文。 */
  private async requireReadableProjectData(projectId: string): Promise<ProjectCatalogData> {
    const data = await this.requireProjectData(projectId);
    if (!this.isProjectContentReadable(data)) {
      throw new ProjectApiContentUnavailableError();
    }
    return data;
  }

  /** 判断项目是否已通过焦点状态或本进程显式刷新获得正文读取资格。 */
  private isProjectContentReadable(data: ProjectCatalogData): boolean {
    return data.project.state === "focus" ||
      (data.project.state === "history" && this.refreshedHistoryProjects.has(data.project.id));
  }

  /** 将存储数据与运行时监听状态投影为列表单项。 */
  private createProjectListItem(data: ProjectCatalogData): ProjectListItem {
    const runtime = this.realtimeManager.getRuntimeStatus(data.project.id);
    return {
      project: data.project,
      runtime,
      hasSnapshot: data.snapshot !== null,
      possiblyStale: data.project.state !== "focus" || runtime.watchMode !== "native",
      activeTaskCount: data.snapshot?.tasks.active.length ?? 0,
      archivedTaskCount: data.snapshot?.tasks.archived.length ?? 0,
      diagnosticCount: data.snapshot?.diagnostics.length ?? 0,
    };
  }

  /** 将存储数据投影为单项目详情。 */
  private createProjectDetail(data: ProjectCatalogData): ProjectDetailResponse {
    const runtime = this.realtimeManager.getRuntimeStatus(data.project.id);
    return ProjectDetailResponseSchema.parse({
      project: data.project,
      runtime,
      snapshot: data.snapshot,
      possiblyStale: data.project.state !== "focus" || runtime.watchMode !== "native",
      contentReadable: this.isProjectContentReadable(data),
    });
  }
}

/** 递归判断 Spec 树是否包含指定 Markdown 文件。 */
function containsSpecFile(nodes: SpecTreeNode[], sourcePath: string): boolean {
  return nodes.some(
    (node) =>
      (node.kind === "file" && node.relativePath === sourcePath) ||
      (node.kind === "directory" && containsSpecFile(node.children, sourcePath)),
  );
}
