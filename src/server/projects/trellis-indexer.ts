import { lstat, opendir, stat } from "node:fs/promises";
import { basename, extname, join } from "node:path";
import { parse as parseYaml } from "yaml";
import { z } from "zod";
import type {
  ProjectPackageSnapshot,
  ProjectSnapshot,
  SnapshotDiagnostic,
  SpecTreeNode,
  TaskSummarySnapshot,
  WorkflowSummarySnapshot,
} from "../storage/models.js";
import type { ValidatedTrellisProject } from "./project-models.js";
import { readUtf8File, toProjectRelativePath } from "./project-paths.js";

const PackageConfigSchema = z
  .object({
    path: z.string().min(1),
    type: z.string().min(1).optional(),
    git: z.boolean().optional(),
  })
  .passthrough();

const TrellisConfigSchema = z
  .object({
    packages: z.record(z.string().min(1), PackageConfigSchema).optional(),
  })
  .passthrough();

const TaskRecordSchema = z.record(z.string(), z.unknown());

interface TaskIndexResult {
  active: TaskSummarySnapshot[];
  archived: TaskSummarySnapshot[];
}

interface ParsedTask {
  summary: TaskSummarySnapshot;
  directoryName: string;
  parentName: string | null;
  childNames: string[];
}

interface TaskRelationCandidate {
  parent: ParsedTask;
  child: ParsedTask;
  declaredByParent: boolean;
  declaredByChild: boolean;
  parentDeclarationIndex: number | null;
}

/** 将单个 Trellis 项目解析为可持久化摘要快照。 */
export class TrellisIndexer {
  /**
   * 索引项目概览、Spec、Task 和 Workflow。
   *
   * @param project 已通过基础结构校验的项目
   * @returns 可重建摘要快照
   */
  async index(project: ValidatedTrellisProject): Promise<ProjectSnapshot> {
    const diagnostics: SnapshotDiagnostic[] = [];
    const indexedAt = new Date().toISOString();
    const packages = await parseProjectPackages(project, diagnostics);
    const specTree = await buildSpecTree(project, diagnostics);
    const tasks = await indexTasks(project, diagnostics);
    const workflow = await parseWorkflow(project, tasks.active, diagnostics);

    return {
      projectId: project.id,
      indexedAt,
      overview: {
        label: project.label,
        path: project.projectRoot,
        packages,
      },
      specTree,
      tasks,
      workflow,
      diagnostics,
    };
  }
}

/** 解析 config.yaml 中的 monorepo 包信息。 */
async function parseProjectPackages(
  project: ValidatedTrellisProject,
  diagnostics: SnapshotDiagnostic[],
): Promise<ProjectPackageSnapshot[]> {
  const configPath = join(project.trellisRoot, "config.yaml");
  const sourcePath = toProjectRelativePath(project.projectRoot, configPath);

  let configText: string;
  try {
    configText = await readUtf8File(configPath);
  } catch {
    diagnostics.push(createFileDiagnostic("config-read-failed", sourcePath));
    return [];
  }

  let unknownConfig: unknown;
  try {
    unknownConfig = parseYaml(configText) as unknown;
  } catch {
    diagnostics.push(createFileDiagnostic("config-yaml-invalid", sourcePath));
    return [];
  }

  const parsedConfig = TrellisConfigSchema.safeParse(unknownConfig ?? {});
  if (!parsedConfig.success) {
    diagnostics.push({
      severity: "error",
      code: "config-structure-invalid",
      message: formatZodIssues(parsedConfig.error),
      sourcePath,
    });
    return [];
  }

  return Object.entries(parsedConfig.data.packages ?? {})
    .map(([name, packageConfig]) => ({
      name,
      path: packageConfig.path,
      type: packageConfig.type ?? null,
      git: packageConfig.git ?? false,
    }))
    .sort((left, right) => left.name.localeCompare(right.name));
}

/** 构建只包含目录和 Markdown 文件的 Spec 树。 */
async function buildSpecTree(
  project: ValidatedTrellisProject,
  diagnostics: SnapshotDiagnostic[],
): Promise<SpecTreeNode[]> {
  return walkSpecDirectory(project, join(project.trellisRoot, "spec"), diagnostics);
}

