import { Channel, invoke, isTauri } from "@tauri-apps/api/core";
import { z, type ZodType } from "zod";
import {
  ApiErrorResponseSchema,
  UpdateCheckResponseSchema,
  UpdateDownloadProgressSchema,
  UpdateInstallResponseSchema,
  DirectoryPickerResponseSchema,
  OpenProjectPathResponseSchema,
  ProjectActionResponseSchema,
  ProjectDetailResponseSchema,
  ProjectDocumentResponseSchema,
  ProjectListResponseSchema,
  ProjectRegisterResponseSchema,
  ProjectScanResponseSchema,
  TaskCenterResponseSchema,
  TaskDetailResponseSchema,
  type DirectoryPickerResponse,
  type OpenProjectPathResponse,
  type ProjectActionResponse,
  type ProjectDetailResponse,
  type ProjectDocumentResponse,
  type ProjectListResponse,
  type ProjectRegisterInput,
  type ProjectRegisterResponse,
  type ProjectScanResponse,
  type TaskCenterResponse,
  type TaskDetailResponse,
  type UpdateCheckMode,
  type UpdateCheckResponse,
  type UpdateDownloadProgress,
  type UpdateInstallResponse,
} from "../shared/api";

/** 桌面 Command 返回的可恢复错误。 */
export class ApiClientError extends Error {
  /** 创建带稳定错误码和可选详情的客户端错误。 */
  constructor(
    message: string,
    public readonly code: string,
    public readonly details: string[] = [],
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

/** 读取全部已登记项目。 */
export function fetchProjects(signal?: AbortSignal): Promise<ProjectListResponse> {
  return invokeCommand("list_projects", {}, ProjectListResponseSchema, signal);
}

/** 读取跨项目任务中心元数据。 */
export function fetchTaskCenter(signal?: AbortSignal): Promise<TaskCenterResponse> {
  return invokeCommand("list_tasks", {}, TaskCenterResponseSchema, signal);
}

/** 读取单个项目详情。 */
export function fetchProject(projectId: string, signal?: AbortSignal): Promise<ProjectDetailResponse> {
  return invokeCommand("get_project", { projectId }, ProjectDetailResponseSchema, signal);
}

/** 扫描用户显式输入的本机根目录。 */
export function scanProjects(rootPath: string): Promise<ProjectScanResponse> {
  return invokeCommand("scan_projects", { rootPath }, ProjectScanResponseSchema);
}

/** 登记一个或多个已选择项目。 */
export function registerProjects(projects: ProjectRegisterInput[]): Promise<ProjectRegisterResponse> {
  return invokeCommand("register_projects", { projects }, ProjectRegisterResponseSchema);
}

/** 打开系统目录选择对话框。 */
export function selectDirectory(): Promise<DirectoryPickerResponse> {
  return invokeCommand("select_directory", {}, DirectoryPickerResponseSchema);
}

/** 切换项目焦点状态。 */
export function setProjectFocus(projectId: string, focused: boolean): Promise<ProjectActionResponse> {
  return invokeCommand("set_project_focus", { projectId, focused }, ProjectActionResponseSchema);
}

/** 显式重新校验并索引项目。 */
export function refreshProject(projectId: string): Promise<ProjectActionResponse> {
  return invokeCommand("refresh_project", { projectId }, ProjectActionResponseSchema);
}

/** 读取 Spec Markdown 正文。 */
export function fetchSpecDocument(
  projectId: string,
  sourcePath: string,
  signal?: AbortSignal,
): Promise<ProjectDocumentResponse> {
  return invokeCommand(
    "read_spec_document",
    { projectId, sourcePath },
    ProjectDocumentResponseSchema,
    signal,
  );
}

/** 读取 Task 文档清单。 */
export function fetchTaskDetail(
  projectId: string,
  sourcePath: string,
  signal?: AbortSignal,
): Promise<TaskDetailResponse> {
  return invokeCommand(
    "read_task_detail",
    { projectId, sourcePath },
    TaskDetailResponseSchema,
    signal,
  );
}

/** 读取 Task Markdown 或 JSONL 正文。 */
export function fetchTaskDocument(
  projectId: string,
  taskSourcePath: string,
  documentPath: string,
  signal?: AbortSignal,
): Promise<ProjectDocumentResponse> {
  return invokeCommand(
    "read_task_document",
    { projectId, taskSourcePath, documentPath },
    ProjectDocumentResponseSchema,
    signal,
  );
}

/** 让系统外部应用打开项目目录或合法源路径。 */
export function openProjectPath(
  projectId: string,
  sourcePath?: string,
): Promise<OpenProjectPathResponse> {
  return invokeCommand(
    "open_project_path",
    sourcePath === undefined ? { projectId } : { projectId, sourcePath },
    OpenProjectPathResponseSchema,
  );
}

/** 打开固定应用日志目录。 */
export function openLogDirectory(): Promise<OpenProjectPathResponse> {
  return invokeCommand("open_log_directory", {}, OpenProjectPathResponseSchema);
}

/** 清除固定应用数据目录并退出桌面进程。 */
export async function clearApplicationDataAndExit(): Promise<void> {
  await invokeCommand("clear_application_data_and_exit", { confirmed: true }, EmptyResponseSchema);
}

/** 按自动限频或用户手动触发检查应用更新。 */
export function checkForApplicationUpdate(mode: UpdateCheckMode): Promise<UpdateCheckResponse> {
  return invokeCommand("check_for_update", { mode }, UpdateCheckResponseSchema);
}

/** 下载、验签并安装已经由用户确认的更新。 */
export async function installApplicationUpdate(
  onProgress: (progress: UpdateDownloadProgress) => void,
): Promise<UpdateInstallResponse> {
  let invalidProgressPayload = false;
  const channel = new Channel<unknown>();
  channel.onmessage = (payload) => {
    const parsed = UpdateDownloadProgressSchema.safeParse(payload);
    if (parsed.success) {
      onProgress(parsed.data);
    } else {
      invalidProgressPayload = true;
    }
  };
  const response = await invokeCommand(
    "install_update",
    { onProgress: channel },
    UpdateInstallResponseSchema,
  );
  if (invalidProgressPayload) {
    throw new ApiClientError("客户端返回格式不正确", "invalid-command-response");
  }
  return response;
}

/** 关闭 Core 并重启桌面应用。 */
export async function restartApplication(): Promise<void> {
  await invokeCommand("restart_application", {}, EmptyResponseSchema);
}

const EmptyResponseSchema = z.void();

/** 调用桌面 Command，并在 IPC 边界校验成功值与错误值。 */
async function invokeCommand<T>(
  command: string,
  args: Record<string, unknown>,
  schema: ZodType<T>,
  signal?: AbortSignal,
): Promise<T> {
  if (!isTauri()) {
    throw new ApiClientError("当前页面不在桌面客户端中运行", "desktop-runtime-unavailable");
  }
  if (signal?.aborted) {
    throw new DOMException("请求已取消", "AbortError");
  }
  try {
    const payload: unknown = await invoke(command, args);
    if (signal?.aborted) {
      throw new DOMException("请求已取消", "AbortError");
    }
    const parsed = schema.safeParse(payload);
    if (!parsed.success) {
      throw new ApiClientError("客户端返回格式不正确", "invalid-command-response");
    }
    return parsed.data;
  } catch (error) {
    if (error instanceof ApiClientError || (error instanceof DOMException && error.name === "AbortError")) {
      throw error;
    }
    const parsed = ApiErrorResponseSchema.safeParse(error);
    if (parsed.success) {
      throw new ApiClientError(
        parsed.data.message,
        parsed.data.code,
        parsed.data.details ?? [],
      );
    }
    throw new ApiClientError("桌面后端调用失败，请重试", "unknown-command-error");
  }
}
