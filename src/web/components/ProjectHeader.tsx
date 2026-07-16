import { FolderOpen, Radio, RefreshCw, Star, StarOff } from "lucide-react";
import type { ProjectDetailResponse } from "../../shared/api";
import { formatDateTime, formatProjectState, formatWatchMode } from "../formatters";

interface ProjectHeaderProps {
  detail: ProjectDetailResponse;
  busyAction: string | null;
  onRefresh: () => void;
  onChangeFocus: (focused: boolean) => void;
  onOpenProject: () => void;
}

/** 展示项目身份、实时性和主要生命周期操作。 */
export function ProjectHeader({
  detail,
  busyAction,
  onRefresh,
  onChangeFocus,
  onOpenProject,
}: ProjectHeaderProps) {
  const focused = detail.project.state === "focus";
  return (
    <header className="project-header">
      <div className="project-title-block">
        <span className="eyebrow">PROJECT WORKSPACE</span>
        <div className="title-line">
          <h1>{detail.project.label}</h1>
          <span className={`state-badge state-badge--${detail.project.state}`}>
            {formatProjectState(detail.project.state)}
          </span>
        </div>
        <code>{detail.project.path}</code>
        <div className="project-meta-line">
          <span>
            <Radio size={14} aria-hidden="true" />
            {formatWatchMode(detail.runtime.watchMode)}
          </span>
          <span>最后索引 {formatDateTime(detail.project.lastIndexedAt)}</span>
          {detail.possiblyStale ? <span className="warning-text">数据可能不是实时状态</span> : null}
        </div>
      </div>

      <div className="project-actions">
        <button className="secondary-button" type="button" onClick={onOpenProject} disabled={busyAction !== null}>
          <FolderOpen size={16} aria-hidden="true" />
          打开目录
        </button>
        <button className="secondary-button" type="button" onClick={onRefresh} disabled={busyAction !== null}>
          <RefreshCw size={16} aria-hidden="true" className={busyAction?.startsWith("refresh:") ? "spin" : ""} />
          刷新
        </button>
        <button
          className={focused ? "danger-button" : "primary-button"}
          type="button"
          onClick={() => onChangeFocus(!focused)}
          disabled={busyAction !== null || detail.project.state === "unavailable"}
        >
          {focused ? <StarOff size={16} aria-hidden="true" /> : <Star size={16} aria-hidden="true" />}
          {focused ? "移出焦点" : "加入焦点"}
        </button>
      </div>
    </header>
  );
}
