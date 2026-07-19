import type { FastifyReply } from "fastify";
import { ApiErrorResponseSchema } from "../../shared/api.js";

/** 发送符合共享合同的 API 错误。 */
export function sendApiError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  details?: string[],
): FastifyReply {
  return reply.code(statusCode).send(
    ApiErrorResponseSchema.parse({
      code,
      message,
      ...(details === undefined ? {} : { details }),
    }),
  );
}

/** 提取不包含错误消息和文件路径的错误类型。 */
export function getErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
