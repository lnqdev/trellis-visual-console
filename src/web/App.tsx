import {
  BookOpenText,
  GitBranch,
  LayoutDashboard,
  ListTodo,
  PanelLeftOpen,
  RefreshCw,
  TriangleAlert,
  X,
} from "lucide-react";
import type { CSSProperties } from "react";
import type { ProjectDetailResponse } from "../shared/api";
import { ApplicationUpdateDialog } from "./components/ApplicationUpdate";
import { DiagnosticsPanel } from "./components/DiagnosticsPanel";
import { ProjectDiscovery } from "./components/ProjectDiscovery";
import { ProjectHeader } from "./components/ProjectHeader";
import { ProjectOverview } from "./components/ProjectOverview";
import { ProjectSidebar } from "./components/ProjectSidebar";
import { SpecBrowser } from "./components/SpecBrowser";
import { TaskBrowser } from "./components/TaskBrowser";
import { TaskCenter } from "./components/TaskCenter";
import { WorkflowPanel } from "./components/WorkflowPanel";
import { isMacOSDesktopRuntime } from "./api-client";
import { useApplicationUpdater } from "./hooks/useApplicationUpdater";
import { useProjectConsole, type ProjectView } from "./hooks/useProjectConsole";
import { useResizablePanel } from "./hooks/useResizablePanel";
import { useSidebarCollapsed } from "./hooks/useSidebarCollapsed";

const PROJECT_VIEWS: Array<{
  id: ProjectView;
  label: string;
  icon: typeof LayoutDashboard;
}> = [
  { id: "overview", label: "概览", icon: LayoutDashboard },
  { id: "spec", label: "Spec", icon: BookOpenText },
  { id: "tasks", label: "Task", icon: ListTodo },
  { id: "workflow", label: "Workflow", icon: GitBranch },
  { id: "diagnostics", label: "诊断", icon: TriangleAlert },
];

