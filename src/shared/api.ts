import { z } from "zod";
import { PROJECT_RUNTIME_WATCH_MODES } from "./project-events.js";

const IsoDateTimeSchema = z.string().datetime();
const NullableIsoDateTimeSchema = IsoDateTimeSchema.nullable();
const NonEmptyStringSchema = z.string().min(1);

/** 统一 API 错误响应。 */
export const ApiErrorResponseSchema = z
  .object({
    code: NonEmptyStringSchema,
    message: NonEmptyStringSchema,
    details: z.array(NonEmptyStringSchema).optional(),
  })
  .strict();

/** 项目展示状态。 */
export const ProjectDisplayStateApiSchema = z.enum(["history", "focus", "unavailable"]);

/** 项目错误摘要。 */
export const ProjectErrorApiSchema = z
  .object({
    code: NonEmptyStringSchema,
    message: NonEmptyStringSchema,
    occurredAt: IsoDateTimeSchema,
  })
  .strict();

/** 已登记项目 API 数据。 */
export const RegisteredProjectApiSchema = z
  .object({
    id: NonEmptyStringSchema,
    path: NonEmptyStringSchema,
    label: NonEmptyStringSchema,
    state: ProjectDisplayStateApiSchema,
    lastAccessedAt: NullableIsoDateTimeSchema,
    lastIndexedAt: NullableIsoDateTimeSchema,
    error: ProjectErrorApiSchema.nullable(),
  })
  .strict();

/** 项目运行时监听状态。 */
export const ProjectRuntimeStatusApiSchema = z
  .object({
    projectId: NonEmptyStringSchema,
    watchMode: z.enum(PROJECT_RUNTIME_WATCH_MODES),
    realtime: z.boolean(),
    pendingChanges: z.number().int().nonnegative(),
  })
  .strict();

/** Spec 树节点。 */
export interface SpecTreeNodeApi {
  name: string;
  relativePath: string;
  kind: "directory" | "file";
  children: SpecTreeNodeApi[];
}

/** Spec 树节点运行时合同。 */
export const SpecTreeNodeApiSchema: z.ZodType<SpecTreeNodeApi> = z.lazy(() =>
  z
    .object({
      name: NonEmptyStringSchema,
      relativePath: NonEmptyStringSchema,
      kind: z.enum(["directory", "file"]),
      children: z.array(SpecTreeNodeApiSchema),
    })
    .strict(),
);

/** Monorepo 包摘要。 */
export const ProjectPackageApiSchema = z
  .object({
    name: NonEmptyStringSchema,
    path: NonEmptyStringSchema,
    type: NonEmptyStringSchema.nullable(),
    git: z.boolean(),
  })
  .strict();

/** 项目概览快照。 */
export const ProjectOverviewApiSchema = z
  .object({
    label: NonEmptyStringSchema,
    path: NonEmptyStringSchema,
    packages: z.array(ProjectPackageApiSchema),
  })
  .strict();

/** Task 列表摘要。 */
export const TaskSummaryApiSchema = z
  .object({
    id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    status: NonEmptyStringSchema,
    phase: NonEmptyStringSchema.nullable(),
    assignee: NonEmptyStringSchema.nullable(),
    packageName: NonEmptyStringSchema.nullable(),
    updatedAt: NullableIsoDateTimeSchema,
    sourcePath: NonEmptyStringSchema,
    parentSourcePath: NonEmptyStringSchema.nullable(),
    childSourcePaths: z.array(NonEmptyStringSchema),
  })
  .strict();

/** Task 所属集合。 */
export const TaskCollectionApiSchema = z.enum(["active", "archived"]);

/** 跨项目任务中心单项。 */
export const TaskCenterItemApiSchema = z
  .object({
    projectId: NonEmptyStringSchema,
    collection: TaskCollectionApiSchema,
    task: TaskSummaryApiSchema,
    parentTitle: NonEmptyStringSchema.nullable(),
  })
  .strict();

/** Workflow 摘要。 */
export const WorkflowSummaryApiSchema = z
  .object({
    name: NonEmptyStringSchema.nullable(),
    currentPhase: NonEmptyStringSchema.nullable(),
    summary: NonEmptyStringSchema.nullable(),
    sourcePath: NonEmptyStringSchema.nullable(),
  })
  .strict();

