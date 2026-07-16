import { lstat, realpath, stat } from "node:fs/promises";
import { extname, join, posix, resolve, win32 } from "node:path";
import type { ProjectMarkdownDocument } from "./project-models.js";
import { UnsafeProjectPathError } from "./project-models.js";
import { isPathInsideOrEqual, readUtf8File } from "./project-paths.js";

/**
 * 按需读取项目 `.trellis` 内的 Markdown 文件。
 *
 * @param projectRoot 已登记项目根目录
 * @param relativePath 相对项目根目录且位于 `.trellis` 内的 Markdown 路径
 * @returns Markdown 正文和文件元数据
 */
export async function readProjectMarkdown(
  projectRoot: string,
  relativePath: string,
): Promise<ProjectMarkdownDocument> {
  const normalizedPath = normalizeMarkdownPath(relativePath);
  const projectStat = await lstat(projectRoot);
  if (projectStat.isSymbolicLink() || !projectStat.isDirectory()) {
    throw new UnsafeProjectPathError("项目根目录无效或为符号链接");
  }

  const realProjectRoot = await realpath(projectRoot);
  const trellisRoot = join(realProjectRoot, ".trellis");
  const trellisStat = await lstat(trellisRoot);
  if (trellisStat.isSymbolicLink() || !trellisStat.isDirectory()) {
    throw new UnsafeProjectPathError("项目 .trellis 目录无效或为符号链接");
  }

  const realTrellisRoot = await realpath(trellisRoot);
  const candidatePath = resolve(realProjectRoot, ...normalizedPath.split("/"));
  const candidateStat = await lstat(candidatePath);
  if (candidateStat.isSymbolicLink() || !candidateStat.isFile()) {
    throw new UnsafeProjectPathError("Markdown 路径不是普通文件");
  }

  const realCandidatePath = await realpath(candidatePath);
  if (!isPathInsideOrEqual(realTrellisRoot, realCandidatePath)) {
    throw new UnsafeProjectPathError("Markdown 路径超出项目 .trellis 边界");
  }

  const metadata = await stat(realCandidatePath);
  return {
    content: await readUtf8File(realCandidatePath),
    sourcePath: normalizedPath,
    modifiedAt: metadata.mtime.toISOString(),
  };
}

/** 规范化并校验 Markdown 相对路径。 */
function normalizeMarkdownPath(relativePath: string): string {
  const slashPath = relativePath.replaceAll("\\", "/");
  if (posix.isAbsolute(slashPath) || win32.isAbsolute(relativePath)) {
    throw new UnsafeProjectPathError("Markdown 路径必须是相对路径");
  }
  if (slashPath.split("/").includes("..")) {
    throw new UnsafeProjectPathError("Markdown 路径不能包含上级目录片段");
  }

  const normalizedPath = posix.normalize(slashPath);
  if (
    normalizedPath === ".." ||
    normalizedPath.startsWith("../") ||
    !normalizedPath.startsWith(".trellis/")
  ) {
    throw new UnsafeProjectPathError("Markdown 路径必须位于项目 .trellis 目录内");
  }
  if (extname(normalizedPath).toLowerCase() !== ".md") {
    throw new UnsafeProjectPathError("只允许读取 Markdown 文件");
  }

  return normalizedPath;
}
