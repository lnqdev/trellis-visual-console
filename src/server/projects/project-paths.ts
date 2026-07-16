import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { isAbsolute, relative, sep } from "node:path";

/** 根据项目真实路径生成稳定项目 ID。 */
export function createStableProjectId(realProjectPath: string): string {
  return createHash("sha256").update(realProjectPath).digest("hex").slice(0, 24);
}

/** 判断候选路径是否位于父目录内部或等于父目录。 */
export function isPathInsideOrEqual(parentPath: string, candidatePath: string): boolean {
  const relativePath = relative(parentPath, candidatePath);
  return (
    relativePath === "" ||
    (!relativePath.startsWith(`..${sep}`) && relativePath !== ".." && !isAbsolute(relativePath))
  );
}

/** 将绝对路径转换为统一使用正斜杠的项目相对路径。 */
export function toProjectRelativePath(projectRoot: string, absolutePath: string): string {
  return relative(projectRoot, absolutePath).split(sep).join("/");
}

/** 以严格 UTF-8 方式读取文本，非法字节会抛出错误。 */
export async function readUtf8File(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return new TextDecoder("utf-8", { fatal: true }).decode(content);
}