/** 项目索引诊断。 */
export const SnapshotDiagnosticApiSchema = z
  .object({
    severity: z.enum(["warning", "error"]),
    code: NonEmptyStringSchema,
    message: NonEmptyStringSchema,
    sourcePath: NonEmptyStringSchema.nullable(),
  })
  .strict();

/** 项目摘要快照 API 合同。 */
export const ProjectSnapshotApiSchema = z
  .object({
    projectId: NonEmptyStringSchema,
    indexedAt: IsoDateTimeSchema,
    overview: ProjectOverviewApiSchema,
    specTree: z.array(SpecTreeNodeApiSchema),
    tasks: z
      .object({
        active: z.array(TaskSummaryApiSchema),
        archived: z.array(TaskSummaryApiSchema),
      })
      .strict(),
    workflow: WorkflowSummaryApiSchema,
    diagnostics: z.array(SnapshotDiagnosticApiSchema),
  })
  .strict();

/** 项目列表单项。 */
export const ProjectListItemSchema = z
  .object({
    project: RegisteredProjectApiSchema,
    runtime: ProjectRuntimeStatusApiSchema,
    hasSnapshot: z.boolean(),
    possiblyStale: z.boolean(),
    activeTaskCount: z.number().int().nonnegative(),
    archivedTaskCount: z.number().int().nonnegative(),
    diagnosticCount: z.number().int().nonnegative(),
  })
  .strict();

/** 跨项目任务中心响应。 */
export const TaskCenterResponseSchema = z
  .object({
    projects: z.array(ProjectListItemSchema),
    tasks: z.array(TaskCenterItemApiSchema),
  })
  .strict();

/** 项目列表响应。 */
export const ProjectListResponseSchema = z
  .object({ projects: z.array(ProjectListItemSchema) })
  .strict();

/** 单项目详情响应。 */
export const ProjectDetailResponseSchema = z
  .object({
    project: RegisteredProjectApiSchema,
    runtime: ProjectRuntimeStatusApiSchema,
    snapshot: ProjectSnapshotApiSchema.nullable(),
    possiblyStale: z.boolean(),
    contentReadable: z.boolean(),
  })
  .strict();

/** 快速扫描请求。 */
export const ProjectScanRequestSchema = z
  .object({ rootPath: NonEmptyStringSchema })
  .strict();

/** 快速扫描候选。 */
export const ProjectScanCandidateSchema = z
  .object({
    project: RegisteredProjectApiSchema,
    snapshot: ProjectSnapshotApiSchema,
  })
  .strict();

/** 快速扫描响应。 */
export const ProjectScanResponseSchema = z
  .object({
    candidates: z.array(ProjectScanCandidateSchema),
    diagnostics: z.array(SnapshotDiagnosticApiSchema),
  })
  .strict();

/** 单个待登记项目。 */
export const ProjectRegisterInputSchema = z
  .object({
    path: NonEmptyStringSchema,
    label: z.string().min(1).optional(),
  })
  .strict();

/** 批量登记请求。 */
export const ProjectRegisterRequestSchema = z
  .object({ projects: z.array(ProjectRegisterInputSchema).min(1) })
  .strict();

/** 单个登记结果。 */
export const ProjectRegistrationResultApiSchema = z
  .object({
    status: z.enum(["added", "updated", "invalid"]),
    project: RegisteredProjectApiSchema.nullable(),
    snapshot: ProjectSnapshotApiSchema.nullable(),
    diagnostics: z.array(SnapshotDiagnosticApiSchema),
  })
  .strict();

/** 批量登记响应。 */
export const ProjectRegisterResponseSchema = z
  .object({ results: z.array(ProjectRegistrationResultApiSchema) })
  .strict();

/** 焦点切换请求。 */
export const ProjectFocusRequestSchema = z.object({ focused: z.boolean() }).strict();

/** 项目操作完成后的详情响应。 */
export const ProjectActionResponseSchema = ProjectDetailResponseSchema;

/** Spec Markdown 或 Task 文档响应。 */
export const ProjectDocumentResponseSchema = z
  .object({
    content: z.string(),
    sourcePath: NonEmptyStringSchema,
    modifiedAt: IsoDateTimeSchema,
    format: z.enum(["markdown", "jsonl"]),
  })
  .strict();