/** Trellis Visual Console 主应用。 */
export function App() {
  const consoleState = useProjectConsole();
  const updater = useApplicationUpdater();
  const sidebar = useSidebarCollapsed();
  // 侧边栏宽度支持拖动调整，并持久化到本地存储
  const sidebarResize = useResizablePanel({
    storageKey: "trellis-console:sidebar-width",
    defaultWidth: 300,
    minWidth: 232,
    maxWidth: 460,
    ariaLabel: "调整侧边栏宽度",
  });
  const projectCount = consoleState.projects.data?.length ?? 0;
  const macOSDesktopRuntime = isMacOSDesktopRuntime();
  const shellStyle = { "--sidebar-width": `${sidebarResize.width}px` } as CSSProperties;

  return (
    <div
      className={`console-shell${macOSDesktopRuntime ? " console-shell--macos-overlay" : ""}${
        sidebar.collapsed ? " console-shell--sidebar-collapsed" : ""
      }${sidebarResize.resizing ? " console-shell--resizing" : ""}`}
      style={shellStyle}
    >
      {macOSDesktopRuntime ? (
        <div className="window-drag-region" data-tauri-drag-region="" aria-hidden="true" />
      ) : null}
      <ProjectSidebar
        projects={consoleState.projects}
        applicationVersion={updater.state.currentVersion ?? __APP_VERSION__}
        mode={consoleState.mode}
        selectedProjectId={consoleState.selectedProjectId}
        eventStreamState={consoleState.eventStreamState}
        busyAction={consoleState.busyAction}
        updater={updater}
        onSelectProject={consoleState.selectProject}
        onRemoveProject={(projectId) => void consoleState.removeRegisteredProject(projectId)}
        onOpenTaskCenter={consoleState.openTaskCenter}
        onOpenDiscovery={consoleState.openDiscovery}
        onRetry={consoleState.retryProjects}
        onCollapseSidebar={sidebar.toggle}
      />
      {/* 侧边栏与主内容之间的拖动分隔线 */}
      <div {...sidebarResize.separatorProps} />

      <main className="workspace-shell">
        {/* 侧边栏折叠后在主内容区顶部保留展开入口 */}
        {sidebar.collapsed ? (
          <div className="workspace-sidebar-launcher">
            <button
              className="icon-only-button sidebar-toggle-button"
              type="button"
              aria-label="展开侧边栏"
              aria-expanded={false}
              aria-keyshortcuts="Control+B Meta+B"
              title="展开侧边栏"
              onClick={sidebar.toggle}
            >
              <PanelLeftOpen size={17} aria-hidden="true" />
            </button>
          </div>
        ) : null}
        {consoleState.notice !== null ? (
          <div className={`global-notice global-notice--${consoleState.notice.tone}`} aria-live="polite">
            <span>{consoleState.notice.message}</span>
            <button type="button" onClick={consoleState.clearNotice} aria-label="关闭提示">
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        ) : null}

        {consoleState.discoveryOpen ? (
          <ProjectDiscovery
            canClose={projectCount > 0}
            busyAction={consoleState.busyAction}
            onScan={consoleState.discoverProjects}
            onSelectDirectory={consoleState.chooseDirectory}
            onRegister={consoleState.addProjects}
            onClose={consoleState.closeDiscovery}
          />
        ) : consoleState.mode === "tasks" ? (
          <TaskCenter
            state={consoleState.taskCenter}
            busy={consoleState.busyAction !== null}
            onOpenTask={(item) => void consoleState.openTaskCenterItem(item)}
            onOpenDiagnostics={consoleState.openProjectDiagnostics}
            onOpenDiscovery={consoleState.openDiscovery}
          />
        ) : consoleState.selectedProjectId === null ? (
          <section className="empty-workspace">
            <LayoutDashboard size={28} aria-hidden="true" />
            <h1>还没有已登记项目</h1>
            <p>添加一个扫描根目录或 Trellis 项目路径开始浏览。</p>
            <button className="primary-button" type="button" onClick={consoleState.openDiscovery}>
              添加项目
            </button>
          </section>
        ) : consoleState.detail.loading && consoleState.detail.data === null ? (
          <div className="workspace-loading">正在读取项目快照…</div>
        ) : consoleState.detail.error !== null ? (
          <section className="empty-workspace" role="alert">
            <TriangleAlert size={28} aria-hidden="true" />
            <h1>项目详情读取失败</h1>
            <p>{consoleState.detail.error}</p>
            <button className="secondary-button" type="button" onClick={consoleState.retryDetail}>
              <RefreshCw size={15} aria-hidden="true" />
              重试
            </button>
          </section>
        ) : consoleState.detail.data !== null ? (
          <ProjectWorkspace detail={consoleState.detail.data} consoleState={consoleState} />
        ) : null}
      </main>
      <ApplicationUpdateDialog updater={updater} />
    </div>
  );
}

interface ProjectWorkspaceProps {
  detail: ProjectDetailResponse;
  consoleState: ReturnType<typeof useProjectConsole>;
}

/** 组合单项目头部、主导航和当前内容视图。 */
function ProjectWorkspace({ detail, consoleState }: ProjectWorkspaceProps) {
  return (
    <div className="project-workspace">
      <ProjectHeader
        detail={detail}
        busyAction={consoleState.busyAction}
        onRefresh={() => void consoleState.refreshSelectedProject()}
        onChangeFocus={(focused) => void consoleState.changeFocus(focused)}
        onOpenProject={() => void consoleState.openSelectedPath()}
      />

      {detail.project.state === "history" ? (
        <div className="snapshot-banner">
          当前内容来自最后快照，只有显式刷新或加入焦点时才访问源项目。
        </div>
      ) : detail.runtime.watchMode === "polling" ? (
        <div className="snapshot-banner snapshot-banner--warning">
          原生文件事件不可用，当前使用低频轮询，更新可能存在延迟。
        </div>
      ) : null}

      <nav className="view-tabs" aria-label="项目内容视图">
        {PROJECT_VIEWS.map((item) => {
          const Icon = item.icon;
          const diagnosticCount = detail.snapshot?.diagnostics.length ?? 0;
          return (
            <button
              key={item.id}
              type="button"
              className={consoleState.view === item.id ? "active" : ""}
              aria-current={consoleState.view === item.id ? "page" : undefined}
              onClick={() => consoleState.selectView(item.id)}
            >
              <Icon size={15} aria-hidden="true" />
              {item.label}
              {item.id === "diagnostics" && diagnosticCount > 0 ? (
                <span className="count-badge">{diagnosticCount}</span>
              ) : null}
            </button>
          );
        })}
      </nav>

      <div className="view-content">
        {renderProjectView(detail, consoleState)}
      </div>
    </div>
  );
}

