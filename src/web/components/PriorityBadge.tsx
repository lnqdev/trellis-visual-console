import { formatTaskPriority, readTaskPriorityGroup } from "../formatters";

interface PriorityBadgeProps {
  /** 原始优先级；null 表示未设置，非法枚举会降级为 unknown 样式。 */
  priority: string | null;
}

/** 优先级徽标：P0-P3 按等级着色，未设置显示占位符，非法值使用告警色。 */
export function PriorityBadge({ priority }: PriorityBadgeProps) {
  const group = readTaskPriorityGroup(priority);
  const label = formatTaskPriority(priority);
  const title = priority === null
    ? "未设置优先级"
    : group === "unknown"
      ? `无法识别的优先级：${priority}`
      : `优先级 ${priority}`;

  return (
    <span className={`task-priority task-priority--${group}`} title={title}>
      {label}
    </span>
  );
}
