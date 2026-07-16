import open from "open";
import { lstat, realpath } from "node:fs/promises";
import {
  normalizeProjectRelativePath,
  resolveSafeProjectPath,
} from "./project-paths.js";
import { UnsafeProjectPathError } from "./project-models.js";

/** 打开已登记项目目录或项目 `.trellis` 内的合法源路径。 */
export async function openProjectSourcePath(
  projectRoot: string,
  sourcePath?: string,
): Promise<void> {
  if (sourcePath === undefined) {
    const projectStat = await lstat(projectRoot);
    if (projectStat.isSymbolicLink() || !projectStat.isDirectory()) {
      throw new UnsafeProjectPathError("项目根目录无效或为符号链接");
    }
    await open(await realpath(projectRoot));
    return;
  }

  const normalizedPath = normalizeProjectRelativePath(sourcePath);
  if (!normalizedPath.startsWith(".trellis/")) {
    throw new UnsafeProjectPathError("只允许打开项目 .trellis 内的源路径");
  }

  const safePath = await resolveSafeProjectPath(projectRoot, normalizedPath, ".trellis");
  if (!safePath.stats.isFile() && !safePath.stats.isDirectory()) {
    throw new UnsafeProjectPathError("源路径不是普通文件或目录");
  }
  await open(safePath.realPath);
}
