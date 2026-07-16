import { lstat, opendir, realpath } from "node:fs/promises";
import { join } from "node:path";
import type { SnapshotDiagnostic } from "../storage/models.js";
import type { ValidatedTrellisProject } from "./project-models.js";
import { ProjectValidator } from "./project-validator.js";

const IGNORED_DIRECTORY_NAMES = new Set([
  ".cache",
  ".git",
  ".hg",
  ".next",
  ".svn",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "out",
  "target",
]);

/** 扫描根目录发现有效 Trellis 项目。 */
export class ProjectScanner {
  /** 创建项目扫描器。 */
  constructor(private readonly validator = new ProjectValidator()) {}

  /**
   * 递归扫描用户指定目录，不跟随符号链接。
   *
   * @param scanRoot 用户选择的扫描根目录
   * @returns 有效项目和扫描诊断
   */
  async scan(
    scanRoot: string,
  ): Promise<{ projects: ValidatedTrellisProject[]; diagnostics: SnapshotDiagnostic[] }> {
    const diagnostics: SnapshotDiagnostic[] = [];
    const projects: ValidatedTrellisProject[] = [];
    const discoveredPaths = new Set<string>();

    let rootStat;
    try {
      rootStat = await lstat(scanRoot);
    } catch (error) {
      diagnostics.push(createScanDiagnostic("scan-root-unavailable", error, scanRoot, "error"));
      return { projects, diagnostics };
    }

    if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) {
      diagnostics.push({
        severity: "error",
        code: "scan-root-invalid",
        message: rootStat.isSymbolicLink() ? "扫描根目录不能是符号链接" : "扫描根路径不是目录",
        sourcePath: scanRoot,
      });
      return { projects, diagnostics };
    }

    const realScanRoot = await realpath(scanRoot);
    const pendingDirectories = [realScanRoot];

    while (pendingDirectories.length > 0) {
      const currentDirectory = pendingDirectories.pop();
      if (currentDirectory === undefined) {
        break;
      }

      let directory;
      try {
        directory = await opendir(currentDirectory);
      } catch (error) {
        diagnostics.push(
          createScanDiagnostic("scan-directory-unreadable", error, currentDirectory, "warning"),
        );
        continue;
      }

      for await (const entry of directory) {
        if (entry.isSymbolicLink()) {
          if (entry.name === ".trellis") {
            diagnostics.push({
              severity: "warning",
              code: "scan-trellis-symlink-skipped",
              message: "跳过符号链接形式的 .trellis 目录",
              sourcePath: join(currentDirectory, entry.name),
            });
          }
          continue;
        }
        if (!entry.isDirectory()) {
          continue;
        }

        if (entry.name === ".trellis") {
          const validation = await this.validator.validate(currentDirectory);
          diagnostics.push(...validation.diagnostics);
          if (
            validation.valid &&
            validation.project !== null &&
            !discoveredPaths.has(validation.project.projectRoot)
          ) {
            discoveredPaths.add(validation.project.projectRoot);
            projects.push(validation.project);
          }
          continue;
        }
        if (!IGNORED_DIRECTORY_NAMES.has(entry.name)) {
          pendingDirectories.push(join(currentDirectory, entry.name));
        }
      }
    }

    projects.sort((left, right) => left.projectRoot.localeCompare(right.projectRoot));
    return { projects, diagnostics };
  }
}

/** 将扫描文件系统错误转换为诊断。 */
function createScanDiagnostic(
  code: string,
  error: unknown,
  sourcePath: string,
  severity: SnapshotDiagnostic["severity"],
): SnapshotDiagnostic {
  return {
    severity,
    code,
    message: error instanceof Error ? error.message : "目录扫描失败",
    sourcePath,
  };
}
