import { isAbsolute, resolve } from "node:path";
import type {
  ProjectRuntimeStatus,
  ProjectRuntimeWatchMode,
  ProjectWatchMode,
} from "../../shared/project-events.js";
import type { ProjectRefreshResult } from "../projects/project-models.js";
import { isPathInsideOrEqual, toProjectRelativePath } from "../projects/project-paths.js";
import { ProjectCatalog } from "../projects/project-catalog.js";
import type { RegisteredProject } from "../storage/models.js";
import { ProjectEventHub } from "./project-event-hub.js";
import {
  createProjectFileWatcher,
  type ProjectFileWatcher,
  type ProjectFileWatcherFactory,
} from "./project-file-watcher.js";

const DEFAULT_DEBOUNCE_MS = 300;
const DEFAULT_POLLING_INTERVAL_MS = 10_000;

/** 实时管理器可注入的运行参数。 */
export interface ProjectRealtimeManagerOptions {
  debounceMs?: number;
  pollingIntervalMs?: number;
  watcherFactory?: ProjectFileWatcherFactory;
  onOperationalError?: (projectId: string, error: unknown) => void;
}

/** 应用启动恢复焦点项目时的单项失败。 */
export interface ProjectRestoreFailure {
  projectId: string;
  message: string;
}

/** 应用启动恢复焦点集合后的汇总。 */
export interface ProjectRestoreResult {
  restoredProjectIds: string[];
  failures: ProjectRestoreFailure[];
}

interface ActiveProjectRuntime {
  projectRoot: string;
  watcher: ProjectFileWatcher;
  watchMode: ProjectWatchMode;
  pendingPaths: Set<string>;
  debounceTimer: NodeJS.Timeout | null;
}

/** 管理焦点项目的索引、监听、事件批处理和资源释放。 */
export class ProjectRealtimeManager {
  private readonly runtimes = new Map<string, ActiveProjectRuntime>();
  private readonly projectQueues = new Map<string, Promise<void>>();
  private readonly debounceMs: number;
  private readonly pollingIntervalMs: number;
  private readonly watcherFactory: ProjectFileWatcherFactory;
  private readonly onOperationalError: (projectId: string, error: unknown) => void;
  private closing = false;
  private closePromise: Promise<void> | null = null;

  /** 创建项目实时生命周期管理器。 */
  constructor(
    private readonly catalog: ProjectCatalog,
    public readonly events: ProjectEventHub = new ProjectEventHub(),
    options: ProjectRealtimeManagerOptions = {},
  ) {
    this.debounceMs = options.debounceMs ?? DEFAULT_DEBOUNCE_MS;
    this.pollingIntervalMs = options.pollingIntervalMs ?? DEFAULT_POLLING_INTERVAL_MS;
    this.watcherFactory = options.watcherFactory ?? createProjectFileWatcher;
    this.onOperationalError = options.onOperationalError ?? (() => undefined);
  }

  /** 启动时只恢复注册表中持久化为焦点的项目。 */
  async restoreFocusProjects(): Promise<ProjectRestoreResult> {
    this.assertOpen();
    const projects = await this.catalog.listProjects();
    const restoredProjectIds: string[] = [];
    const failures: ProjectRestoreFailure[] = [];

    for (const project of projects) {
      if (project.state !== "focus") {
        continue;
      }

      try {
        const status = await this.enqueueProjectOperation(project.id, () =>
          this.activateProject(project.id),
        );
        if (status.watchMode === "stopped") {
          failures.push({ projectId: project.id, message: "项目不可用，未恢复监听" });
        } else {
          restoredProjectIds.push(project.id);
        }
      } catch (error) {
        failures.push({ projectId: project.id, message: getErrorMessage(error) });
      }
    }

    return { restoredProjectIds, failures };
  }

  /** 聚焦一个已登记项目，先刷新快照再建立监听。 */
  async focusProject(projectId: string): Promise<ProjectRuntimeStatus> {
    this.assertOpen();
    return this.enqueueProjectOperation(projectId, () => this.activateProject(projectId));
  }

  /** 将项目移出焦点并释放对应监听资源。 */
  async unfocusProject(projectId: string): Promise<RegisteredProject> {
    this.assertOpen();
    return this.enqueueProjectOperation(projectId, async () => {
      const project = await this.catalog.updateProjectState(projectId, "history");
      if (project === null) {
        throw new Error(`未找到项目：${projectId}`);
      }

      await this.deactivateProject(projectId);
      return project;
    });
  }