/** 递归读取一个 Spec 目录。 */
async function walkSpecDirectory(
  project: ValidatedTrellisProject,
  directoryPath: string,
  diagnostics: SnapshotDiagnostic[],
): Promise<SpecTreeNode[]> {
  let directory;
  try {
    directory = await opendir(directoryPath);
  } catch {
    diagnostics.push(
      createFileDiagnostic(
        "spec-directory-unreadable",
        toProjectRelativePath(project.projectRoot, directoryPath),
      ),
    );
    return [];
  }

  const nodes: SpecTreeNode[] = [];
  for await (const entry of directory) {
    const entryPath = join(directoryPath, entry.name);
    const sourcePath = toProjectRelativePath(project.projectRoot, entryPath);

    if (entry.isSymbolicLink()) {
      diagnostics.push({
        severity: "warning",
        code: "spec-symlink-skipped",
        message: "跳过 Spec 中的符号链接",
        sourcePath,
      });
      continue;
    }
    if (entry.isDirectory()) {
      nodes.push({
        name: entry.name,
        relativePath: sourcePath,
        kind: "directory",
        children: await walkSpecDirectory(project, entryPath, diagnostics),
      });
      continue;
    }
    if (entry.isFile() && extname(entry.name).toLowerCase() === ".md") {
      nodes.push({
        name: entry.name,
        relativePath: sourcePath,
        kind: "file",
        children: [],
      });
    }
  }

  return nodes.sort(compareSpecNodes);
}

/** 索引活动与归档任务。 */
async function indexTasks(
  project: ValidatedTrellisProject,
  diagnostics: SnapshotDiagnostic[],
): Promise<TaskIndexResult> {
  const tasksRoot = join(project.trellisRoot, "tasks");
  const active: ParsedTask[] = [];

  let taskDirectory;
  try {
    taskDirectory = await opendir(tasksRoot);
  } catch {
    diagnostics.push(
      createFileDiagnostic(
        "tasks-directory-unreadable",
        toProjectRelativePath(project.projectRoot, tasksRoot),
      ),
    );
    return { active: [], archived: [] };
  }

  for await (const entry of taskDirectory) {
    if (entry.name === "archive" || !entry.isDirectory() || entry.isSymbolicLink()) {
      continue;
    }

    active.push(await parseTaskDirectory(project, join(tasksRoot, entry.name), false, diagnostics));
  }

  const archivedTaskDirectories = await findArchivedTaskDirectories(
    project,
    join(tasksRoot, "archive"),
    diagnostics,
  );
  const archived = await Promise.all(
    archivedTaskDirectories.map((taskPath) =>
      parseTaskDirectory(project, taskPath, true, diagnostics),
    ),
  );

  return resolveTaskRelationships(active, archived, diagnostics);
}

/** 递归发现归档目录中包含 task.json 的任务根目录。 */
async function findArchivedTaskDirectories(
  project: ValidatedTrellisProject,
  archiveRoot: string,
  diagnostics: SnapshotDiagnostic[],
): Promise<string[]> {
  if (!(await isDirectory(archiveRoot))) {
    return [];
  }

  const taskDirectories: string[] = [];
  const pendingDirectories = [archiveRoot];
  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    if (currentDirectory === undefined) {
      break;
    }

    if (await isRegularFile(join(currentDirectory, "task.json"))) {
      taskDirectories.push(currentDirectory);
      continue;
    }

    let directory;
    try {
      directory = await opendir(currentDirectory);
    } catch {
      diagnostics.push(
        createFileDiagnostic(
          "archive-directory-unreadable",
          toProjectRelativePath(project.projectRoot, currentDirectory),
          "warning",
        ),
      );
      continue;
    }

    for await (const entry of directory) {
      if (entry.isDirectory() && !entry.isSymbolicLink()) {
        pendingDirectories.push(join(currentDirectory, entry.name));
      }
    }
  }

  return taskDirectories;
}

