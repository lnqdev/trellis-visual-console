import { stat } from "node:fs/promises";
import { extname } from "node:path";
import type { ProjectMarkdownDocument } from "./project-models.js";
import { UnsafeProjectPathError } from "./project-models.js";
import {
  normalizeProjectRelativePath,
  readUtf8File,
  resolveSafeProjectPath,
} from "./project-paths.js";

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
  const safePath = await resolveSafeProjectPath(projectRoot, normalizedPath, ".trellis");
  if (!safePath.stats.isFile()) {
    throw new UnsafeProjectPathError("Markdown 路径不是普通文件");
  }

  const metadata = await stat(safePath.realPath);
  return {
    content: await readUtf8File(safePath.realPath),
    sourcePath: normalizedPath,
    modifiedAt: metadata.mtime.toISOString(),
  };
}

/** 规范化并校验 Markdown 相对路径。 */
function normalizeMarkdownPath(relativePath: string): string {
  const normalizedPath = normalizeProjectRelativePath(relativePath);
  if (!normalizedPath.startsWith(".trellis/")) {
    throw new UnsafeProjectPathError("Markdown 路径必须位于项目 .trellis 目录内");
  }
  if (extname(normalizedPath).toLowerCase() !== ".md") {
    throw new UnsafeProjectPathError("只允许读取 Markdown 文件");
  }

  return normalizedPath;
}