  /** 手动刷新项目快照，不自动改变焦点状态。 */
  async refreshProject(projectId: string): Promise<ProjectRefreshResult> {
    this.assertOpen();
    return this.enqueueProjectOperation(projectId, async () => {
      const result = await this.catalog.refreshProject(projectId);
      if (result.status === "not-found") {
        throw new Error(`未找到项目：${projectId}`);
      }
      if (result.status === "unavailable") {
        await this.handleUnavailableProject(projectId);
        return result;
      }

      const watchMode = this.getRuntimeWatchMode(projectId);
      this.events.publish({
        type: "project-invalidated",
        projectId,
        resource: "project",
        scope: "all",
        watchMode,
      });
      this.events.publish({
        type: "project-reindexed",
        projectId,
        resource: "project",
        scope: "all",
        watchMode,
      });
      return result;
    });
  }

  /** 返回单个项目当前的进程内监听状态。 */
  getRuntimeStatus(projectId: string): ProjectRuntimeStatus {
    const runtime = this.runtimes.get(projectId);
    return runtime === undefined
      ? { projectId, watchMode: "stopped", realtime: false, pendingChanges: 0 }
      : createRuntimeStatus(projectId, runtime);
  }

  /** 返回全部活动项目的运行时监听状态。 */
  listRuntimeStatuses(): ProjectRuntimeStatus[] {
    return [...this.runtimes.entries()].map(([projectId, runtime]) =>
      createRuntimeStatus(projectId, runtime),
    );
  }

  /** 返回当前活动项目监听器数量。 */
  getActiveWatcherCount(): number {
    return this.runtimes.size;
  }

  /** 停止接收新任务并释放全部监听器、定时器和项目队列。 */
  close(): Promise<void> {
    if (this.closePromise !== null) {
      return this.closePromise;
    }

    this.closing = true;
    for (const runtime of this.runtimes.values()) {
      if (runtime.debounceTimer !== null) {
        clearTimeout(runtime.debounceTimer);
        runtime.debounceTimer = null;
      }
      runtime.pendingPaths.clear();
    }

    this.closePromise = (async () => {
      await Promise.all([...this.projectQueues.values()]);
      const runtimes = [...this.runtimes.values()];
      this.runtimes.clear();
      const closeResults = await Promise.allSettled(
        runtimes.map((runtime) => runtime.watcher.close()),
      );
      this.projectQueues.clear();

      const failedClose = closeResults.find(
        (result): result is PromiseRejectedResult => result.status === "rejected",
      );
      if (failedClose !== undefined) {
        throw failedClose.reason;
      }
    })();
    return this.closePromise;
  }

  /** 执行索引、监听启动和焦点状态持久化。 */
  private async activateProject(projectId: string): Promise<ProjectRuntimeStatus> {
    const existingRuntime = this.runtimes.get(projectId);
    if (existingRuntime !== undefined) {
      return createRuntimeStatus(projectId, existingRuntime);
    }

    const refreshResult = await this.catalog.refreshProject(projectId);
    if (refreshResult.status === "not-found") {
      throw new Error(`未找到项目：${projectId}`);
    }
    if (refreshResult.status === "unavailable" || refreshResult.project === null) {
      this.events.publish({
        type: "project-unavailable",
        projectId,
        resource: "project",
        scope: "all",
        watchMode: "stopped",
      });
      return this.getRuntimeStatus(projectId);
    }

    const runtime = await this.startRuntime(refreshResult.project);
    this.runtimes.set(projectId, runtime);

    try {
      const focusedProject = await this.catalog.updateProjectState(projectId, "focus");
      if (focusedProject === null) {
        throw new Error(`未找到项目：${projectId}`);
      }
    } catch (error) {
      await this.deactivateProject(projectId);
      throw error;
    }

    this.events.publish({
      type: "project-focused",
      projectId,
      resource: "project",
      scope: "all",
      watchMode: runtime.watchMode,
    });
    return createRuntimeStatus(projectId, runtime);
  }

  /** 优先启动原生监听，失败时明确降级为低频轮询。 */
  private async startRuntime(project: RegisteredProject): Promise<ActiveProjectRuntime> {
    try {
      const watcher = await this.startWatcher(project, "native");
      return createActiveRuntime(project.path, watcher);
    } catch (nativeError) {
      this.onOperationalError(project.id, nativeError);
      const watcher = await this.startWatcher(project, "polling");
      return createActiveRuntime(project.path, watcher);
    }
  }