/** 解析一个任务目录，并在损坏时返回目录名回退摘要。 */
async function parseTaskDirectory(
  project: ValidatedTrellisProject,
  taskRoot: string,
  archived: boolean,
  diagnostics: SnapshotDiagnostic[],
): Promise<ParsedTask> {
  const taskJsonPath = join(taskRoot, "task.json");
  const sourcePath = toProjectRelativePath(project.projectRoot, taskJsonPath);
  const directoryName = basename(taskRoot);
  const taskRecord = await readTaskRecord(taskJsonPath, sourcePath, diagnostics);
  const recordId = readTaskString(taskRecord, "id", diagnostics, sourcePath);
  const recordName = readTaskString(taskRecord, "name", diagnostics, sourcePath);
  const recordTitle = readTaskString(taskRecord, "title", diagnostics, sourcePath);
  const recordStatus = readTaskString(taskRecord, "status", diagnostics, sourcePath);
  const recordAssignee = readTaskString(taskRecord, "assignee", diagnostics, sourcePath);
  const recordPackage = readTaskString(taskRecord, "package", diagnostics, sourcePath);
  const recordParent = readTaskString(taskRecord, "parent", diagnostics, sourcePath);
  const recordChildren = readTaskStringArray(taskRecord, "children", diagnostics, sourcePath);

  if (!archived) {
    await validateActiveTaskPrd(project, taskRoot, diagnostics);
  }
  await validateTaskJsonlFiles(project, taskRoot, diagnostics);

  const id = recordId ?? recordName ?? directoryName;
  const title = recordTitle ?? recordName ?? id;
  const status = recordStatus ?? (archived ? "completed" : "unknown");

  return {
    directoryName,
    parentName: recordParent,
    childNames: recordChildren,
    summary: {
      id,
      title,
      status,
      phase: mapTaskStatusToPhase(status),
      assignee: recordAssignee,
      packageName: recordPackage,
      updatedAt: await readTaskModifiedAt(taskJsonPath, taskRoot),
      sourcePath,
      parentSourcePath: null,
      childSourcePaths: [],
    },
  };
}

/** 读取 task.json 为宽容键值结构。 */
async function readTaskRecord(
  taskJsonPath: string,
  sourcePath: string,
  diagnostics: SnapshotDiagnostic[],
): Promise<Record<string, unknown>> {
  let taskText: string;
  try {
    taskText = await readUtf8File(taskJsonPath);
  } catch {
    diagnostics.push(createFileDiagnostic("task-json-read-failed", sourcePath));
    return {};
  }

  let unknownTask: unknown;
  try {
    unknownTask = JSON.parse(taskText) as unknown;
  } catch {
    diagnostics.push(createFileDiagnostic("task-json-invalid", sourcePath));
    return {};
  }

  const parsedTask = TaskRecordSchema.safeParse(unknownTask);
  if (!parsedTask.success) {
    diagnostics.push({
      severity: "error",
      code: "task-json-structure-invalid",
      message: formatZodIssues(parsedTask.error),
      sourcePath,
    });
    return {};
  }

  return parsedTask.data;
}

/** 读取任务字符串字段，错误类型仅产生警告并回退。 */
function readTaskString(
  task: Record<string, unknown>,
  field: string,
  diagnostics: SnapshotDiagnostic[],
  sourcePath: string,
): string | null {
  const value = task[field];
  if (value === undefined || value === null || value === "") {
    return null;
  }
  if (typeof value === "string") {
    return value;
  }

  diagnostics.push({
    severity: "warning",
    code: "task-field-invalid",
    message: `任务字段 ${field} 不是字符串，已忽略`,
    sourcePath,
  });
  return null;
}

/** 读取任务字符串数组字段，非法成员产生警告并被忽略。 */
function readTaskStringArray(
  task: Record<string, unknown>,
  field: string,
  diagnostics: SnapshotDiagnostic[],
  sourcePath: string,
): string[] {
  const value = task[field];
  if (value === undefined || value === null) {
    return [];
  }
  if (!Array.isArray(value)) {
    diagnostics.push(createTaskRelationDiagnostic("task-relation-field-invalid", sourcePath));
    return [];
  }

  const values: string[] = [];
  value.forEach((item) => {
    if (typeof item === "string" && item.length > 0) {
      values.push(item);
      return;
    }
    diagnostics.push(createTaskRelationDiagnostic("task-relation-field-invalid", sourcePath));
  });
  return values;
}

