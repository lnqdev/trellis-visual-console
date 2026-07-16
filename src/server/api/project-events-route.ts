import type { ServerResponse } from "node:http";
import type { FastifyInstance } from "fastify";
import { ProjectEventHub } from "../realtime/project-event-hub.js";

const SSE_HEARTBEAT_MS = 15_000;

/** 注册项目实时事件 SSE 订阅接口。 */
export function registerProjectEventsRoute(
  server: FastifyInstance,
  eventHub: ProjectEventHub,
): void {
  const connections = new Set<ServerResponse>();

  server.get("/api/events", (request, reply) => {
    reply.hijack();
    const response = reply.raw;
    connections.add(response);
    response.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    });
    response.write(": connected\n\n");

    const unsubscribe = eventHub.subscribe((event) => {
      if (!response.writableEnded && !response.destroyed) {
        response.write(`id: ${event.id}\ndata: ${JSON.stringify(event)}\n\n`);
      }
    });
    const heartbeat = setInterval(() => {
      if (!response.writableEnded && !response.destroyed) {
        response.write(": heartbeat\n\n");
      }
    }, SSE_HEARTBEAT_MS);

    let cleaned = false;
    /** 幂等释放单条 SSE 连接的订阅和心跳。 */
    const cleanup = (): void => {
      if (cleaned) {
        return;
      }
      cleaned = true;
      clearInterval(heartbeat);
      unsubscribe();
      connections.delete(response);
    };

    request.raw.once("aborted", cleanup);
    response.once("close", cleanup);
  });

  server.addHook("onClose", async () => {
    // Fastify 关闭前先结束长连接，避免 SSE 阻塞服务退出。
    for (const response of connections) {
      response.end();
    }
    connections.clear();
  });
}
