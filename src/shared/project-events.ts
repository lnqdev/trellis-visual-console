/** 项目实时事件的稳定类型集合。 */
export const PROJECT_REALTIME_EVENT_TYPES = [
  "project-focused",
  "project-invalidated",
  "spec-changed",
  "tasks-changed",
  "project-unavailable",
  "project-reindexed",
] as const;

/** 项目实时事件类型。 */
export type ProjectRealtimeEventType = (typeof PROJECT_REALTIME_EVENT_TYPES)[number];

/** 事件指向的只读资源类型。 */
export type ProjectEventResource = "project" | "spec" | "tasks";

/** 页面重新查询数据时使用的失效范围。 */
export type ProjectInvalidationScope = "all" | "summary" | "tree";

/** 项目文件变化的监听模式。 */
export type ProjectWatchMode = "native" | "polling";

/** 项目运行时可能处于的完整监听状态。 */
export type ProjectRuntimeWatchMode = ProjectWatchMode | "stopped";

/** 后续 SSE 路由和 Web UI 共同复用的轻量事件合同。 */
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
  return value === "project" || value === "spec" || value === "tasks";
}

/** 判断未知值是否为合法失效范围。 */
function isProjectInvalidationScope(value: unknown): value is ProjectInvalidationScope {
  return value === "all" || value === "summary" || value === "tree";
}

/** 判断未知值是否为合法运行时监听状态。 */
function isProjectRuntimeWatchMode(value: unknown): value is ProjectRuntimeWatchMode {
  return value === "stopped" || value === "native" || value === "polling";
}