/** 跨活动与归档集合解析任务关系，并隔离损坏或循环的关系边。 */
function resolveTaskRelationships(
  activeTasks: ParsedTask[],
  archivedTasks: ParsedTask[],
  diagnostics: SnapshotDiagnostic[],
): TaskIndexResult {
  const allTasks = [...activeTasks, ...archivedTasks];
  const taskByDirectoryName = new Map<string, ParsedTask>();
  const taskBySourcePath = new Map(allTasks.map((task) => [task.summary.sourcePath, task]));
  const relationCandidates = new Map<string, TaskRelationCandidate>();
  const parentByChildPath = new Map<string, string>();

  allTasks.forEach((task) => {
    if (taskByDirectoryName.has(task.directoryName)) {
      diagnostics.push(
        createTaskRelationDiagnostic("task-relation-name-duplicate", task.summary.sourcePath),
      );
      return;
    }
    taskByDirectoryName.set(task.directoryName, task);
  });

  allTasks.forEach((parent) => {
    const seenChildren = new Set<string>();
    parent.childNames.forEach((childName, childIndex) => {
      if (seenChildren.has(childName)) {
        diagnostics.push(
          createTaskRelationDiagnostic("task-relation-child-duplicate", parent.summary.sourcePath),
        );
        return;
      }
      seenChildren.add(childName);
      const child = taskByDirectoryName.get(childName);
      if (child === undefined) {
        diagnostics.push(
          createTaskRelationDiagnostic("task-relation-child-missing", parent.summary.sourcePath),
        );
        return;
      }
      if (parent.summary.sourcePath === child.summary.sourcePath) {
        diagnostics.push(
          createTaskRelationDiagnostic("task-relation-self-reference", parent.summary.sourcePath),
        );
        return;
      }

      const candidateKey = createTaskRelationKey(parent, child);
      const candidate = relationCandidates.get(candidateKey) ?? {
        parent,
        child,
        declaredByParent: false,
        declaredByChild: false,
        parentDeclarationIndex: null,
      };
      candidate.declaredByParent = true;
      candidate.parentDeclarationIndex ??= childIndex;
      relationCandidates.set(candidateKey, candidate);
    });
  });

  allTasks.forEach((child) => {
    if (child.parentName === null) {
      return;
    }
    const parent = taskByDirectoryName.get(child.parentName);
    if (parent === undefined) {
      diagnostics.push(
        createTaskRelationDiagnostic("task-relation-parent-missing", child.summary.sourcePath),
      );
      return;
    }
    if (parent.summary.sourcePath === child.summary.sourcePath) {
      diagnostics.push(
        createTaskRelationDiagnostic("task-relation-self-reference", child.summary.sourcePath),
      );
      return;
    }

    const candidateKey = createTaskRelationKey(parent, child);
    const candidate = relationCandidates.get(candidateKey) ?? {
      parent,
      child,
      declaredByParent: false,
      declaredByChild: false,
      parentDeclarationIndex: null,
    };
    candidate.declaredByChild = true;
    relationCandidates.set(candidateKey, candidate);
  });

  const candidates = [...relationCandidates.values()].sort(compareTaskRelationCandidates);
  candidates.forEach((candidate) => {
    const { parent, child } = candidate;
    if (candidate.declaredByParent !== candidate.declaredByChild) {
      diagnostics.push(
        createTaskRelationDiagnostic("task-relation-asymmetric", child.summary.sourcePath),
      );
    }

    const existingParentPath = parentByChildPath.get(child.summary.sourcePath);
    if (existingParentPath !== undefined && existingParentPath !== parent.summary.sourcePath) {
      diagnostics.push(
        createTaskRelationDiagnostic("task-relation-parent-conflict", child.summary.sourcePath),
      );
      return;
    }
    if (wouldCreateTaskCycle(parent.summary.sourcePath, child.summary.sourcePath, parentByChildPath)) {
      diagnostics.push(
        createTaskRelationDiagnostic("task-relation-cycle", child.summary.sourcePath),
      );
      return;
    }

    parentByChildPath.set(child.summary.sourcePath, parent.summary.sourcePath);
    child.summary.parentSourcePath = parent.summary.sourcePath;
    parent.summary.childSourcePaths.push(child.summary.sourcePath);
  });

  // 关系可信度只决定保留哪条边；最终展示顺序仍服从父任务原始 children。
  allTasks.forEach((parent) => {
    const childOrder = new Map(parent.childNames.map((childName, index) => [childName, index]));
    parent.summary.childSourcePaths.sort((leftPath, rightPath) => {
      const leftName = taskBySourcePath.get(leftPath)?.directoryName;
      const rightName = taskBySourcePath.get(rightPath)?.directoryName;
      const leftOrder = leftName === undefined ? Number.MAX_SAFE_INTEGER :
        (childOrder.get(leftName) ?? Number.MAX_SAFE_INTEGER);
      const rightOrder = rightName === undefined ? Number.MAX_SAFE_INTEGER :
        (childOrder.get(rightName) ?? Number.MAX_SAFE_INTEGER);
      return leftOrder - rightOrder || leftPath.localeCompare(rightPath);
    });
  });

  const active = activeTasks.map((task) => task.summary).sort(compareTasks);
  const archived = archivedTasks.map((task) => task.summary).sort(compareTasks);
  return { active, archived };
}

