/** Trellis Visual Console 的固定服务标识。 */
export const SERVICE_NAME = "trellis-visual-console" as const;

/** 健康检查接口返回的数据结构。 */
export interface HealthResponse {
  status: "ok";
  service: typeof SERVICE_NAME;
  timestamp: string;
}

/**
 * 判断未知数据是否符合健康检查接口合同。
 *
 * @param value 待校验的接口响应
 * @returns 是否为合法的健康检查响应
 */
export function isHealthResponse(value: unknown): value is HealthResponse {
  if (typeof value !== "object" || value === null) {
    return false;
  }

  const candidate = value as Record<string, unknown>;
  return (
    candidate.status === "ok" &&
    candidate.service === SERVICE_NAME &&
    typeof candidate.timestamp === "string"
  );
}
