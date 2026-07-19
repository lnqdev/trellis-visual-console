import type { FastifyInstance } from "fastify";
import { ZodError } from "zod";
import {
  DirectoryPickerRequestSchema,
  DirectoryPickerResponseSchema,
} from "../../shared/api.js";
import {
  DirectoryPicker,
  DirectoryPickerBusyError,
  DirectoryPickerUnavailableError,
  DirectoryPickerUnsupportedError,
} from "../system/directory-picker.js";
import { getErrorName, sendApiError } from "./api-errors.js";

/** 注册操作系统目录选择 HTTP 路由。 */
export function registerDirectoryPickerRoute(
  server: FastifyInstance,
  picker: DirectoryPicker,
): void {
  server.post("/api/system/directories/select", async (request, reply) => {
    try {
      DirectoryPickerRequestSchema.parse(request.body);
      const result = await picker.selectDirectory();
      return reply.send(DirectoryPickerResponseSchema.parse(result));
    } catch (error) {
      if (error instanceof ZodError) {
        return sendApiError(reply, 400, "invalid-request", "请求参数不正确");
      }
      if (error instanceof DirectoryPickerBusyError) {
        return sendApiError(reply, 409, "directory-picker-busy", error.message);
      }
      if (error instanceof DirectoryPickerUnsupportedError) {
        return sendApiError(reply, 501, "directory-picker-unsupported", error.message);
      }
      if (error instanceof DirectoryPickerUnavailableError) {
        request.log.error(
          { platform: process.platform, errorName: error.reasonName },
          "系统目录选择器启动失败",
        );
        return sendApiError(reply, 500, "directory-picker-unavailable", error.message);
      }

      request.log.error(
        { platform: process.platform, errorName: getErrorName(error) },
        "目录选择 API 处理失败",
      );
      return sendApiError(reply, 500, "internal-error", "本地服务处理请求失败");
    }
  });
}
