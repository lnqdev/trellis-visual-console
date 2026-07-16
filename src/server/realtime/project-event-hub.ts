import { randomUUID } from "node:crypto";
import type {
  ProjectEventResource,
  ProjectInvalidationScope,
  ProjectRealtimeEvent,
  ProjectRealtimeEventType,
  ProjectRuntimeWatchMode,
} from "../../shared/project-events.js";

/** 发布事件时由调用方提供的业务字段。 */
export interface ProjectRealtimeEventInput {
  type: ProjectRealtimeEventType;
  projectId: string;
  resource: ProjectEventResource;
  scope: ProjectInvalidationScope;
  watchMode: ProjectRuntimeWatchMode;
}

/** 项目实时事件订阅函数。 */
export type ProjectEventListener = (event: ProjectRealtimeEvent) => void;

/** 集中生成事件 ID 和时间戳，并向进程内订阅者广播。 */
export class ProjectEventHub {
  private readonly listeners = new Set<ProjectEventListener>();

  /** 创建事件中心。 */
  constructor(private readonly onListenerError: (error: unknown) => void = () => undefined) {}

  /** 注册订阅者并返回取消订阅函数。 */
  subscribe(listener: ProjectEventListener): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  /** 创建并广播一条轻量项目事件。 */
  publish(input: ProjectRealtimeEventInput): ProjectRealtimeEvent {
    const event: ProjectRealtimeEvent = {
      id: randomUUID(),
      timestamp: new Date().toISOString(),
      ...input,
    };

    // 使用订阅者快照，允许监听函数在回调内安全取消订阅。
    for (const listener of [...this.listeners]) {
      try {
        listener(event);
      } catch (error) {
        this.onListenerError(error);
      }
    }

    return event;
  }

  /** 返回当前订阅者数量，供运行指标和验证使用。 */
  getSubscriberCount(): number {
    return this.listeners.size;
  }
}
