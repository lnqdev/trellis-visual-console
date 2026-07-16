/** 将底层文件系统错误转换为不暴露运行时细节的中文提示。 */
export function getFileSystemAccessMessage(error: unknown, targetLabel: string): string {
  const errorCode = getErrorCode(error);
  if (errorCode === "ENOENT") {
    return `${targetLabel}不存在`;
  }
  if (errorCode === "EACCES" || errorCode === "EPERM") {
    return `没有权限访问${targetLabel}`;
  }
  return `${targetLabel}无法访问`;
}

/** 从未知错误中安全提取 Node 文件系统错误码。 */
function getErrorCode(error: unknown): string | null {
  if (typeof error !== "object" || error === null || !("code" in error)) {
    return null;
  }
  return typeof error.code === "string" ? error.code : null;
}
