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
