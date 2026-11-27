import {
  Archive,
  Check,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleHelp,
  Copy,
  Eye,
  FileJson2,
  FileText,
  ListTodo,
  PlayCircle,
  Search,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { CSSProperties } from "react";
import type {
  ProjectDocumentResponse,
  TaskDetailResponse,
  TaskSummaryApi,
} from "../../shared/api";
import {
  formatDateTime,
  formatTaskDate,
  formatTaskDevType,
  formatTaskStatus,
  readTaskCopyName,
  readTaskStatusGroup,
} from "../formatters";
import type { AsyncState } from "../hooks/useProjectConsole";
import { useResizablePanel } from "../hooks/useResizablePanel";
import { DocumentViewer } from "./DocumentViewer";
import { Dropdown, type DropdownOption } from "./Dropdown";
import { PriorityBadge } from "./PriorityBadge";

interface TaskBrowserProps {
  activeTasks: TaskSummaryApi[];
  archivedTasks: TaskSummaryApi[];
  selectedTaskSourcePath: string | null;
  selectedDocumentPath: string | null;
  taskDetail: AsyncState<TaskDetailResponse>;
  taskDocument: AsyncState<ProjectDocumentResponse>;
  autoSelectFirstTask: boolean;
  onSelectTask: (sourcePath: string) => void;
  onSelectDocument: (relativePath: string) => void;
  onOpenSource: (sourcePath: string) => void;
  onNavigateDocument: (sourcePath: string, anchor: string | null) => void;
  pendingDocumentAnchor: string | null;
  onConsumeDocumentAnchor: () => void;
}

type TaskCollection = "active" | "archived";

/** 展示活动/归档 Task 树、状态、文档清单和正文。 */
export function TaskBrowser({
  activeTasks,
  archivedTasks,
  selectedTaskSourcePath,
  selectedDocumentPath,
  taskDetail,
  taskDocument,
  autoSelectFirstTask,
  onSelectTask,
  onSelectDocument,
  onOpenSource,
  onNavigateDocument,
  pendingDocumentAnchor,
  onConsumeDocumentAnchor,
}: TaskBrowserProps) {
  // 任务树栏宽度支持拖动调整，并持久化到本地存储
  const listPanelResize = useResizablePanel({
    storageKey: "trellis-console:task-list-width",
    defaultWidth: 300,
    minWidth: 220,
    maxWidth: 560,
    ariaLabel: "调整任务列表宽度",
  });
  const browserStyle = { "--task-list-width": `${listPanelResize.width}px` } as CSSProperties;
  const taskIndex = useMemo(
    () => createTaskIndex(activeTasks, archivedTasks),
    [activeTasks, archivedTasks],
  );
  const [collection, setCollection] = useState<TaskCollection>(() =>
    archivedTasks.some((task) => task.sourcePath === selectedTaskSourcePath) ? "archived" : "active",
  );
  const [activeExpanded, setActiveExpanded] = useState<Set<string>>(() =>
    createDefaultExpandedTasks(activeTasks, taskIndex),
  );
  const [archivedExpanded, setArchivedExpanded] = useState<Set<string>>(() =>
    createDefaultExpandedTasks(archivedTasks, taskIndex),
  );
  const [archivedFocusParentPath, setArchivedFocusParentPath] = useState<string | null>(null);
  // 搜索与负责人筛选都是纯本地 UI 状态，不写入 URL，也不影响集合标签与详情选择。
  const [searchQuery, setSearchQuery] = useState("");
  const [assigneeFilter, setAssigneeFilter] = useState<string | null>(null);

  const tasks = collection === "active" ? activeTasks : archivedTasks;
  const taskPaths = useMemo(() => new Set(tasks.map((task) => task.sourcePath)), [tasks]);
  const expandedTasks = collection === "active" ? activeExpanded : archivedExpanded;
  const roots = useMemo(
    () => createCollectionRoots(tasks, taskIndex),
    [tasks, taskIndex],
  );
  const focusedArchivedTasks = useMemo(() => {
    if (collection !== "archived" || archivedFocusParentPath === null) {
      return null;
    }
    const parent = taskIndex.get(archivedFocusParentPath);
    if (parent === undefined) {
      return [];
    }
    return parent.childSourcePaths
      .map((sourcePath) => taskIndex.get(sourcePath))
      .filter((task): task is TaskSummaryApi => task !== undefined && isArchivedTask(task, archivedTasks));
  }, [archivedFocusParentPath, archivedTasks, collection, taskIndex]);
  const displayedRoots = focusedArchivedTasks ?? roots;
  // 筛选范围与标签语义一致：只筛当前集合，归档子任务聚焦时只筛聚焦结果。
  const searchableTasks = focusedArchivedTasks ?? tasks;
  const searchablePaths = useMemo(
    () => new Set(searchableTasks.map((task) => task.sourcePath)),
    [searchableTasks],
  );
  // 负责人选项 = 「全部负责人」+ 当前可搜索集合内去重并按 zh-CN 排序的非空负责人。
  const assigneeOptions = useMemo<ReadonlyArray<DropdownOption<string | null>>>(() => {
    const names = new Set<string>();
    for (const task of searchableTasks) {
      const name = task.assignee?.trim() ?? "";
      if (name !== "") {
        names.add(name);
      }
    }
    const sortedNames = [...names].sort((left, right) => left.localeCompare(right, "zh-CN"));
    return [
      { value: null, label: "全部负责人" },
      ...sortedNames.map((name) => ({ value: name, label: name })),
    ];
  }, [searchableTasks]);
  // 切换集合、变化聚焦范围或数据刷新后，若已选负责人不在新选项中则重置为全部。
  useEffect(() => {
    if (assigneeFilter !== null && !assigneeOptions.some((option) => option.value === assigneeFilter)) {
      setAssigneeFilter(null);
    }
  }, [assigneeFilter, assigneeOptions]);
  const normalizedSearchQuery = searchQuery.trim().toLocaleLowerCase("zh-CN");
  const hasSearchQuery = normalizedSearchQuery.length > 0;
  const isFiltering = hasSearchQuery || assigneeFilter !== null;
  // 先按负责人筛选，再按关键词匹配，两者为 AND 关系。
  const filteredTasks = useMemo(
    () => (assigneeFilter === null
      ? searchableTasks
      : searchableTasks.filter((task) => (task.assignee ?? "").trim() === assigneeFilter)),
    [assigneeFilter, searchableTasks],
  );
  // 直接命中（通过全部筛选）的任务集合，用于决定是否展示负责人等命中说明。
  const filterMatchedPaths = useMemo(() => {
    if (!isFiltering) {
      return null;
    }
    return new Set(
      filteredTasks
        .filter((task) => !hasSearchQuery || matchesTaskTitle(task, normalizedSearchQuery))
        .map((task) => task.sourcePath),
    );
  }, [filteredTasks, hasSearchQuery, isFiltering, normalizedSearchQuery]);
  // 可见集合 = 命中任务 + 它们在当前筛选范围内的祖先链；未命中的兄弟分支与子任务被裁剪。
  const filterVisiblePaths = useMemo(() => {
    if (filterMatchedPaths === null) {
      return null;
    }
    const visible = new Set(filterMatchedPaths);
    for (const sourcePath of filterMatchedPaths) {
      const task = taskIndex.get(sourcePath);
      if (task === undefined) {
        continue;
      }
      // 向上补齐祖先链，父任务即使未命中也要作为层级上下文出现；跨集合祖先不纳入。
      const visited = new Set<string>([sourcePath]);
      let parentPath = task.parentSourcePath;
      while (parentPath !== null && searchablePaths.has(parentPath) && !visited.has(parentPath)) {
        visited.add(parentPath);
        visible.add(parentPath);
        parentPath = taskIndex.get(parentPath)?.parentSourcePath ?? null;
      }
    }
    return visible;
  }, [filterMatchedPaths, searchablePaths, taskIndex]);
  // 筛选树根：可见集合中没有可见父任务的节点，保持当前集合原有顺序。
  const filterRoots = useMemo(
    () => (filterVisiblePaths === null
      ? []
      : searchableTasks.filter((task) => (
        filterVisiblePaths.has(task.sourcePath)
        && (task.parentSourcePath === null || !filterVisiblePaths.has(task.parentSourcePath))
      ))),
    [filterVisiblePaths, searchableTasks],
  );
  // 筛选态复用任务树渲染，仅把根节点替换为裁剪后的筛选树根。
  const treeRoots = isFiltering ? filterRoots : displayedRoots;
  const focusedParent = archivedFocusParentPath === null
    ? null
    : (taskIndex.get(archivedFocusParentPath) ?? null);
  const selectedTask = selectedTaskSourcePath === null
    ? null
    : (taskIndex.get(selectedTaskSourcePath) ?? null);
  const ancestors = useMemo(
    () => selectedTask === null ? [] : findTaskAncestors(selectedTask, taskIndex),
    [selectedTask, taskIndex],
  );

  useEffect(() => {
    if (selectedTaskSourcePath !== null) {
      if (archivedTasks.some((task) => task.sourcePath === selectedTaskSourcePath)) {
        setCollection("archived");
        setArchivedExpanded((current) => addTaskAncestors(current, selectedTaskSourcePath, taskIndex));
        return;
      }
      if (activeTasks.some((task) => task.sourcePath === selectedTaskSourcePath)) {
        setCollection("active");
        setActiveExpanded((current) => addTaskAncestors(current, selectedTaskSourcePath, taskIndex));
        return;
      }
    }

    setCollection((current) => {
      if (current === "active" && activeTasks.length === 0 && archivedTasks.length > 0) {
        return "archived";
      }
      if (current === "archived" && archivedTasks.length === 0 && activeTasks.length > 0) {
        return "active";
      }
      return current;
    });
  }, [activeTasks, archivedTasks, selectedTaskSourcePath, taskIndex]);

  useEffect(() => {
    if (autoSelectFirstTask && selectedTaskSourcePath === null && displayedRoots[0] !== undefined) {
      onSelectTask(displayedRoots[0].sourcePath);
    }
  }, [autoSelectFirstTask, displayedRoots, onSelectTask, selectedTaskSourcePath]);

  useEffect(() => {
    if (
      archivedFocusParentPath !== null &&
      !activeTasks.some((task) => task.sourcePath === archivedFocusParentPath)
    ) {
      setArchivedFocusParentPath(null);
    }
  }, [activeTasks, archivedFocusParentPath]);

  /** 切换当前集合中一个父任务的展开状态。 */
  const toggleExpanded = (sourcePath: string): void => {
    const update = (current: Set<string>): Set<string> => {
      const next = new Set(current);
      if (next.has(sourcePath)) {
        next.delete(sourcePath);
      } else {
        next.add(sourcePath);
      }
      return next;
    };
    if (collection === "active") {
      setActiveExpanded(update);
    } else {
      setArchivedExpanded(update);
    }
  };

  /** 聚焦查看某个活动父任务已经归档的直接子任务。 */
  const focusArchivedChildren = (parent: TaskSummaryApi): void => {
    const archivedChildren = parent.childSourcePaths
      .map((sourcePath) => taskIndex.get(sourcePath))
      .filter((task): task is TaskSummaryApi => task !== undefined && isArchivedTask(task, archivedTasks));
    setArchivedFocusParentPath(parent.sourcePath);
    setCollection("archived");
    if (archivedChildren[0] !== undefined) {
      onSelectTask(archivedChildren[0].sourcePath);
    }
  };

  return (
    <section className="task-browser" aria-label="Task 浏览器" style={browserStyle}>
      <aside className="task-list-panel">
        <div className="task-collection-tabs" role="tablist" aria-label="Task 集合">
          <button
            type="button"
            role="tab"
            aria-selected={collection === "active"}
            className={collection === "active" ? "active" : ""}
            onClick={() => setCollection("active")}
          >
            <ListTodo size={15} aria-hidden="true" />
            活动 {activeTasks.length}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={collection === "archived"}
            className={collection === "archived" ? "active" : ""}
            onClick={() => setCollection("archived")}
          >
            <Archive size={15} aria-hidden="true" />
            归档 {archivedTasks.length}
          </button>
        </div>

        <div className="task-list-filters">
          <div className="task-list-search-control">
            <Search size={14} aria-hidden="true" />
            <input
              type="search"
              value={searchQuery}
              placeholder="搜索任务名称"
              aria-label="搜索任务名称"
              onChange={(event) => setSearchQuery(event.target.value)}
            />
            {searchQuery.length > 0 ? (
              <button
                type="button"
                className="task-list-search-clear"
                aria-label="清除搜索"
                title="清除搜索"
                onClick={() => setSearchQuery("")}
              >
                <X size={14} aria-hidden="true" />
              </button>
            ) : null}
          </div>

          <Dropdown
            className="task-list-assignee"
            label="负责人"
            value={assigneeFilter}
            options={assigneeOptions}
            onChange={setAssigneeFilter}
          />
        </div>

        {collection === "archived" && focusedParent !== null ? (
          <div className="task-archive-focus" aria-live="polite">
            <span>来自：<strong>{focusedParent.title}</strong></span>
            <button
              type="button"
              aria-label="清除归档子任务聚焦"
              title="清除聚焦"
              onClick={() => setArchivedFocusParentPath(null)}
            >
              <X size={14} aria-hidden="true" />
            </button>
          </div>
        ) : null}

        {treeRoots.length === 0 ? (
          <p className="empty-copy">{isFiltering ? "没有匹配的 Task。" : "当前分组没有 Task。"}</p>
        ) : (
          <div className="task-list" role="tree" aria-label={`${collection === "active" ? "活动" : "归档"}任务树`}>
            {treeRoots.map((task) => (
              <TaskTreeNode
                key={task.sourcePath}
                task={task}
                depth={0}
                collection={collection}
                taskIndex={taskIndex}
                collectionPaths={taskPaths}
                archivedTasks={archivedTasks}
                expandedTasks={expandedTasks}
                selectedTaskSourcePath={selectedTaskSourcePath}
                focused={focusedArchivedTasks !== null}
                filterVisiblePaths={filterVisiblePaths}
                filterMatchedPaths={filterMatchedPaths}
                onToggleExpanded={toggleExpanded}
                onSelectTask={onSelectTask}
                onFocusArchivedChildren={focusArchivedChildren}
              />
            ))}
          </div>
        )}
      </aside>
      {/* 任务树栏与详情区之间的拖动分隔线 */}
      <div {...listPanelResize.separatorProps} />

      <div className="task-detail-panel">
        {taskDetail.loading && taskDetail.data === null ? (
          <div className="content-state">正在读取 Task 详情…</div>
        ) : taskDetail.error !== null ? (
          <div className="content-state content-state--error" role="alert">{taskDetail.error}</div>
        ) : taskDetail.data === null ? (
          <div className="content-state">选择一个 Task 查看规划资料。</div>
        ) : (
          <>
            <header className="task-detail-header">
              <div>
                <span className="eyebrow">TASK DETAIL</span>
                {ancestors.length > 0 ? (
                  <nav className="task-breadcrumbs" aria-label="Task 父级路径">
                    {ancestors.map((ancestor) => (
                      <span key={ancestor.sourcePath}>
                        <button type="button" onClick={() => onSelectTask(ancestor.sourcePath)}>
                          {ancestor.title}
                        </button>
                        <ChevronRight size={12} aria-hidden="true" />
                      </span>
                    ))}
                    <span aria-current="page">{taskDetail.data.task.title}</span>
                  </nav>
                ) : null}
                <div className="task-detail-title-row">
                  <h2>{taskDetail.data.task.title}</h2>
                  <TaskNameCopyButton name={readTaskCopyName(taskDetail.data.task)} className="task-name-copy--static" />
                </div>
                <div className="task-meta">
                  <span>{formatTaskStatus(taskDetail.data.task)}</span>
                  <PriorityBadge priority={taskDetail.data.task.priority} />
                  <span>类型 {formatTaskDevType(taskDetail.data.task.devType)}</span>
                  <span>创建 {formatTaskDate(taskDetail.data.task.createdAt)}</span>
                  <span>完成 {formatTaskDate(taskDetail.data.task.completedAt)}</span>
                  {taskDetail.data.task.assignee !== null ? <span><UserRound size={14} />{taskDetail.data.task.assignee}</span> : null}
                  {taskDetail.data.task.packageName !== null ? <span>{taskDetail.data.task.packageName}</span> : null}
                </div>
              </div>
              <code>{taskDetail.data.task.sourcePath}</code>
            </header>

            <div className="task-document-tabs" role="tablist" aria-label="Task 文档">
              {taskDetail.data.documents.map((document) => (
                <button
                  key={document.relativePath}
                  type="button"
                  role="tab"
                  aria-selected={selectedDocumentPath === document.relativePath}
                  className={selectedDocumentPath === document.relativePath ? "active" : ""}
                  onClick={() => onSelectDocument(document.relativePath)}
                >
                  {document.format === "markdown" ? <FileText size={14} /> : <FileJson2 size={14} />}
                  {document.relativePath}
                </button>
              ))}
            </div>

            <DocumentViewer
              document={taskDocument}
              emptyMessage="当前 Task 没有可阅读文档"
              onOpenSource={onOpenSource}
              onNavigateDocument={onNavigateDocument}
              anchor={pendingDocumentAnchor}
              onAnchorConsumed={onConsumeDocumentAnchor}
            />
          </>
        )}
      </div>
    </section>
  );
}

interface TaskTreeNodeProps {
  task: TaskSummaryApi;
  depth: number;
  collection: TaskCollection;
  taskIndex: Map<string, TaskSummaryApi>;
  collectionPaths: Set<string>;
  archivedTasks: TaskSummaryApi[];
  expandedTasks: Set<string>;
  selectedTaskSourcePath: string | null;
  focused: boolean;
  filterVisiblePaths: Set<string> | null;
  filterMatchedPaths: Set<string> | null;
  onToggleExpanded: (sourcePath: string) => void;
  onSelectTask: (sourcePath: string) => void;
  onFocusArchivedChildren: (task: TaskSummaryApi) => void;
}

/** 递归展示一个任务节点及同集合子任务。 */
function TaskTreeNode({
  task,
  depth,
  collection,
  taskIndex,
  collectionPaths,
  archivedTasks,
  expandedTasks,
  selectedTaskSourcePath,
  focused,
  filterVisiblePaths,
  filterMatchedPaths,
  onToggleExpanded,
  onSelectTask,
  onFocusArchivedChildren,
}: TaskTreeNodeProps) {
  // 筛选态传入了可见集合：只渲染其中的子任务，层级固定展开，且隐藏归档子任务入口。
  const filterMode = filterVisiblePaths !== null;
  const isMatched = filterMatchedPaths?.has(task.sourcePath) ?? false;
  const children = focused
    ? []
    : task.childSourcePaths
      .filter((sourcePath) => collectionPaths.has(sourcePath))
      .filter((sourcePath) => filterVisiblePaths === null || filterVisiblePaths.has(sourcePath))
      .map((sourcePath) => taskIndex.get(sourcePath))
      .filter((child): child is TaskSummaryApi => child !== undefined);
  const archivedChildren = filterMode
    ? []
    : collection === "active"
      ? task.childSourcePaths
        .map((sourcePath) => taskIndex.get(sourcePath))
        .filter((child): child is TaskSummaryApi => child !== undefined && isArchivedTask(child, archivedTasks))
      : [];
  const allChildren = task.childSourcePaths
    .map((sourcePath) => taskIndex.get(sourcePath))
    .filter((child): child is TaskSummaryApi => child !== undefined);
  const completedChildren = allChildren.filter(
    (child) => isArchivedTask(child, archivedTasks) || isCompletedTask(child),
  ).length;
  const hasExpandableContent = children.length > 0 || archivedChildren.length > 0;
  // 筛选态层级固定展开，不响应用户的逐级收起。
  const expanded = filterMode ? true : expandedTasks.has(task.sourcePath);
  const parent = task.parentSourcePath === null ? null : (taskIndex.get(task.parentSourcePath) ?? null);
  const depthClass = `task-tree-node--depth-${Math.min(depth, 3)}`;

  return (
    <div className={`task-tree-node ${depthClass}`} role="treeitem" aria-expanded={hasExpandableContent ? expanded : undefined}>
      <div className={`task-tree-row ${selectedTaskSourcePath === task.sourcePath ? "task-tree-row--selected" : ""}`}>
        {hasExpandableContent ? (
          filterMode ? (
            <span className="task-expand-indicator" aria-hidden="true">
              <ChevronRight className="expanded" size={15} />
            </span>
          ) : (
            <button
              className="task-expand-button"
              type="button"
              aria-label={`${expanded ? "收起" : "展开"}${task.title}`}
              aria-expanded={expanded}
              onClick={() => onToggleExpanded(task.sourcePath)}
            >
              <ChevronRight className={expanded ? "expanded" : ""} size={15} aria-hidden="true" />
            </button>
          )
        ) : <span className="task-expand-placeholder" aria-hidden="true" />}

        <button
          className={`task-item ${selectedTaskSourcePath === task.sourcePath ? "task-item--active" : ""}`}
          type="button"
          onClick={() => onSelectTask(task.sourcePath)}
        >
          <TaskStatusIcon task={task} />
          <span className="task-item-content">
            <span className="task-item-title-line">
              <strong title={task.title}>{task.title}</strong>
              <PriorityBadge priority={task.priority} />
              {allChildren.length > 0 ? (
                <span className="task-progress" aria-label={`已完成 ${completedChildren} 个，共 ${allChildren.length} 个直接子任务`}>
                  {completedChildren}/{allChildren.length}
                </span>
              ) : null}
            </span>
            <small>{formatTaskStatus(task)} · {formatDateTime(task.updatedAt)}</small>
            <small className="task-item-dates">
              创建 {formatTaskDate(task.createdAt)} · 完成 {formatTaskDate(task.completedAt)}
            </small>
            {filterMode && isMatched && task.assignee !== null && task.assignee.trim() !== "" ? (
              <small className="task-search-assignee">
                <UserRound size={12} aria-hidden="true" />
                {task.assignee}
              </small>
            ) : null}
            {collection === "archived" && parent !== null ? (
              <small className="task-parent-context">父任务：{parent.title}</small>
            ) : null}
            {depth > 3 ? <small className="task-depth-marker">第 {depth + 1} 层</small> : null}
          </span>
        </button>

        <TaskNameCopyButton name={readTaskCopyName(task)} />
      </div>

      {expanded ? (
        <div className="task-tree-children" role="group">
          {children.map((child) => (
            <TaskTreeNode
              key={child.sourcePath}
              task={child}
              depth={depth + 1}
              collection={collection}
              taskIndex={taskIndex}
              collectionPaths={collectionPaths}
              archivedTasks={archivedTasks}
              expandedTasks={expandedTasks}
              selectedTaskSourcePath={selectedTaskSourcePath}
              focused={false}
              filterVisiblePaths={filterVisiblePaths}
              filterMatchedPaths={filterMatchedPaths}
              onToggleExpanded={onToggleExpanded}
              onSelectTask={onSelectTask}
              onFocusArchivedChildren={onFocusArchivedChildren}
            />
          ))}
          {archivedChildren.length > 0 ? (
            <button
              className="task-archived-children-button"
              type="button"
              onClick={() => onFocusArchivedChildren(task)}
            >
              <Archive size={13} aria-hidden="true" />
              {archivedChildren.length} 个子任务已归档
            </button>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** 按任务状态选择具有独立语义的图标。 */
function TaskStatusIcon({ task }: { task: TaskSummaryApi }) {
  let icon: React.ReactNode;
  switch (readTaskStatusGroup(task.status)) {
    case "planning":
      icon = <Circle size={15} aria-hidden="true" />;
      break;
    case "in_progress":
      icon = <PlayCircle size={15} aria-hidden="true" />;
      break;
    case "review":
      icon = <Eye size={15} aria-hidden="true" />;
      break;
    case "completed":
      icon = <CheckCircle2 size={15} aria-hidden="true" />;
      break;
    case "other":
      icon = <CircleHelp size={15} aria-hidden="true" />;
      break;
  }
  return <span className={`task-status-icon task-status-icon--${readTaskStatusTone(task.status)}`} aria-hidden="true">{icon}</span>;
}

/** 将任意状态归入有限的视觉色调集合。 */
function readTaskStatusTone(status: string): string {
  switch (readTaskStatusGroup(status)) {
    case "planning":
      return "planning";
    case "in_progress":
      return "progress";
    case "review":
      return "review";
    case "completed":
      return "completed";
    case "other":
      return "unknown";
  }
}

/** 合并活动与归档任务为稳定的 sourcePath 索引。 */
function createTaskIndex(
  activeTasks: TaskSummaryApi[],
  archivedTasks: TaskSummaryApi[],
): Map<string, TaskSummaryApi> {
  return new Map([...activeTasks, ...archivedTasks].map((task) => [task.sourcePath, task]));
}

/** 返回当前集合的根节点；跨集合父任务不会吞掉当前集合子节点。 */
function createCollectionRoots(
  tasks: TaskSummaryApi[],
  taskIndex: Map<string, TaskSummaryApi>,
): TaskSummaryApi[] {
  const paths = new Set(tasks.map((task) => task.sourcePath));
  return tasks.filter((task) => {
    if (task.parentSourcePath === null || !paths.has(task.parentSourcePath)) {
      return true;
    }
    return !taskIndex.has(task.parentSourcePath);
  });
}

/** 首次进入时展开仍包含未完成直接子任务的父任务。 */
function createDefaultExpandedTasks(
  tasks: TaskSummaryApi[],
  taskIndex: Map<string, TaskSummaryApi>,
): Set<string> {
  return new Set(
    tasks
      .filter((task) => task.childSourcePaths.some((path) => {
        const child = taskIndex.get(path);
        return child !== undefined && !isCompletedTask(child);
      }))
      .map((task) => task.sourcePath),
  );
}

/** 将指定任务的全部可解析祖先加入展开集合。 */
function addTaskAncestors(
  current: Set<string>,
  sourcePath: string,
  taskIndex: Map<string, TaskSummaryApi>,
): Set<string> {
  const next = new Set(current);
  const visited = new Set<string>();
  let task = taskIndex.get(sourcePath);
  while (task?.parentSourcePath !== null && task?.parentSourcePath !== undefined) {
    if (visited.has(task.parentSourcePath)) {
      break;
    }
    visited.add(task.parentSourcePath);
    next.add(task.parentSourcePath);
    task = taskIndex.get(task.parentSourcePath);
  }
  return next;
}

/** 返回从根父任务到直接父任务的安全祖先链。 */
function findTaskAncestors(
  task: TaskSummaryApi,
  taskIndex: Map<string, TaskSummaryApi>,
): TaskSummaryApi[] {
  const ancestors: TaskSummaryApi[] = [];
  const visited = new Set([task.sourcePath]);
  let parentPath = task.parentSourcePath;
  while (parentPath !== null && !visited.has(parentPath)) {
    visited.add(parentPath);
    const parent = taskIndex.get(parentPath);
    if (parent === undefined) {
      break;
    }
    ancestors.unshift(parent);
    parentPath = parent.parentSourcePath;
  }
  return ancestors;
}

/** 判断任务是否属于归档集合。 */
function isArchivedTask(task: TaskSummaryApi, archivedTasks: TaskSummaryApi[]): boolean {
  return archivedTasks.some((archivedTask) => archivedTask.sourcePath === task.sourcePath);
}

/** 兼容 Trellis 标准与旧版完成状态。 */
function isCompletedTask(task: TaskSummaryApi): boolean {
  return task.status === "completed" || task.status === "done";
}

/** 仅按任务标题做去空白、大小写不敏感的包含匹配；负责人只由下拉筛选控制。 */
function matchesTaskTitle(task: TaskSummaryApi, normalizedQuery: string): boolean {
  const normalizedTitle = task.title.trim().toLocaleLowerCase("zh-CN");
  return normalizedTitle.includes(normalizedQuery);
}

interface TaskNameCopyButtonProps {
  /** 要复制的任务名。 */
  name: string;
  /** 额外的样式类，例如详情头部的常驻显示修饰。 */
  className?: string;
}

/** 复制任务名按钮：写入剪贴板后短暂显示成功状态。 */
function TaskNameCopyButton({ name, className }: TaskNameCopyButtonProps) {
  const [copied, setCopied] = useState(false);
  // 保存重置定时器，组件卸载时清理，避免对已卸载组件调用 setState。
  const resetTimer = useRef<number | null>(null);

  useEffect(() => () => {
    if (resetTimer.current !== null) {
      window.clearTimeout(resetTimer.current);
    }
  }, []);

  /** 点击复制任务名，成功后显示约 1.5 秒的勾选态。 */
  const handleCopy = (): void => {
    void writeClipboard(name).then((succeeded) => {
      if (!succeeded) {
        return;
      }
      setCopied(true);
      if (resetTimer.current !== null) {
        window.clearTimeout(resetTimer.current);
      }
      resetTimer.current = window.setTimeout(() => setCopied(false), 1500);
    });
  };

  const classes = ["task-name-copy", className ?? "", copied ? "task-name-copy--copied" : ""]
    .filter((value) => value !== "")
    .join(" ");

  return (
    <button
      type="button"
      className={classes}
      title={copied ? "已复制" : "复制任务名"}
      aria-label={copied ? `已复制任务名：${name}` : `复制任务名：${name}`}
      onClick={handleCopy}
    >
      {copied ? <Check size={13} aria-hidden="true" /> : <Copy size={13} aria-hidden="true" />}
    </button>
  );
}

/** 写入系统剪贴板；Clipboard API 不可用或被拒时回退到临时 textarea。 */
async function writeClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard !== undefined) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // 非安全上下文或权限被拒：继续尝试兼容方案。
  }

  try {
    const textarea = document.createElement("textarea");
    textarea.value = text;
    textarea.setAttribute("readonly", "");
    textarea.style.position = "fixed";
    textarea.style.top = "-9999px";
    textarea.style.opacity = "0";
    document.body.appendChild(textarea);
    textarea.select();
    const succeeded = document.execCommand("copy");
    document.body.removeChild(textarea);
    return succeeded;
  } catch {
    return false;
  }
}