/** 为同一父子候选边生成稳定键。 */
function createTaskRelationKey(parent: ParsedTask, child: ParsedTask): string {
  return `${parent.summary.sourcePath}\u0000${child.summary.sourcePath}`;
}

/** 双向一致关系优先，其次按声明方向和目录名稳定排序。 */
function compareTaskRelationCandidates(
  left: TaskRelationCandidate,
  right: TaskRelationCandidate,
): number {
  const priorityDifference = readTaskRelationPriority(left) - readTaskRelationPriority(right);
  if (priorityDifference !== 0) {
    return priorityDifference;
  }
  if (
    left.parent.directoryName === right.parent.directoryName &&
    left.parentDeclarationIndex !== null &&
    right.parentDeclarationIndex !== null
  ) {
    return left.parentDeclarationIndex - right.parentDeclarationIndex;
  }
  return left.parent.directoryName.localeCompare(right.parent.directoryName) ||
    left.child.directoryName.localeCompare(right.child.directoryName);
}

/** 返回关系候选优先级，数值越小可信度越高。 */
function readTaskRelationPriority(candidate: TaskRelationCandidate): number {
  if (candidate.declaredByParent && candidate.declaredByChild) {
    return 0;
  }
  return candidate.declaredByParent ? 1 : 2;
}

/** 判断新增父子边是否会闭合已有祖先链。 */
function wouldCreateTaskCycle(
  parentPath: string,
  childPath: string,
  parentByChildPath: Map<string, string>,
): boolean {
  const visited = new Set<string>();
  let currentPath: string | undefined = parentPath;
  while (currentPath !== undefined && !visited.has(currentPath)) {
    if (currentPath === childPath) {
      return true;
    }
    visited.add(currentPath);
    currentPath = parentByChildPath.get(currentPath);
  }
  return false;
}

/** 构建稳定中文的任务关系诊断。 */
function createTaskRelationDiagnostic(code: string, sourcePath: string): SnapshotDiagnostic {
  const messages: Record<string, string> = {
    "task-relation-field-invalid": "任务关系字段格式不正确，已忽略非法内容",
    "task-relation-name-duplicate": "任务目录名称重复，部分父子关系无法解析",
    "task-relation-self-reference": "任务不能将自身声明为子任务，已忽略该关系",
    "task-relation-parent-conflict": "任务声明了多个父任务，已按关系一致性保留一条关系",
    "task-relation-cycle": "任务父子关系形成循环，已忽略该关系",
    "task-relation-child-duplicate": "父任务重复引用同一子任务，已忽略重复关系",
    "task-relation-child-missing": "父任务引用的子任务不存在",
    "task-relation-parent-missing": "任务引用的父任务不存在",
    "task-relation-asymmetric": "任务父子关系双向声明不一致，已按可解析关系展示",
  };
  return {
    severity: "warning",
    code,
    message: messages[code] ?? "任务父子关系无法解析",
    sourcePath,
  };
}

