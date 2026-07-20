import type { ZodType } from "zod";
import {
  ApiErrorResponseSchema,
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
  type OpenProjectPathResponse,
  type DirectoryPickerResponse,
  type ProjectActionResponse,
  type ProjectDetailResponse,
  type ProjectDocumentResponse,
  type ProjectListResponse,
  type ProjectRegisterInput,
  type ProjectRegisterResponse,
  type ProjectScanResponse,
  type TaskCenterResponse,
  type TaskDetailResponse,
} from "../shared/api";

/** 本地 API 返回的可恢复错误。 */
export class ApiClientError extends Error {
  /** 创建带 HTTP 状态和稳定错误码的客户端错误。 */
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
    public readonly details: string[] = [],
  ) {
    super(message);
    this.name = "ApiClientError";
  }
}

/** 读取全部已登记项目。 */
export function fetchProjects(signal?: AbortSignal): Promise<ProjectListResponse> {
  return requestJson("/api/projects", ProjectListResponseSchema, createSignalOptions(signal));
}

/** 读取跨项目任务中心元数据。 */
export function fetchTaskCenter(signal?: AbortSignal): Promise<TaskCenterResponse> {
  return requestJson("/api/tasks", TaskCenterResponseSchema, createSignalOptions(signal));
}

/** 读取单个项目详情。 */
export function fetchProject(
  projectId: string,
  signal?: AbortSignal,
): Promise<ProjectDetailResponse> {
  return requestJson(
    `/api/projects/${encodeURIComponent(projectId)}`,
    ProjectDetailResponseSchema,
    createSignalOptions(signal),
  );
}

/** 扫描用户显式输入的本机根目录。 */
export function scanProjects(rootPath: string): Promise<ProjectScanResponse> {
  return requestJson("/api/projects/scan", ProjectScanResponseSchema, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ rootPath }),
  });
}

/** 登记一个或多个已选择项目。 */
export function registerProjects(
  projects: ProjectRegisterInput[],
): Promise<ProjectRegisterResponse> {
  return requestJson("/api/projects/register", ProjectRegisterResponseSchema, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ projects }),
  });
}

/** 打开系统目录选择对话框。 */
export function selectDirectory(): Promise<DirectoryPickerResponse> {
  return requestJson("/api/system/directories/select", DirectoryPickerResponseSchema, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}

/** 切换项目焦点状态。 */
export function setProjectFocus(
  projectId: string,
  focused: boolean,
): Promise<ProjectActionResponse> {
  return requestJson(
    `/api/projects/${encodeURIComponent(projectId)}/focus`,
    ProjectActionResponseSchema,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ focused }),
    },
  );
}

/** 显式重新校验并索引项目。 */
export function refreshProject(projectId: string): Promise<ProjectActionResponse> {
  return requestJson(
    `/api/projects/${encodeURIComponent(projectId)}/refresh`,
    ProjectActionResponseSchema,
    { method: "POST" },
  );
}

/** 读取 Spec Markdown 正文。 */
export function fetchSpecDocument(
  projectId: string,
  sourcePath: string,
  signal?: AbortSignal,
): Promise<ProjectDocumentResponse> {
  const query = new URLSearchParams({ path: sourcePath });
  return requestJson(
    `/api/projects/${encodeURIComponent(projectId)}/spec-document?${query.toString()}`,
    ProjectDocumentResponseSchema,
    createSignalOptions(signal),
  );
}

/** 读取 Task 文档清单。 */
export function fetchTaskDetail(
  projectId: string,
  sourcePath: string,
  signal?: AbortSignal,
): Promise<TaskDetailResponse> {
  const query = new URLSearchParams({ sourcePath });
  return requestJson(
    `/api/projects/${encodeURIComponent(projectId)}/task-detail?${query.toString()}`,
    TaskDetailResponseSchema,
    createSignalOptions(signal),
  );
}

/** 读取 Task Markdown 或 JSONL 正文。 */
export function fetchTaskDocument(
  projectId: string,
  taskSourcePath: string,
  documentPath: string,
  signal?: AbortSignal,
): Promise<ProjectDocumentResponse> {
  const query = new URLSearchParams({ taskSourcePath, path: documentPath });
  return requestJson(
    `/api/projects/${encodeURIComponent(projectId)}/task-document?${query.toString()}`,
    ProjectDocumentResponseSchema,
    createSignalOptions(signal),
  );
}

/** 让系统外部应用打开项目目录或合法源路径。 */
export function openProjectPath(
  projectId: string,
  sourcePath?: string,
): Promise<OpenProjectPathResponse> {
  return requestJson(
    `/api/projects/${encodeURIComponent(projectId)}/open`,
    OpenProjectPathResponseSchema,
    {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(sourcePath === undefined ? {} : { sourcePath }),
    },
  );
}

/** 请求 JSON 并在网络边界使用共享 Schema 校验。 */
async function requestJson<T>(
  path: string,
  schema: ZodType<T>,
  options: RequestInit = {},
): Promise<T> {
  const response = await fetch(path, options);
  const payload: unknown = await response.json();
  if (!response.ok) {
    const error = ApiErrorResponseSchema.safeParse(payload);
    if (error.success) {
      throw new ApiClientError(
        error.data.message,
        response.status,
        error.data.code,
        error.data.details ?? [],
      );
    }
    throw new ApiClientError(`接口请求失败：HTTP ${response.status}`, response.status, "invalid-error-response");
  }

  const parsed = schema.safeParse(payload);
  if (!parsed.success) {
    throw new ApiClientError("接口返回格式不正确", response.status, "invalid-api-response");
  }
  return parsed.data;
}

/** 仅在存在 AbortSignal 时添加请求取消选项。 */
function createSignalOptions(signal?: AbortSignal): RequestInit {
  return signal === undefined ? {} : { signal };
}
