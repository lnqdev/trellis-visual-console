import { lstat, realpath } from "node:fs/promises";
import { basename, join } from "node:path";
import type { SnapshotDiagnostic } from "../storage/models.js";
import { getFileSystemAccessMessage } from "./filesystem-errors.js";
import type { ProjectValidationResult } from "./project-models.js";
import { createStableProjectId } from "./project-paths.js";

interface RequiredTrellisEntry {
  name: string;
  kind: "file" | "directory";
}

const REQUIRED_TRELLIS_ENTRIES: RequiredTrellisEntry[] = [
  { name: "config.yaml", kind: "file" },
  { name: "spec", kind: "directory" },
  { name: "tasks", kind: "directory" },
];

/** 校验项目根目录是否包含可读取的 Trellis 基础结构。 */
export class ProjectValidator {
  /**
   * 校验单个项目目录。
   *
   * @param projectPath 用户提供的项目根目录
   * @returns 校验结果、真实路径和诊断
   */
  async validate(projectPath: string): Promise<ProjectValidationResult> {
    const diagnostics: SnapshotDiagnostic[] = [];

    let inputStat;
    try {
      inputStat = await lstat(projectPath);
    } catch (error) {
      diagnostics.push(createErrorDiagnostic("project-path-unavailable", error, projectPath));
      return { valid: false, project: null, diagnostics };
    }

    if (inputStat.isSymbolicLink()) {
      diagnostics.push({
        severity: "error",
        code: "project-symlink-rejected",
        message: "项目根目录不能是符号链接",
        sourcePath: projectPath,
      });
      return { valid: false, project: null, diagnostics };
    }
    if (!inputStat.isDirectory()) {
      diagnostics.push({
        severity: "error",
        code: "project-not-directory",
        message: "项目路径不是目录",
        sourcePath: projectPath,
      });
      return { valid: false, project: null, diagnostics };
    }

    const projectRoot = await realpath(projectPath);
    const trellisRoot = join(projectRoot, ".trellis");
    const trellisValid = await validateEntry(
      trellisRoot,
      { name: ".trellis", kind: "directory" },
      diagnostics,
    );

    if (trellisValid) {
      for (const entry of REQUIRED_TRELLIS_ENTRIES) {
        await validateEntry(join(trellisRoot, entry.name), entry, diagnostics);
      }
    }

    const valid = !diagnostics.some((diagnostic) => diagnostic.severity === "error");
    return {
      valid,
      project: valid
        ? {
            id: createStableProjectId(projectRoot),
            projectRoot,
            trellisRoot,
            label: basename(projectRoot),
          }
        : null,
      diagnostics,
    };
  }
}

/** 校验必需文件或目录，并拒绝符号链接。 */
async function validateEntry(
  entryPath: string,
  entry: RequiredTrellisEntry,
  diagnostics: SnapshotDiagnostic[],
): Promise<boolean> {
  try {
    const entryStat = await lstat(entryPath);
    if (entryStat.isSymbolicLink()) {
      diagnostics.push({
        severity: "error",
        code: "trellis-symlink-rejected",
        message: `${entry.name} 不能是符号链接`,
        sourcePath: entryPath,
      });
      return false;
    }

    const kindMatches = entry.kind === "directory" ? entryStat.isDirectory() : entryStat.isFile();
    if (!kindMatches) {
      diagnostics.push({
        severity: "error",
        code: "trellis-entry-type-invalid",
        message: `${entry.name} 类型不正确，期望为${entry.kind === "directory" ? "目录" : "文件"}`,
        sourcePath: entryPath,
      });
      return false;
    }

    return true;
  } catch (error) {
    diagnostics.push(createErrorDiagnostic("trellis-entry-unavailable", error, entryPath));
    return false;
  }
}

/** 将文件系统错误转换为统一诊断。 */
function createErrorDiagnostic(
  code: string,
  error: unknown,
  sourcePath: string,
): SnapshotDiagnostic {
  return {
    severity: "error",
    code,
    message: getFileSystemAccessMessage(
      error,
      code === "project-path-unavailable" ? "项目路径" : "Trellis 必需文件或目录",
    ),
    sourcePath,
  };
}