/** 活动任务缺少 prd.md 时记录警告。 */
async function validateActiveTaskPrd(
  project: ValidatedTrellisProject,
  taskRoot: string,
  diagnostics: SnapshotDiagnostic[],
): Promise<void> {
  const prdPath = join(taskRoot, "prd.md");
  if (!(await isRegularFile(prdPath))) {
    diagnostics.push({
      severity: "warning",
      code: "task-prd-missing",
      message: "活动任务缺少 prd.md",
      sourcePath: toProjectRelativePath(project.projectRoot, prdPath),
    });
  }
}

/** 发现并逐行验证任务目录中的 JSONL 文件。 */
async function validateTaskJsonlFiles(
  project: ValidatedTrellisProject,
  taskRoot: string,
  diagnostics: SnapshotDiagnostic[],
): Promise<void> {
  const pendingDirectories = [taskRoot];
  while (pendingDirectories.length > 0) {
    const currentDirectory = pendingDirectories.pop();
    if (currentDirectory === undefined) {
      break;
    }

    let directory;
    try {
      directory = await opendir(currentDirectory);
    } catch {
      diagnostics.push(
        createFileDiagnostic(
          "task-directory-unreadable",
          toProjectRelativePath(project.projectRoot, currentDirectory),
          "warning",
        ),
      );
      continue;
    }

    for await (const entry of directory) {
      const entryPath = join(currentDirectory, entry.name);
      if (entry.isSymbolicLink()) {
        continue;
      }
      if (entry.isDirectory()) {
        pendingDirectories.push(entryPath);
      } else if (entry.isFile() && extname(entry.name).toLowerCase() === ".jsonl") {
        await validateJsonlFile(project, entryPath, diagnostics);
      }
    }
  }
}

/** 验证 JSONL 文件的每个非空行。 */
async function validateJsonlFile(
  project: ValidatedTrellisProject,
  filePath: string,
  diagnostics: SnapshotDiagnostic[],
): Promise<void> {
  const sourcePath = toProjectRelativePath(project.projectRoot, filePath);
  let content: string;
  try {
    content = await readUtf8File(filePath);
  } catch {
    diagnostics.push(createFileDiagnostic("task-jsonl-read-failed", sourcePath));
    return;
  }

  content.split(/\r?\n/u).forEach((line, index) => {
    if (line.trim() === "") {
      return;
    }
    try {
      JSON.parse(line) as unknown;
    } catch {
      diagnostics.push({
        severity: "error",
        code: "task-jsonl-invalid",
        message: `第 ${index + 1} 行不是合法 JSON`,
        sourcePath,
      });
    }
  });
}

