import { useEffect, useState } from "react";
import { isHealthResponse, type HealthResponse } from "../shared/health";

type ConnectionState =
  | { status: "loading" }
  | { status: "connected"; health: HealthResponse }
  | { status: "error"; message: string };

/** Trellis Visual Console 的首阶段页面壳。 */
export function App() {
  const [connection, setConnection] = useState<ConnectionState>({ status: "loading" });

  useEffect(() => {
    const controller = new AbortController();

    /** 读取本地服务健康状态，验证开发代理和共享接口合同。 */
    async function loadHealth(): Promise<void> {
      try {
        const response = await fetch("/api/health", { signal: controller.signal });
        if (!response.ok) {
          throw new Error(`健康检查失败：HTTP ${response.status}`);
        }

        const payload: unknown = await response.json();
        if (!isHealthResponse(payload)) {
          throw new Error("健康检查返回格式不正确");
        }

        setConnection({ status: "connected", health: payload });
      } catch (error) {
        if (controller.signal.aborted) {
          return;
        }

        const message = error instanceof Error ? error.message : "无法连接本地服务";
        setConnection({ status: "error", message });
      }
    }

    void loadHealth();
    return () => controller.abort();
  }, []);

  return (
    <main className="app-shell">
      <section className="intro-card" aria-labelledby="page-title">
        <div className="brand-mark" aria-hidden="true">
          T
        </div>
        <p className="eyebrow">LOCAL · READ ONLY</p>
        <h1 id="page-title">Trellis Visual Console</h1>
        <p className="summary">面向个人本机使用的 Trellis 只读可视化内容中心。</p>

        <div className={`health-panel health-panel--${connection.status}`} aria-live="polite">
          <span className="health-dot" aria-hidden="true" />
          <div>
            <strong>{getConnectionTitle(connection)}</strong>
            <p>{getConnectionDescription(connection)}</p>
          </div>
        </div>

        <div className="scope-grid" aria-label="首阶段项目边界">
          <article>
            <span>01</span>
            <h2>本地服务</h2>
            <p>固定绑定 127.0.0.1，仅建立只读 API 运行基础。</p>
          </article>
          <article>
            <span>02</span>
            <h2>浏览器界面</h2>
            <p>React 与 Vite 页面壳，当前只验证前后端连接。</p>
          </article>
          <article>
            <span>03</span>
            <h2>明确边界</h2>
            <p>尚未读取、扫描、监听或修改任何 Trellis 项目。</p>
          </article>
        </div>
      </section>
    </main>
  );
}

/** 获取连接状态标题。 */
function getConnectionTitle(connection: ConnectionState): string {
  switch (connection.status) {
    case "loading":
      return "正在连接本地服务";
    case "connected":
      return "本地服务已连接";
    case "error":
      return "本地服务连接失败";
  }
}

/** 获取连接状态说明。 */
function getConnectionDescription(connection: ConnectionState): string {
  switch (connection.status) {
    case "loading":
      return "正在验证 /api/health 接口…";
    case "connected":
      return `服务 ${connection.health.service} · ${formatTime(connection.health.timestamp)}`;
    case "error":
      return connection.message;
  }
}

/** 将 ISO 时间格式化为本地可读时间。 */
function formatTime(timestamp: string): string {
  return new Intl.DateTimeFormat("zh-CN", {
    dateStyle: "medium",
    timeStyle: "medium",
  }).format(new Date(timestamp));
}