  /** 创建并启动指定模式的监听器。 */
  private async startWatcher(
    project: RegisteredProject,
    mode: ProjectWatchMode,
  ): Promise<ProjectFileWatcher> {
    const watcher = this.watcherFactory({
      projectRoot: project.path,
      mode,
      pollingIntervalMs: this.pollingIntervalMs,
      onChange: (absolutePath) => this.queueFileChange(project.id, absolutePath),
      onError: (error) => this.queueWatcherError(project.id, error),
    });

    try {
      await watcher.start();
      return watcher;
    } catch (error) {
      await watcher.close().catch((closeError) => this.onOperationalError(project.id, closeError));
      throw error;
    }
  }

  /** 接收原始文件事件并按项目防抖、去重。 */
  private queueFileChange(projectId: string, absolutePath: string): void {
    if (this.closing) {
      return;
    }

    const runtime = this.runtimes.get(projectId);
    if (runtime === undefined) {
      return;
    }

    const relativePath = normalizeWatchedPath(runtime.projectRoot, absolutePath);
    if (relativePath === null) {
      return;
    }

    runtime.pendingPaths.add(relativePath);
    if (runtime.debounceTimer !== null) {
      clearTimeout(runtime.debounceTimer);
    }
    runtime.debounceTimer = setTimeout(() => {
      runtime.debounceTimer = null;
      const changedPaths = [...runtime.pendingPaths];
      runtime.pendingPaths.clear();
      void this.enqueueProjectOperation(projectId, () =>
        this.processFileBatch(projectId, changedPaths),
      ).catch((error) => this.onOperationalError(projectId, error));
    }, this.debounceMs);
  }

  /** 批量刷新项目并发布对应资源的失效事件。 */
  private async processFileBatch(projectId: string, changedPaths: string[]): Promise<void> {
    const runtime = this.runtimes.get(projectId);
    if (runtime === undefined || changedPaths.length === 0) {
      return;
    }

    const refreshResult = await this.catalog.refreshProject(projectId);
    if (refreshResult.status === "not-found") {
      await this.deactivateProject(projectId);
      throw new Error(`未找到项目：${projectId}`);
    }
    if (refreshResult.status === "unavailable") {
      await this.handleUnavailableProject(projectId);
      return;
    }

    const changes = classifyChangedResources(changedPaths);
    if (changes.spec) {
      this.events.publish({
        type: "spec-changed",
        projectId,
        resource: "spec",
        scope: "tree",
        watchMode: runtime.watchMode,
      });
    }
    if (changes.tasks) {
      this.events.publish({
        type: "tasks-changed",
        projectId,
        resource: "tasks",
        scope: "summary",
        watchMode: runtime.watchMode,
      });
    }
    if (changes.project) {
      this.events.publish({
        type: "project-invalidated",
        projectId,
        resource: "project",
        scope: "summary",
        watchMode: runtime.watchMode,
      });
    }

    this.events.publish({
      type: "project-reindexed",
      projectId,
      resource: "project",
      scope: "all",
      watchMode: runtime.watchMode,
    });
  }

  /** 将运行期原生监听错误串行转换为项目校验和轮询降级。 */
  private queueWatcherError(projectId: string, error: Error): void {
    if (this.closing) {
      return;
    }

    void this.enqueueProjectOperation(projectId, () =>
      this.degradeToPolling(projectId, error),
    ).catch((degradeError) => this.onOperationalError(projectId, degradeError));
  }

  /** 重新校验项目后，将原生监听器替换为轮询监听器。 */
  private async degradeToPolling(projectId: string, error: Error): Promise<void> {
    const runtime = this.runtimes.get(projectId);
    if (runtime === undefined || runtime.watchMode !== "native") {
      return;
    }

    this.onOperationalError(projectId, error);
    const refreshResult = await this.catalog.refreshProject(projectId);
    if (refreshResult.status === "not-found") {
      await this.deactivateProject(projectId);
      throw new Error(`未找到项目：${projectId}`);
    }
    if (refreshResult.status === "unavailable" || refreshResult.project === null) {
      await this.handleUnavailableProject(projectId);
      return;
    }

    await runtime.watcher.close().catch((closeError) =>
      this.onOperationalError(projectId, closeError),
    );
    let pollingWatcher: ProjectFileWatcher;
    try {
      pollingWatcher = await this.startWatcher(refreshResult.project, "polling");
    } catch (pollingError) {
      await this.deactivateProject(projectId);
      throw pollingError;
    }
    runtime.watcher = pollingWatcher;
    runtime.watchMode = "polling";
    runtime.projectRoot = refreshResult.project.path;

    this.events.publish({
      type: "project-invalidated",
      projectId,
      resource: "project",
      scope: "all",
      watchMode: "polling",
    });
    this.events.publish({
      type: "project-reindexed",
      projectId,
      resource: "project",
      scope: "all",
      watchMode: "polling",
    });
  }

