import { watch, type FSWatcher } from "chokidar";
import { join } from "node:path";
import type { ProjectWatchMode } from "../../shared/project-events.js";

/** 单个项目监听器接收的回调。 */
export interface ProjectFileWatcherCallbacks {
  onChange: (absolutePath: string) => void;
  onError: (error: Error) => void;
}

/** 创建项目监听器时需要的稳定参数。 */
export interface ProjectFileWatcherOptions extends ProjectFileWatcherCallbacks {
  projectRoot: string;
  mode: ProjectWatchMode;
  pollingIntervalMs: number;
}

/** 实时管理器依赖的最小文件监听接口。 */
export interface ProjectFileWatcher {
  readonly mode: ProjectWatchMode;
  start(): Promise<void>;
  close(): Promise<void>;
}

/** 文件监听器工厂，验证时可替换为受控实现。 */
export type ProjectFileWatcherFactory = (
  options: ProjectFileWatcherOptions,
) => ProjectFileWatcher;

/** 使用 Chokidar 封装原生事件和低频轮询模式。 */
export class ChokidarProjectFileWatcher implements ProjectFileWatcher {
  private watcher: FSWatcher | null = null;

  /** 创建指定项目和模式的监听器。 */
  constructor(private readonly options: ProjectFileWatcherOptions) {}

  /** 当前监听模式。 */
  get mode(): ProjectWatchMode {
    return this.options.mode;
  }

  /** 启动监听并等待 Chokidar 完成初始目录建立。 */
  async start(): Promise<void> {
    if (this.watcher !== null) {
      return;
    }

    const watcher = watch(resolveWatchPaths(this.options.projectRoot), {
      persistent: true,
      ignoreInitial: true,
      followSymlinks: false,
      usePolling: this.options.mode === "polling",
      interval: this.options.pollingIntervalMs,
      binaryInterval: this.options.pollingIntervalMs,
      ignorePermissionErrors: false,
      atomic: true,
      awaitWriteFinish: {
        stabilityThreshold: 200,
        pollInterval: 50,
      },
    });
    this.watcher = watcher;

    await new Promise<void>((resolve, reject) => {
      let ready = false;

      watcher.on("all", (_eventName, filePath) => {
        this.options.onChange(filePath);
      });
      watcher.on("error", (error) => {
        const normalizedError = error instanceof Error ? error : new Error("文件监听发生未知错误");
        if (!ready) {
          reject(normalizedError);
          return;
        }

        this.options.onError(normalizedError);
      });
      watcher.once("ready", () => {
        ready = true;
        resolve();
      });
    });
  }

  /** 关闭底层监听器并释放系统资源。 */
  async close(): Promise<void> {
    const watcher = this.watcher;
    this.watcher = null;
    if (watcher !== null) {
      await watcher.close();
    }
  }
}

/** 创建生产环境使用的 Chokidar 项目监听器。 */
export function createProjectFileWatcher(
  options: ProjectFileWatcherOptions,
): ProjectFileWatcher {
  return new ChokidarProjectFileWatcher(options);
}

/** 计算单个焦点项目的固定监听路径。 */
function resolveWatchPaths(projectRoot: string): string[] {
  const trellisRoot = join(projectRoot, ".trellis");
  return [
    join(trellisRoot, "spec"),
    join(trellisRoot, "tasks"),
    join(trellisRoot, "config.yaml"),
    join(trellisRoot, "workflow.md"),
  ];
}
