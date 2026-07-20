import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { z, ZodError, type ZodType } from "zod";
import {
  OpenProjectPathRequestSchema,
  OpenProjectPathResponseSchema,
  ProjectFocusRequestSchema,
  ProjectRegisterRequestSchema,
  ProjectScanRequestSchema,
} from "../../shared/api.js";
import { UnsafeProjectPathError } from "../projects/project-models.js";
import {
  ProjectTaskDocumentNotFoundError,
  ProjectTaskNotFoundError,
} from "../projects/task-reader.js";
import {
  ProjectApiContentUnavailableError,
  ProjectApiNotFoundError,
  ProjectApiService,
} from "./project-api-service.js";
import { getErrorName, sendApiError } from "./api-errors.js";

const ProjectParamsSchema = z.object({ projectId: z.string().min(1) }).strict();
const SpecDocumentQuerySchema = z.object({ path: z.string().min(1) }).strict();
const TaskDetailQuerySchema = z.object({ sourcePath: z.string().min(1) }).strict();
const TaskDocumentQuerySchema = z
  .object({
    taskSourcePath: z.string().min(1),
    path: z.string().min(1),
  })
  .strict();

/** 注册项目集合、详情、内容读取和生命周期 HTTP 路由。 */
export function registerProjectRoutes(
  server: FastifyInstance,
  service: ProjectApiService,
): void {
  server.get("/api/projects", async (_request, reply) => {
    return reply.send(await service.listProjects());
  });

  server.get("/api/tasks", async (_request, reply) => {
    return reply.send(await service.listTaskCenter());
  });

  server.post("/api/projects/scan", async (request, reply) => {
    return executeRoute(request, reply, async () => {
      const body = parseInput(ProjectScanRequestSchema, request.body);
      return reply.send(await service.scanProjects(body.rootPath));
    });
  });

  server.post("/api/projects/register", async (request, reply) => {
    return executeRoute(request, reply, async () => {
      const body = parseInput(ProjectRegisterRequestSchema, request.body);
      return reply.send(await service.registerProjects(body.projects));
    });
  });

  server.get("/api/projects/:projectId", async (request, reply) => {
    return executeRoute(request, reply, async () => {
      const params = parseInput(ProjectParamsSchema, request.params);
      return reply.send(await service.getProject(params.projectId));
    });
  });

  server.post("/api/projects/:projectId/focus", async (request, reply) => {
    return executeRoute(request, reply, async () => {
      const params = parseInput(ProjectParamsSchema, request.params);
      const body = parseInput(ProjectFocusRequestSchema, request.body);
      return reply.send(await service.setProjectFocus(params.projectId, body.focused));
    });
  });

  server.post("/api/projects/:projectId/refresh", async (request, reply) => {
    return executeRoute(request, reply, async () => {
      const params = parseInput(ProjectParamsSchema, request.params);
      return reply.send(await service.refreshProject(params.projectId));
    });
  });

  server.get("/api/projects/:projectId/spec-document", async (request, reply) => {
    return executeRoute(request, reply, async () => {
      const params = parseInput(ProjectParamsSchema, request.params);
      const query = parseInput(SpecDocumentQuerySchema, request.query);
      return reply.send(await service.readSpecDocument(params.projectId, query.path));
    });
  });

  server.get("/api/projects/:projectId/task-detail", async (request, reply) => {
    return executeRoute(request, reply, async () => {
      const params = parseInput(ProjectParamsSchema, request.params);
      const query = parseInput(TaskDetailQuerySchema, request.query);
      return reply.send(await service.readTaskDetail(params.projectId, query.sourcePath));
    });
  });

  server.get("/api/projects/:projectId/task-document", async (request, reply) => {
    return executeRoute(request, reply, async () => {
      const params = parseInput(ProjectParamsSchema, request.params);
      const query = parseInput(TaskDocumentQuerySchema, request.query);
      return reply.send(
        await service.readTaskDocument(params.projectId, query.taskSourcePath, query.path),
      );
    });
  });

  server.post("/api/projects/:projectId/open", async (request, reply) => {
    return executeRoute(request, reply, async () => {
      const params = parseInput(ProjectParamsSchema, request.params);
      const body = parseInput(OpenProjectPathRequestSchema, request.body ?? {});
      await service.openProjectPath(params.projectId, body.sourcePath);
      return reply.send(OpenProjectPathResponseSchema.parse({ opened: true }));
    });
  });
}

/** 解析未知路由输入并保留 Zod 的字段级错误。 */
function parseInput<T>(schema: ZodType<T>, value: unknown): T {
  return schema.parse(value);
}

/** 执行路由并将预期错误转换为稳定中文响应。 */
async function executeRoute(
  request: FastifyRequest,
  reply: FastifyReply,
  operation: () => Promise<FastifyReply>,
): Promise<FastifyReply> {
  try {
    return await operation();
  } catch (error) {
    if (error instanceof ZodError) {
      return sendApiError(reply, 400, "invalid-request", "请求参数不正确", formatZodError(error));
    }
    if (
      error instanceof ProjectApiNotFoundError ||
      error instanceof ProjectTaskNotFoundError ||
      error instanceof ProjectTaskDocumentNotFoundError ||
      isNodeError(error, "ENOENT")
    ) {
      return sendApiError(reply, 404, "resource-not-found", "请求的项目资源不存在");
    }
    if (error instanceof UnsafeProjectPathError) {
      return sendApiError(reply, 400, "unsafe-project-path", error.message);
    }
    if (error instanceof ProjectApiContentUnavailableError) {
      return sendApiError(reply, 409, "project-content-unavailable", error.message);
    }
    if (isNodeError(error, "EACCES") || isNodeError(error, "EPERM")) {
      return sendApiError(reply, 403, "project-access-denied", "没有权限访问该项目资源");
    }

    // 未知错误只记录类型，避免日志和响应泄漏本机绝对路径。
    request.log.error({ errorName: getErrorName(error) }, "项目 API 处理失败");
    return sendApiError(reply, 500, "internal-error", "本地服务处理请求失败");
  }
}

/** 将 Zod 问题格式化为不含请求原值的字段说明。 */
function formatZodError(error: ZodError): string[] {
  return error.issues.map((issue) => `${issue.path.join(".") || "root"}: ${issue.message}`);
}

/** 判断未知错误是否为指定文件系统错误码。 */
function isNodeError(error: unknown, code: string): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error && error.code === code;
}