/** 解析 Workflow 名称、阶段标题和项目当前阶段。 */
async function parseWorkflow(
  project: ValidatedTrellisProject,
  activeTasks: TaskSummarySnapshot[],
  diagnostics: SnapshotDiagnostic[],
): Promise<WorkflowSummarySnapshot> {
  const workflowPath = join(project.trellisRoot, "workflow.md");
  const sourcePath = toProjectRelativePath(project.projectRoot, workflowPath);
  let content: string;

  try {
    content = await readUtf8File(workflowPath);
  } catch {
    diagnostics.push(createFileDiagnostic("workflow-read-failed", sourcePath, "warning"));
    return { name: null, currentPhase: inferCurrentPhase(activeTasks), summary: null, sourcePath };
  }

  const name = content.match(/^#\s+(.+)$/mu)?.[1]?.trim() || null;
  const phases = new Map<string, string>();
  const phasePattern = /^###\s+Phase\s+(\d+):\s*(.+)$/gmu;
  for (const match of content.matchAll(phasePattern)) {
    const phaseKey = phaseNumberToKey(match[1]);
    const phaseTitle = match[2]?.trim();
    if (phaseKey !== null && phaseTitle && !phases.has(phaseKey)) {
      phases.set(phaseKey, `Phase ${match[1]}: ${phaseTitle}`);
    }
  }

  const currentPhase = inferCurrentPhase(activeTasks);
  return {
    name,
    currentPhase,
    summary: currentPhase === null ? null : (phases.get(currentPhase) ?? null),
    sourcePath,
  };
}

/** 根据活动任务状态推断项目当前 Workflow 阶段。 */
function inferCurrentPhase(activeTasks: TaskSummarySnapshot[]): string | null {
  if (activeTasks.some((task) => task.status === "in_progress")) {
    return "execute";
  }
  if (activeTasks.some((task) => task.status === "planning")) {
    return "plan";
  }
  return null;
}

/** 将 Workflow 阶段编号映射为稳定键。 */
function phaseNumberToKey(phaseNumber: string | undefined): string | null {
  switch (phaseNumber) {
    case "1":
      return "plan";
    case "2":
      return "execute";
    case "3":
      return "finish";
    default:
      return null;
  }
}

/** 将任务状态映射为 Workflow 阶段。 */
function mapTaskStatusToPhase(status: string): string | null {
  switch (status) {
    case "planning":
      return "plan";
    case "in_progress":
      return "execute";
    case "completed":
      return "completed";
    default:
      return null;
  }
}

/** 读取 task.json 或任务目录的修改时间。 */
async function readTaskModifiedAt(taskJsonPath: string, taskRoot: string): Promise<string | null> {
  try {
    return (await stat(taskJsonPath)).mtime.toISOString();
  } catch {
    try {
      return (await stat(taskRoot)).mtime.toISOString();
    } catch {
      return null;
    }
  }
}

/** 判断路径是否为普通文件。 */
async function isRegularFile(filePath: string): Promise<boolean> {
  try {
    const fileStat = await lstat(filePath);
    return fileStat.isFile() && !fileStat.isSymbolicLink();
  } catch {
    return false;
  }
}

/** 判断路径是否为普通目录。 */
async function isDirectory(directoryPath: string): Promise<boolean> {
  try {
    const directoryStat = await lstat(directoryPath);
    return directoryStat.isDirectory() && !directoryStat.isSymbolicLink();
  } catch {
    return false;
  }
}

/** Spec 节点按目录优先、名称升序排列。 */
function compareSpecNodes(left: SpecTreeNode, right: SpecTreeNode): number {
  if (left.kind !== right.kind) {
    return left.kind === "directory" ? -1 : 1;
  }
  return left.name.localeCompare(right.name);
}

/** Task 摘要按最近修改时间倒序排列。 */
function compareTasks(left: TaskSummarySnapshot, right: TaskSummarySnapshot): number {
  return (right.updatedAt ?? "").localeCompare(left.updatedAt ?? "");
}

/** 构建统一文件诊断。 */
function createFileDiagnostic(
  code: string,
  sourcePath: string,
  severity: SnapshotDiagnostic["severity"] = "error",
): SnapshotDiagnostic {
  const messages: Record<string, string> = {
    "config-read-failed": "config.yaml 读取失败",
    "config-yaml-invalid": "config.yaml 不是合法 YAML",
    "spec-directory-unreadable": "Spec 目录无法读取",
    "tasks-directory-unreadable": "Task 目录无法读取",
    "archive-directory-unreadable": "归档 Task 目录无法读取",
    "task-json-read-failed": "task.json 读取失败",
    "task-json-invalid": "task.json 不是合法 JSON",
    "task-directory-unreadable": "Task 子目录无法读取",
    "task-jsonl-read-failed": "Task JSONL 文件读取失败",
    "workflow-read-failed": "workflow.md 读取失败",
  };
  return {
    severity,
    code,
    message: messages[code] ?? "文件解析失败",
    sourcePath,
  };
}

/** 格式化 Zod 校验问题。 */
function formatZodIssues(error: z.ZodError): string {
  return error.issues
    .map((issue) => `${issue.path.join(".") || "root"}: 字段格式不正确`)
    .join("; ");
}
