import {
  CircleOff,
  FolderClock,
  Layers3,
  ListChecks,
  Plus,
  Radio,
  RefreshCw,
} from "lucide-react";
import type { ProjectListItem } from "../../shared/api";
import { formatDateTime, formatWatchMode } from "../formatters";
import type { AsyncState, ConsoleMode, EventStreamState } from "../hooks/useProjectConsole";

interface ProjectSidebarProps {
  projects: AsyncState<ProjectListItem[]>;
  mode: ConsoleMode;
  selectedProjectId: string | null;
  eventStreamState: EventStreamState;
  onSelectProject: (projectId: string) => void;
  onOpenTaskCenter: () => void;
  onOpenDiscovery: () => void;
  onRetry: () => void;
}

/** 展示焦点、历史和不可用项目分组导航。 */
export function ProjectSidebar({
  projects,
  mode,
  selectedProjectId,
  eventStreamState,
  onSelectProject,
  onOpenTaskCenter,
  onOpenDiscovery,
  onRetry,
}: ProjectSidebarProps) {
  const data = projects.data ?? [];
  const focus = data.filter((item) => item.project.state === "focus");
  const history = data.filter((item) => item.project.state === "history");
  const unavailable = data.filter((item) => item.project.state === "unavailable");
  const activeProjectId = mode === "project" ? selectedProjectId : null;

  return (
    <aside className="project-sidebar" aria-label="项目导航">
      <div className="brand-row">
        <div className="brand-icon" aria-hidden="true">
          T
        </div>
        <div>
          <strong>Trellis Console</strong>
          <span>LOCAL · READ ONLY</span>
        </div>
      </div>

      <div className={`connection-chip connection-chip--${eventStreamState}`} aria-live="polite">
        <Radio size={14} aria-hidden="true" />
        {eventStreamState === "connected"
          ? "实时通道已连接"
          : eventStreamState === "reconnecting"
            ? "实时通道重连中"
            : "正在连接实时通道"}
      </div>

      <button
        className={`sidebar-mode-button ${mode === "tasks" ? "sidebar-mode-button--active" : ""}`}
        type="button"
        aria-current={mode === "tasks" ? "page" : undefined}
        onClick={onOpenTaskCenter}
      >
        <ListChecks size={16} aria-hidden="true" />
        <span>
          <strong>任务中心</strong>
          <small>跨项目搜索与筛选</small>
        </span>
      </button>

      <button className="primary-button primary-button--wide" type="button" onClick={onOpenDiscovery}>
        <Plus size={16} aria-hidden="true" />
        添加项目
      </button>

      <nav className="project-groups">
        {projects.loading && data.length === 0 ? (
          <div className="sidebar-state">正在读取项目列表…</div>
        ) : projects.error !== null ? (
          <div className="sidebar-state sidebar-state--error" role="alert">
            <span>{projects.error}</span>
            <button type="button" onClick={onRetry}>
              <RefreshCw size={14} aria-hidden="true" />
              重试
            </button>
          </div>
        ) : (
          <>
            <ProjectGroup
              title="焦点项目"
              icon={<Layers3 size={15} aria-hidden="true" />}
              projects={focus}
              selectedProjectId={activeProjectId}
              onSelect={onSelectProject}
            />
            <ProjectGroup
              title="历史项目"
              icon={<FolderClock size={15} aria-hidden="true" />}
              projects={history}
              selectedProjectId={activeProjectId}
              onSelect={onSelectProject}
            />
            <ProjectGroup
              title="不可用"
              icon={<CircleOff size={15} aria-hidden="true" />}
              projects={unavailable}
              selectedProjectId={activeProjectId}
              onSelect={onSelectProject}
            />
          </>
        )}
      </nav>

      <footer className="sidebar-footer">
        <span>{data.length} 个已登记项目</span>
        <span>仅访问本机 127.0.0.1</span>
      </footer>
    </aside>
  );
}

interface ProjectGroupProps {
  title: string;
  icon: React.ReactNode;
  projects: ProjectListItem[];
  selectedProjectId: string | null;
  onSelect: (projectId: string) => void;
}

/** 展示一个状态分组中的项目按钮。 */
function ProjectGroup({ title, icon, projects, selectedProjectId, onSelect }: ProjectGroupProps) {
  return (
    <section className="project-group">
      <header>
        {icon}
        <span>{title}</span>
        <small>{projects.length}</small>
      </header>
      {projects.length === 0 ? (
        <p>暂无项目</p>
      ) : (
        <div className="project-list">
          {projects.map((item) => (
            <button
              key={item.project.id}
              className={`project-item ${selectedProjectId === item.project.id ? "project-item--active" : ""}`}
              type="button"
              onClick={() => onSelect(item.project.id)}
              aria-current={selectedProjectId === item.project.id ? "page" : undefined}
            >
              <span className={`status-dot status-dot--${item.project.state}`} aria-hidden="true" />
              <span className="project-item-copy">
                <strong>{item.project.label}</strong>
                <small>{formatWatchMode(item.runtime.watchMode)} · {formatDateTime(item.project.lastIndexedAt)}</small>
              </span>
              {item.diagnosticCount > 0 ? <span className="count-badge">{item.diagnosticCount}</span> : null}
            </button>
          ))}
        </div>
      )}
    </section>
  );
}
