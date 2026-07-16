import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import open from "open";
import { fileURLToPath } from "node:url";
import { basename } from "node:path";
import { SERVICE_NAME, type HealthResponse } from "../shared/health.js";
import { ProjectCatalog } from "./projects/project-catalog.js";
import { ProjectEventHub } from "./realtime/project-event-hub.js";
import { ProjectRealtimeManager } from "./realtime/project-realtime-manager.js";
import { createApplicationStorage } from "./storage/application-storage.js";

const HOST = "127.0.0.1";
const DEFAULT_PORT = 3100;
const isProduction = process.env.NODE_ENV === "production";
const webRoot = fileURLToPath(new URL("../web", import.meta.url));

/**
 * 创建本地只读服务实例。
 *
 * @returns 已注册基础路由的 Fastify 实例
 */
function createServer(): FastifyInstance {
  const server = Fastify({ logger: true });

  server.get("/api/health", async (): Promise<HealthResponse> => {
    return {
      status: "ok",
      service: SERVICE_NAME,
      timestamp: new Date().toISOString(),
    };
  });

  if (isProduction) {
    // 生产模式只托管本项目构建产物，不读取任何 Trellis 项目目录。
    void server.register(fastifyStatic, {
      root: webRoot,
      prefix: "/",
    });

    server.setNotFoundHandler(async (request, reply) => {
      if (request.url.startsWith("/api/")) {
        return reply.code(404).send({ message: "接口不存在" });
      }

      return reply.sendFile("index.html");
    });
  }

  return server;
}

/**
 * 解析服务端口，非法配置回退到默认端口。
 *
 * @returns 可用于监听的端口号
 */
function resolvePort(): number {
  const configuredPort = Number(process.env.PORT ?? DEFAULT_PORT);
  if (!Number.isInteger(configuredPort) || configuredPort <= 0 || configuredPort > 65535) {
    return DEFAULT_PORT;
  }

  return configuredPort;
}

/** 启动服务并注册退出清理逻辑。 */
async function startServer(): Promise<void> {
  const server = createServer();
  const storage = createApplicationStorage();
  const initialization = await storage.initialize();
  const catalog = new ProjectCatalog(storage);
  const eventHub = new ProjectEventHub((error) => {
    server.log.warn({ errorName: getErrorName(error) }, "项目事件订阅者处理失败");
  });
  const realtimeManager = new ProjectRealtimeManager(catalog, eventHub, {
    onOperationalError: (projectId, error) => {
      // 文件系统错误可能包含本机绝对路径，日志只保留项目 ID 和错误类型。
      server.log.warn(
        { projectId, errorName: getErrorName(error) },
        "焦点项目实时能力发生错误或进入降级",
      );
    },
  });

  server.addHook("onClose", async () => {
    await realtimeManager.close();
  });

  for (const recovery of initialization.recoveries) {
    server.log.warn(
      {
        file: basename(recovery.filePath),
        backup: basename(recovery.backupPath),
        reason: recovery.reason,
        message: recovery.message,
      },
      "应用数据文件损坏，已隔离原文件并恢复默认数据",
    );
  }

  const restoreResult = await realtimeManager.restoreFocusProjects();
  for (const failure of restoreResult.failures) {
    server.log.warn({ projectId: failure.projectId }, "焦点项目恢复失败或项目已不可用");
  }
  if (restoreResult.restoredProjectIds.length > 0) {
    const pollingCount = realtimeManager
      .listRuntimeStatuses()
      .filter((status) => status.watchMode === "polling").length;
    server.log.info(
      {
        restoredCount: restoreResult.restoredProjectIds.length,
        pollingCount,
      },
      "已恢复焦点项目监听",
    );
  }

  const address = await server.listen({ host: HOST, port: resolvePort() });

  if (isProduction) {
    try {
      // 浏览器打开失败不应中断已经正常运行的本地服务。
      await open(address);
    } catch (error) {
      server.log.warn({ error }, "自动打开浏览器失败，请手动访问服务地址");
    }
  }

  /** 接收系统信号后释放 HTTP 监听资源。 */
  const closeServer = async (signal: NodeJS.Signals): Promise<void> => {
    server.log.info({ signal }, "正在关闭本地服务");
    await server.close();
    process.exit(0);
  };

  process.once("SIGINT", () => void closeServer("SIGINT"));
  process.once("SIGTERM", () => void closeServer("SIGTERM"));
}

startServer().catch((error: unknown) => {
  console.error("本地服务启动失败", error);
  process.exit(1);
});

/** 提取不包含文件路径和正文的错误类型。 */
function getErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
