import { opendir, stat } from "node:fs/promises";
import { basename, dirname, extname, join, relative, sep } from "node:path";
import type { ProjectSnapshot } from "../storage/models.js";
import type {
  ProjectTaskDetail,
  ProjectTaskDocument,
  ProjectTaskDocumentSummary,
} from "./project-models.js";
import { UnsafeProjectPathError } from "./project-models.js";
import {
  normalizeProjectRelativePath,
  readUtf8File,
  resolveSafeProjectPath,
  toProjectRelativePath,
} from "./project-paths.js";

/** 快照中不存在指定 Task。 */
export class ProjectTaskNotFoundError extends Error {
  /** 创建 Task 不存在错误。 */
  constructor(message: string) {
    super(message);
    this.name = "ProjectTaskNotFoundError";
  }
}

/** Task 中不存在指定文档。 */
export class ProjectTaskDocumentNotFoundError extends Error {
  /** 创建 Task 文档不存在错误。 */
  constructor(message: string) {
    super(message);
    this.name = "ProjectTaskDocumentNotFoundError";
  }
}

/** 根据快照白名单列出一个 Task 的 Markdown 和 JSONL 文档。 */
export async function readProjectTaskDetail(
  projectRoot: string,
  snapshot: ProjectSnapshot,
  taskSourcePath: string,
): Promise<ProjectTaskDetail> {
  const task = [...snapshot.tasks.active, ...snapshot.tasks.archived].find(
    (item) => item.sourcePath === taskSourcePath,
  );
  if (task === undefined) {
    throw new ProjectTaskNotFoundError("当前项目快照中不存在指定 Task");
  }

  const normalizedTaskSourcePath = normalizeProjectRelativePath(task.sourcePath);
  if (
    !normalizedTaskSourcePath.startsWith(".trellis/tasks/") ||
    basename(normalizedTaskSourcePath) !== "task.json"
  ) {
    throw new UnsafeProjectPathError("Task 源路径不符合 Trellis 目录合同");
  }

  const safeTaskJson = await resolveSafeProjectPath(
    projectRoot,
    normalizedTaskSourcePath,
    ".trellis/tasks",
  );
  if (!safeTaskJson.stats.isFile()) {
    throw new UnsafeProjectPathError("Task 源路径不是普通文件");
  }

  const taskRoot = dirname(safeTaskJson.realPath);
  const documents = await walkTaskDocuments(
    safeTaskJson.realProjectRoot,
    taskRoot,
    taskRoot,
  );
  documents.sort(compareTaskDocuments);
  return { task, documents };
}

/** 读取已列入 Task 文档清单的 Markdown 或 JSONL 正文。 */
export async function readProjectTaskDocument(
  projectRoot: string,
  snapshot: ProjectSnapshot,
  taskSourcePath: string,
  documentPath: string,
): Promise<ProjectTaskDocument> {
  const detail = await readProjectTaskDetail(projectRoot, snapshot, taskSourcePath);
  const normalizedDocumentPath = normalizeProjectRelativePath(documentPath);
  const document = detail.documents.find(
    (item) => item.relativePath === normalizedDocumentPath,
  );
  if (document === undefined) {
    throw new ProjectTaskDocumentNotFoundError("当前 Task 中不存在指定文档");
  }

  const taskRootPath = dirname(normalizeProjectRelativePath(taskSourcePath));
  const safeDocument = await resolveSafeProjectPath(
    projectRoot,
    document.sourcePath,
    taskRootPath,
  );
  if (!safeDocument.stats.isFile()) {
    throw new UnsafeProjectPathError("Task 文档不是普通文件");
  }

  return {
    content: await readUtf8File(safeDocument.realPath),
    sourcePath: document.sourcePath,
    modifiedAt: safeDocument.stats.mtime.toISOString(),
    format: document.format,
  };
}

/** 递归列出 Task 根目录内允许展示的普通文档。 */
async function walkTaskDocuments(
  realProjectRoot: string,
  taskRoot: string,
  currentDirectory: string,
): Promise<ProjectTaskDocumentSummary[]> {
  const directory = await opendir(currentDirectory);
  const documents: ProjectTaskDocumentSummary[] = [];

  for await (const entry of directory) {
    const entryPath = join(currentDirectory, entry.name);
    if (entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory()) {
      documents.push(...(await walkTaskDocuments(realProjectRoot, taskRoot, entryPath)));
      continue;
    }
    if (!entry.isFile()) {
      continue;
    }

    const format = readTaskDocumentFormat(entry.name);
    if (format === null) {
      continue;
    }

    const metadata = await stat(entryPath);
    documents.push({
      name: entry.name,
      relativePath: relative(taskRoot, entryPath).split(sep).join("/"),
      sourcePath: toProjectRelativePath(realProjectRoot, entryPath),
      format,
      modifiedAt: metadata.mtime.toISOString(),
    });
  }

  return documents;
}

/** 根据扩展名识别 Task 文档展示方式。 */
function readTaskDocumentFormat(fileName: string): "markdown" | "jsonl" | null {
  switch (extname(fileName).toLowerCase()) {
    case ".md":
      return "markdown";
    case ".jsonl":
      return "jsonl";
    default:
      return null;
  }
}

/** 将核心规划文档排在研究文件和 JSONL 清单之前。 */
function compareTaskDocuments(
  left: ProjectTaskDocumentSummary,
  right: ProjectTaskDocumentSummary,
): number {
  const priority = new Map([
    ["prd.md", 0],
    ["design.md", 1],
    ["implement.md", 2],
  ]);
  const leftPriority = priority.get(left.relativePath) ?? 10;
  const rightPriority = priority.get(right.relativePath) ?? 10;
  return leftPriority - rightPriority || left.relativePath.localeCompare(right.relativePath);
}