  /** 清理不可用项目的监听资源并发布状态事件。 */
  private async handleUnavailableProject(projectId: string): Promise<void> {
    await this.deactivateProject(projectId);
    this.events.publish({
      type: "project-unavailable",
      projectId,
      resource: "project",
      scope: "all",
      watchMode: "stopped",
    });
  }

  /** 取消项目定时器、待处理路径和底层监听器。 */
  private async deactivateProject(projectId: string): Promise<void> {
    const runtime = this.runtimes.get(projectId);
    if (runtime === undefined) {
      return;
    }

    this.runtimes.delete(projectId);
    if (runtime.debounceTimer !== null) {
      clearTimeout(runtime.debounceTimer);
      runtime.debounceTimer = null;
    }
    runtime.pendingPaths.clear();
    await runtime.watcher.close();
  }

  /** 保证同一项目的状态迁移和重索引严格串行。 */
  private enqueueProjectOperation<T>(projectId: string, operation: () => Promise<T>): Promise<T> {
    const previous = this.projectQueues.get(projectId) ?? Promise.resolve();
    const result = previous.then(operation);
    const tail = result.then(
      () => undefined,
      () => undefined,
    );
    this.projectQueues.set(projectId, tail);
    void tail.finally(() => {
      if (this.projectQueues.get(projectId) === tail) {
        this.projectQueues.delete(projectId);
      }
    });
    return result;
  }

  /** 获取事件应携带的当前监听状态。 */
  private getRuntimeWatchMode(projectId: string): ProjectRuntimeWatchMode {
    return this.runtimes.get(projectId)?.watchMode ?? "stopped";
  }

  /** 拒绝在关闭流程开始后创建新的生命周期任务。 */
  private assertOpen(): void {
    if (this.closing) {
      throw new Error("项目实时管理器正在关闭");
    }
  }
}

/** 创建一个没有待处理文件事件的活动运行时。 */
function createActiveRuntime(
  projectRoot: string,
  watcher: ProjectFileWatcher,
): ActiveProjectRuntime {
  return {
    projectRoot,
    watcher,
    watchMode: watcher.mode,
    pendingPaths: new Set<string>(),
    debounceTimer: null,
  };
}

/** 将内部监听器转换为对外稳定运行时状态。 */
function createRuntimeStatus(
  projectId: string,
  runtime: ActiveProjectRuntime,
): ProjectRuntimeStatus {
  return {
    projectId,
    watchMode: runtime.watchMode,
    realtime: runtime.watchMode === "native",
    pendingChanges: runtime.pendingPaths.size,
  };
}

/** 将监听路径规范化为受限的 POSIX 风格项目相对路径。 */
function normalizeWatchedPath(projectRoot: string, filePath: string): string | null {
  const absolutePath = isAbsolute(filePath) ? resolve(filePath) : resolve(projectRoot, filePath);
  if (!isPathInsideOrEqual(projectRoot, absolutePath)) {
    return null;
  }

  const relativePath = toProjectRelativePath(projectRoot, absolutePath);
  return isAllowedWatchPath(relativePath) ? relativePath : null;
}

/** 判断规范化路径是否属于首版允许监听的 Trellis 内容。 */
function isAllowedWatchPath(relativePath: string): boolean {
  return (
    relativePath === ".trellis/spec" ||
    relativePath.startsWith(".trellis/spec/") ||
    relativePath === ".trellis/tasks" ||
    relativePath.startsWith(".trellis/tasks/") ||
    relativePath === ".trellis/config.yaml" ||
    relativePath === ".trellis/workflow.md"
  );
}

/** 将一批相对路径折叠为页面需要重新查询的资源类别。 */
function classifyChangedResources(changedPaths: string[]): {
  spec: boolean;
  tasks: boolean;
  project: boolean;
} {
  let spec = false;
  let tasks = false;
  let project = false;

  for (const relativePath of changedPaths) {
    if (relativePath === ".trellis/spec" || relativePath.startsWith(".trellis/spec/")) {
      spec = true;
    } else if (
      relativePath === ".trellis/tasks" ||
      relativePath.startsWith(".trellis/tasks/")
    ) {
      tasks = true;
    } else {
      project = true;
    }
  }

  return { spec, tasks, project };
}

/** 提取可安全记录的错误消息。 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "未知错误";
}
