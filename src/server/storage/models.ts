import { z } from "zod";

/** 当前应用数据文件版本。 */
export const STORAGE_VERSION = 1 as const;

const IsoDateTimeSchema = z.string().datetime();
const NullableIsoDateTimeSchema = IsoDateTimeSchema.nullable();
const NonEmptyStringSchema = z.string().min(1);

/** 项目在可视化应用中的展示生命周期。 */
export const ProjectDisplayStateSchema = z.enum(["history", "focus", "unavailable"]);

/** 项目不可用或索引失败时保存的错误摘要。 */
export const ProjectErrorSchema = z
  .object({
    code: NonEmptyStringSchema,
    message: NonEmptyStringSchema,
    occurredAt: IsoDateTimeSchema,
  })
  .strict();

/** 单个已登记项目的数据结构。 */
export const RegisteredProjectSchema = z
  .object({
    id: NonEmptyStringSchema,
    path: NonEmptyStringSchema,
    label: NonEmptyStringSchema,
    state: ProjectDisplayStateSchema,
    lastAccessedAt: NullableIsoDateTimeSchema,
    lastIndexedAt: NullableIsoDateTimeSchema,
    error: ProjectErrorSchema.nullable(),
  })
  .strict();

/** 项目注册表文件结构。 */
export const ProjectRegistryFileSchema = z
  .object({
    version: z.literal(STORAGE_VERSION),
    projects: z.array(RegisteredProjectSchema),
  })
  .strict()
  .superRefine((data, context) => {
    const projectIds = new Set<string>();
    const projectPaths = new Set<string>();

    data.projects.forEach((project, index) => {
      if (projectIds.has(project.id)) {
        context.addIssue({
          code: "custom",
          path: ["projects", index, "id"],
          message: "项目 ID 不能重复",
        });
      }
      if (projectPaths.has(project.path)) {
        context.addIssue({
          code: "custom",
          path: ["projects", index, "path"],
          message: "项目路径不能重复",
        });
      }

      projectIds.add(project.id);
      projectPaths.add(project.path);
    });
  });

/** Spec 快照树节点。递归结构需要显式声明 TypeScript 类型。 */
export interface SpecTreeNode {
  name: string;
  relativePath: string;
  kind: "directory" | "file";
  children: SpecTreeNode[];
}

/** Spec 快照树节点的运行时校验合同。 */
export const SpecTreeNodeSchema: z.ZodType<SpecTreeNode> = z.lazy(() =>
  z
    .object({
      name: NonEmptyStringSchema,
      relativePath: NonEmptyStringSchema,
      kind: z.enum(["directory", "file"]),
      children: z.array(SpecTreeNodeSchema),
    })
    .strict()
    .superRefine((node, context) => {
      if (node.kind === "file" && node.children.length > 0) {
        context.addIssue({
          code: "custom",
          path: ["children"],
          message: "文件节点不能包含子节点",
        });
      }
    }),
);

/** Monorepo 包摘要。 */
export const ProjectPackageSnapshotSchema = z
  .object({
    name: NonEmptyStringSchema,
    path: NonEmptyStringSchema,
    type: NonEmptyStringSchema.nullable(),
    git: z.boolean(),
  })
  .strict();

/** 项目概览快照。 */
export const ProjectOverviewSnapshotSchema = z
  .object({
    label: NonEmptyStringSchema,
    path: NonEmptyStringSchema,
    packages: z.array(ProjectPackageSnapshotSchema),
  })
  .strict();

/** Task 列表使用的最小摘要。 */
export const TaskSummarySnapshotSchema = z
  .object({
    id: NonEmptyStringSchema,
    title: NonEmptyStringSchema,
    status: NonEmptyStringSchema,
    phase: NonEmptyStringSchema.nullable(),
    assignee: NonEmptyStringSchema.nullable(),
    packageName: NonEmptyStringSchema.nullable(),
    updatedAt: NullableIsoDateTimeSchema,
    sourcePath: NonEmptyStringSchema,
    parentSourcePath: NonEmptyStringSchema.nullable().default(null),
    childSourcePaths: z.array(NonEmptyStringSchema).default([]),
  })
  .strict();

/** Workflow 页面使用的摘要。 */
export const WorkflowSummarySnapshotSchema = z
  .object({
    name: NonEmptyStringSchema.nullable(),
    currentPhase: NonEmptyStringSchema.nullable(),
    summary: NonEmptyStringSchema.nullable(),
    sourcePath: NonEmptyStringSchema.nullable(),
  })
  .strict();

/** 索引期间产生的诊断信息。 */
export const SnapshotDiagnosticSchema = z
  .object({
    severity: z.enum(["warning", "error"]),
    code: NonEmptyStringSchema,
    message: NonEmptyStringSchema,
    sourcePath: NonEmptyStringSchema.nullable(),
  })
  .strict();

/** 单个项目的可重建摘要快照。 */
export const ProjectSnapshotSchema = z
  .object({
    projectId: NonEmptyStringSchema,
    indexedAt: IsoDateTimeSchema,
    overview: ProjectOverviewSnapshotSchema,
    specTree: z.array(SpecTreeNodeSchema),
    tasks: z
      .object({
        active: z.array(TaskSummarySnapshotSchema),
        archived: z.array(TaskSummarySnapshotSchema),
      })
      .strict(),
    workflow: WorkflowSummarySnapshotSchema,
    diagnostics: z.array(SnapshotDiagnosticSchema),
  })
  .strict();

/** 全部项目摘要快照文件结构。 */
export const ProjectSnapshotsFileSchema = z
  .object({
    version: z.literal(STORAGE_VERSION),
    snapshots: z.record(NonEmptyStringSchema, ProjectSnapshotSchema),
  })
  .strict()
  .superRefine((data, context) => {
    for (const [projectId, snapshot] of Object.entries(data.snapshots)) {
      if (snapshot.projectId !== projectId) {
        context.addIssue({
          code: "custom",
          path: ["snapshots", projectId, "projectId"],
          message: "快照键必须与 projectId 一致",
        });
      }
    }
  });

export type ProjectDisplayState = z.infer<typeof ProjectDisplayStateSchema>;
export type ProjectError = z.infer<typeof ProjectErrorSchema>;
export type RegisteredProject = z.infer<typeof RegisteredProjectSchema>;
export type ProjectRegistryFile = z.infer<typeof ProjectRegistryFileSchema>;
export type ProjectPackageSnapshot = z.infer<typeof ProjectPackageSnapshotSchema>;
export type ProjectOverviewSnapshot = z.infer<typeof ProjectOverviewSnapshotSchema>;
export type TaskSummarySnapshot = z.infer<typeof TaskSummarySnapshotSchema>;
export type WorkflowSummarySnapshot = z.infer<typeof WorkflowSummarySnapshotSchema>;
export type SnapshotDiagnostic = z.infer<typeof SnapshotDiagnosticSchema>;
export type ProjectSnapshot = z.infer<typeof ProjectSnapshotSchema>;
export type ProjectSnapshotsFile = z.infer<typeof ProjectSnapshotsFileSchema>;

/** 创建空项目注册表。 */
export function createEmptyProjectRegistry(): ProjectRegistryFile {
  return {
    version: STORAGE_VERSION,
    projects: [],
  };
}

/** 创建空项目摘要快照集合。 */
export function createEmptyProjectSnapshots(): ProjectSnapshotsFile {
  return {
    version: STORAGE_VERSION,
    snapshots: {},
  };
}
