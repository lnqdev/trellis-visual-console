/** 项目实时事件的稳定类型集合。 */
export const PROJECT_REALTIME_EVENT_TYPES = [
  "project-focused",
  "project-invalidated",
  "spec-changed",
  "tasks-changed",
  "project-unavailable",
  "project-reindexed",
] as const;

/** 实时事件资源类型集合。 */
export const PROJECT_EVENT_RESOURCES = ["project", "spec", "tasks"] as const;

/** 事件失效范围集合。 */
export const PROJECT_INVALIDATION_SCOPES = ["all", "summary", "tree"] as const;

/** 实际活动文件监听模式集合。 */
export const PROJECT_WATCH_MODES = ["native", "polling"] as const;

/** 包含停止状态的完整运行时监听模式集合。 */
export const PROJECT_RUNTIME_WATCH_MODES = ["stopped", ...PROJECT_WATCH_MODES] as const;

/** 项目实时事件类型。 */
export type ProjectRealtimeEventType = (typeof PROJECT_REALTIME_EVENT_TYPES)[number];

/** 事件指向的只读资源类型。 */
export type ProjectEventResource = (typeof PROJECT_EVENT_RESOURCES)[number];

/** 页面重新查询数据时使用的失效范围。 */
export type ProjectInvalidationScope = (typeof PROJECT_INVALIDATION_SCOPES)[number];

/** 项目文件变化的监听模式。 */
export type ProjectWatchMode = (typeof PROJECT_WATCH_MODES)[number];

/** 项目运行时可能处于的完整监听状态。 */
export type ProjectRuntimeWatchMode = (typeof PROJECT_RUNTIME_WATCH_MODES)[number];

/** Core、桌面事件适配层和 Web UI 共同复用的轻量事件合同。 */
export interface ProjectRealtimeEvent {
  id: string;
  type: ProjectRealtimeEventType;
  projectId: string;
  resource: ProjectEventResource;
  scope: ProjectInvalidationScope;
  timestamp: string;
  watchMode: ProjectRuntimeWatchMode;
}

/** 单个项目的进程内监听状态。 */
export interface ProjectRuntimeStatus {
  projectId: string;
  watchMode: ProjectRuntimeWatchMode;
  realtime: boolean;
  pendingChanges: number;
}

/** 判断未知值是否符合项目实时事件合同。 */
export function isProjectRealtimeEvent(value: unknown): value is ProjectRealtimeEvent {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    typeof candidate.id === "string" &&
    PROJECT_REALTIME_EVENT_TYPES.includes(candidate.type as ProjectRealtimeEventType) &&
    typeof candidate.projectId === "string" &&
    isProjectEventResource(candidate.resource) &&
    isProjectInvalidationScope(candidate.scope) &&
    typeof candidate.timestamp === "string" &&
    isProjectRuntimeWatchMode(candidate.watchMode)
  );
}

/** 判断未知值是否为合法资源类型。 */
function isProjectEventResource(value: unknown): value is ProjectEventResource {
  return PROJECT_EVENT_RESOURCES.includes(value as ProjectEventResource);
}

/** 判断未知值是否为合法失效范围。 */
function isProjectInvalidationScope(value: unknown): value is ProjectInvalidationScope {
  return PROJECT_INVALIDATION_SCOPES.includes(value as ProjectInvalidationScope);
}

/** 判断未知值是否为合法运行时监听状态。 */
function isProjectRuntimeWatchMode(value: unknown): value is ProjectRuntimeWatchMode {
  return PROJECT_RUNTIME_WATCH_MODES.includes(value as ProjectRuntimeWatchMode);
}