/** 根据当前导航状态渲染项目内容。 */
function renderProjectView(
  detail: ProjectDetailResponse,
  consoleState: ReturnType<typeof useProjectConsole>,
) {
  if (detail.snapshot === null && consoleState.view !== "diagnostics") {
    return <div className="content-state">项目没有可用快照，请先刷新或查看诊断。</div>;
  }

  switch (consoleState.view) {
    case "overview":
      return <ProjectOverview detail={detail} />;
    case "spec":
      if (!detail.contentReadable) {
        return <ReadonlySnapshotNotice resourceLabel="Spec 正文" />;
      }
      return (
        <SpecBrowser
          tree={detail.snapshot?.specTree ?? []}
          selectedPath={consoleState.selectedSpecPath}
          document={consoleState.specDocument}
          onSelectPath={consoleState.selectSpecPath}
          onOpenSource={(sourcePath) => void consoleState.openSelectedPath(sourcePath)}
          onNavigateDocument={consoleState.navigateDocumentLink}
          pendingDocumentAnchor={consoleState.pendingDocumentAnchor}
          onConsumeDocumentAnchor={consoleState.consumeDocumentAnchor}
        />
      );
    case "tasks":
      if (!detail.contentReadable) {
        return <ReadonlySnapshotNotice resourceLabel="Task 规划资料" />;
      }
      return (
        <TaskBrowser
          activeTasks={detail.snapshot?.tasks.active ?? []}
          archivedTasks={detail.snapshot?.tasks.archived ?? []}
          selectedTaskSourcePath={consoleState.selectedTaskSourcePath}
          selectedDocumentPath={consoleState.selectedTaskDocumentPath}
          taskDetail={consoleState.taskDetail}
          taskDocument={consoleState.taskDocument}
          autoSelectFirstTask={!consoleState.suppressTaskAutoSelect}
          onSelectTask={consoleState.selectTaskSourcePath}
          onSelectDocument={consoleState.selectTaskDocumentPath}
          onOpenSource={(sourcePath) => void consoleState.openSelectedPath(sourcePath)}
          onNavigateDocument={consoleState.navigateDocumentLink}
          pendingDocumentAnchor={consoleState.pendingDocumentAnchor}
          onConsumeDocumentAnchor={consoleState.consumeDocumentAnchor}
        />
      );
    case "workflow":
      return (
        <WorkflowPanel
          detail={detail}
          onOpenSource={(sourcePath) => void consoleState.openSelectedPath(sourcePath)}
        />
      );
    case "diagnostics":
      return (
        <DiagnosticsPanel
          detail={detail}
          busyAction={consoleState.busyAction}
          onRefresh={() => void consoleState.refreshSelectedProject()}
          onOpenLogs={() => void consoleState.openLogs()}
          onClearApplicationData={() => void consoleState.clearApplicationData()}
        />
      );
  }
}

interface ReadonlySnapshotNoticeProps {
  resourceLabel: string;
}

/** 提示尚未显式刷新的历史或不可用项目只能浏览摘要快照。 */
function ReadonlySnapshotNotice({ resourceLabel }: ReadonlySnapshotNoticeProps) {
  return (
    <div className="content-state">
      当前项目只展示摘要快照，不能直接读取{resourceLabel}。请先刷新摘要，或加入焦点持续读取。
    </div>
  );
}
