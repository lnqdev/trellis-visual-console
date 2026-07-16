import fastifyStatic from "@fastify/static";
import Fastify, { type FastifyInstance } from "fastify";
import open from "open";
import { fileURLToPath } from "node:url";
import { SERVICE_NAME, type HealthResponse } from "../shared/health.js";

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
