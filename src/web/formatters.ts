import type { RegisteredProjectApi, TaskSummaryApi } from "../shared/api";
import type { ProjectRuntimeWatchMode } from "../shared/project-events";

/** 任务中心标准状态分组。 */
export type TaskStatusGroup = "planning" | "in_progress" | "review" | "completed" | "other";

/** 将 ISO 时间格式化为中文本地时间。 */
export function formatDateTime(value: string | null): string {
  if (value === null) {
    return "尚未索引";
  }
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

/** 返回项目持久状态的中文说明。 */
export function formatProjectState(state: RegisteredProjectApi["state"]): string {
  switch (state) {
    case "focus":
      return "焦点";
    case "history":
      return "历史快照";
    case "unavailable":
      return "不可用";
  }
}

/** 返回运行时监听模式的中文说明。 */
export function formatWatchMode(mode: ProjectRuntimeWatchMode): string {
  switch (mode) {
    case "native":
      return "实时监听";
    case "polling":
      return "轮询更新";
    case "stopped":
      return "未监听";
  }
}

/** 将原始 Task 状态归入任务中心标准分组。 */
export function readTaskStatusGroup(status: string): TaskStatusGroup {
  switch (status) {
    case "planning":
    case "in_progress":
    case "review":
      return status;
    case "completed":
    case "done":
      return "completed";
    default:
      return "other";
  }
}

/** 将 Task 原始状态格式化为中文或可读回退值。 */
export function formatTaskStatusValue(status: string): string {
  switch (readTaskStatusGroup(status)) {
    case "planning":
      return "规划中";
    case "in_progress":
      return "实施中";
    case "review":
      return "评审中";
    case "completed":
      return "已完成";
    case "other":
      return status;
  }
}

/** 返回 Task 状态的中文或原始说明。 */
export function formatTaskStatus(task: TaskSummaryApi): string {
  return formatTaskStatusValue(task.status);
}

/** 返回快捷复制使用的任务名：优先 task.json 的 name，缺失时回退 id。 */
export function readTaskCopyName(task: TaskSummaryApi): string {
  return task.name ?? task.id;
}

/** 任务优先级的视觉分组；none 表示未设置，unknown 表示非法枚举。 */
export type TaskPriorityGroup = "p0" | "p1" | "p2" | "p3" | "unknown" | "none";

/** 将优先级归入稳定的视觉分组，非法值不丢弃、交由 UI 降级展示。 */
export function readTaskPriorityGroup(priority: string | null): TaskPriorityGroup {
  switch (priority) {
    case null:
      return "none";
    case "P0":
      return "p0";
    case "P1":
      return "p1";
    case "P2":
      return "p2";
    case "P3":
      return "p3";
    default:
      return "unknown";
  }
}

/** 格式化优先级展示值，缺失时回退占位符。 */
export function formatTaskPriority(priority: string | null): string {
  return priority ?? "—";
}

/** 返回优先级在筛选下拉中的排序权重，未知值排在已知枚举之后。 */
export function readTaskPriorityOrder(priority: string): number {
  switch (priority) {
    case "P0":
      return 0;
    case "P1":
      return 1;
    case "P2":
      return 2;
    case "P3":
      return 3;
    default:
      return Number.MAX_SAFE_INTEGER;
  }
}

/** 格式化 YYYY-MM-DD 日期；缺失回退占位符，非日期格式原样返回。 */
export function formatTaskDate(value: string | null): string {
  if (value === null) {
    return "—";
  }
  const dateOnly = /^(\d{4}-\d{2}-\d{2})/.exec(value);
  return dateOnly?.[1] ?? value;
}

/** 返回开发类型的中文标签，未知类型原样展示。 */
export function formatTaskDevType(devType: string | null): string {
  switch (devType) {
    case null:
      return "—";
    case "backend":
      return "后端";
    case "frontend":
      return "前端";
    case "fullstack":
      return "全栈";
    case "docs":
      return "文档";
    default:
      return devType;
  }
}