/** Task 文档清单单项。 */
export const TaskDocumentSummarySchema = z
  .object({
    name: NonEmptyStringSchema,
    relativePath: NonEmptyStringSchema,
    sourcePath: NonEmptyStringSchema,
    format: z.enum(["markdown", "jsonl"]),
    modifiedAt: IsoDateTimeSchema,
  })
  .strict();

/** Task 详情响应。 */
export const TaskDetailResponseSchema = z
  .object({
    projectId: NonEmptyStringSchema,
    task: TaskSummaryApiSchema,
    documents: z.array(TaskDocumentSummarySchema),
  })
  .strict();

/** 外部打开请求。 */
export const OpenProjectPathRequestSchema = z
  .object({ sourcePath: NonEmptyStringSchema.optional() })
  .strict();

/** 外部打开响应。 */
export const OpenProjectPathResponseSchema = z.object({ opened: z.literal(true) }).strict();

/** 系统目录选择请求。 */
export const DirectoryPickerRequestSchema = z.object({}).strict();

/** 系统目录选择响应。 */
export const DirectoryPickerResponseSchema = z.discriminatedUnion("status", [
  z
    .object({
      status: z.literal("selected"),
      path: NonEmptyStringSchema,
    })
    .strict(),
  z.object({ status: z.literal("cancelled") }).strict(),
]);

export type ApiErrorResponse = z.infer<typeof ApiErrorResponseSchema>;
export type RegisteredProjectApi = z.infer<typeof RegisteredProjectApiSchema>;
export type ProjectRuntimeStatusApi = z.infer<typeof ProjectRuntimeStatusApiSchema>;
export type ProjectPackageApi = z.infer<typeof ProjectPackageApiSchema>;
export type ProjectOverviewApi = z.infer<typeof ProjectOverviewApiSchema>;
export type TaskSummaryApi = z.infer<typeof TaskSummaryApiSchema>;
export type TaskCollectionApi = z.infer<typeof TaskCollectionApiSchema>;
export type TaskCenterItemApi = z.infer<typeof TaskCenterItemApiSchema>;
export type WorkflowSummaryApi = z.infer<typeof WorkflowSummaryApiSchema>;
export type SnapshotDiagnosticApi = z.infer<typeof SnapshotDiagnosticApiSchema>;
export type ProjectSnapshotApi = z.infer<typeof ProjectSnapshotApiSchema>;
export type ProjectListItem = z.infer<typeof ProjectListItemSchema>;
export type TaskCenterResponse = z.infer<typeof TaskCenterResponseSchema>;
export type ProjectListResponse = z.infer<typeof ProjectListResponseSchema>;
export type ProjectDetailResponse = z.infer<typeof ProjectDetailResponseSchema>;
export type ProjectScanRequest = z.infer<typeof ProjectScanRequestSchema>;
export type ProjectScanCandidate = z.infer<typeof ProjectScanCandidateSchema>;
export type ProjectScanResponse = z.infer<typeof ProjectScanResponseSchema>;
export type ProjectRegisterInput = z.infer<typeof ProjectRegisterInputSchema>;
export type ProjectRegisterRequest = z.infer<typeof ProjectRegisterRequestSchema>;
export type ProjectRegistrationResultApi = z.infer<
  typeof ProjectRegistrationResultApiSchema
>;
export type ProjectRegisterResponse = z.infer<typeof ProjectRegisterResponseSchema>;
export type ProjectFocusRequest = z.infer<typeof ProjectFocusRequestSchema>;
export type ProjectActionResponse = z.infer<typeof ProjectActionResponseSchema>;
export type ProjectDocumentResponse = z.infer<typeof ProjectDocumentResponseSchema>;
export type TaskDocumentSummary = z.infer<typeof TaskDocumentSummarySchema>;
export type TaskDetailResponse = z.infer<typeof TaskDetailResponseSchema>;
export type OpenProjectPathRequest = z.infer<typeof OpenProjectPathRequestSchema>;
export type OpenProjectPathResponse = z.infer<typeof OpenProjectPathResponseSchema>;
export type DirectoryPickerRequest = z.infer<typeof DirectoryPickerRequestSchema>;
export type DirectoryPickerResponse = z.infer<typeof DirectoryPickerResponseSchema>;
