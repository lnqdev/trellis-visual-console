import { createHash } from "node:crypto";
import type { Stats } from "node:fs";
import { lstat, readFile, realpath } from "node:fs/promises";
import { isAbsolute, posix, relative, resolve, sep, win32 } from "node:path";
import { UnsafeProjectPathError } from "./project-models.js";

/** 受保护项目路径的解析结果。 */
export interface SafeProjectPath {
  normalizedPath: string;
  realProjectRoot: string;
  realPath: string;
  stats: Stats;
}

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

/** 规范化项目相对路径并拒绝绝对路径和原始上级目录片段。 */
export function normalizeProjectRelativePath(relativePath: string): string {
  const slashPath = relativePath.replaceAll("\\", "/");
  if (posix.isAbsolute(slashPath) || win32.isAbsolute(relativePath)) {
    throw new UnsafeProjectPathError("项目路径必须是相对路径");
  }
  if (slashPath.split("/").includes("..")) {
    throw new UnsafeProjectPathError("项目路径不能包含上级目录片段");
  }

  const normalizedPath = posix.normalize(slashPath);
  if (normalizedPath === "." || normalizedPath === ".." || normalizedPath.startsWith("../")) {
    throw new UnsafeProjectPathError("项目相对路径无效");
  }
  return normalizedPath;
}

/**
 * 将项目相对路径解析到指定边界内，并拒绝任意路径段中的符号链接。
 *
 * @param projectRoot 已登记项目根目录
 * @param relativePath 待解析的项目相对路径
 * @param boundaryPath 可信的项目相对边界目录
 */
export async function resolveSafeProjectPath(
  projectRoot: string,
  relativePath: string,
  boundaryPath: string,
): Promise<SafeProjectPath> {
  const normalizedPath = normalizeProjectRelativePath(relativePath);
  const normalizedBoundary = normalizeProjectRelativePath(boundaryPath);
  if (
    normalizedPath !== normalizedBoundary &&
    !normalizedPath.startsWith(`${normalizedBoundary}/`)
  ) {
    throw new UnsafeProjectPathError("项目路径超出允许读取边界");
  }

  const projectStat = await lstat(projectRoot);
  if (projectStat.isSymbolicLink() || !projectStat.isDirectory()) {
    throw new UnsafeProjectPathError("项目根目录无效或为符号链接");
  }

  const realProjectRoot = await realpath(projectRoot);
  const boundaryAbsolutePath = resolve(realProjectRoot, ...normalizedBoundary.split("/"));
  const boundaryStat = await lstat(boundaryAbsolutePath);
  if (boundaryStat.isSymbolicLink() || !boundaryStat.isDirectory()) {
    throw new UnsafeProjectPathError("项目读取边界无效或为符号链接");
  }

  const candidateAbsolutePath = resolve(realProjectRoot, ...normalizedPath.split("/"));
  if (!isPathInsideOrEqual(boundaryAbsolutePath, candidateAbsolutePath)) {
    throw new UnsafeProjectPathError("项目路径超出允许读取边界");
  }

  // 从边界开始逐段检查，避免路径中间的符号链接被 realpath 悄悄解析。
  let currentPath = boundaryAbsolutePath;
  const pathSegments = relative(boundaryAbsolutePath, candidateAbsolutePath)
    .split(sep)
    .filter(Boolean);
  for (const pathSegment of pathSegments) {
    currentPath = resolve(currentPath, pathSegment);
    const segmentStat = await lstat(currentPath);
    if (segmentStat.isSymbolicLink()) {
      throw new UnsafeProjectPathError("项目路径不能包含符号链接");
    }
  }

  const realBoundaryPath = await realpath(boundaryAbsolutePath);
  const realCandidatePath = await realpath(candidateAbsolutePath);
  if (!isPathInsideOrEqual(realBoundaryPath, realCandidatePath)) {
    throw new UnsafeProjectPathError("项目路径超出真实读取边界");
  }

  return {
    normalizedPath,
    realProjectRoot,
    realPath: realCandidatePath,
    stats: await lstat(realCandidatePath),
  };
}

/** 以严格 UTF-8 方式读取文本，非法字节会抛出错误。 */
export async function readUtf8File(filePath: string): Promise<string> {
  const content = await readFile(filePath);
  return new TextDecoder("utf-8", { fatal: true }).decode(content);
}
