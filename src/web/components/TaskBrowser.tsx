import {
  Archive,
  CheckCircle2,
  ChevronRight,
  Circle,
  CircleHelp,
  Eye,
  FileJson2,
  FileText,
  ListTodo,
  PlayCircle,
  UserRound,
  X,
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import type {
  ProjectDocumentResponse,
  TaskDetailResponse,
  TaskSummaryApi,
} from "../../shared/api";
import { formatDateTime, formatTaskStatus, readTaskStatusGroup } from "../formatters";
import type { AsyncState } from "../hooks/useProjectConsole";
import { DocumentViewer } from "./DocumentViewer";

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
}: TaskBrowserProps) {
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
    <section className="task-browser" aria-label="Task 浏览器">
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

        {displayedRoots.length === 0 ? (
          <p className="empty-copy">当前分组没有 Task。</p>
        ) : (
          <div className="task-list" role="tree" aria-label={`${collection === "active" ? "活动" : "归档"}任务树`}>
            {displayedRoots.map((task) => (
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
                onToggleExpanded={toggleExpanded}
                onSelectTask={onSelectTask}
                onFocusArchivedChildren={focusArchivedChildren}
              />
            ))}
          </div>
        )}
      </aside>

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
                <h2>{taskDetail.data.task.title}</h2>
                <div className="task-meta">
                  <span>{formatTaskStatus(taskDetail.data.task)}</span>
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
  onToggleExpanded,
  onSelectTask,
  onFocusArchivedChildren,
}: TaskTreeNodeProps) {
  const children = focused
    ? []
    : task.childSourcePaths
      .filter((sourcePath) => collectionPaths.has(sourcePath))
      .map((sourcePath) => taskIndex.get(sourcePath))
      .filter((child): child is TaskSummaryApi => child !== undefined);
  const archivedChildren = collection === "active"
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
  const expanded = expandedTasks.has(task.sourcePath);
  const parent = task.parentSourcePath === null ? null : (taskIndex.get(task.parentSourcePath) ?? null);
  const depthClass = `task-tree-node--depth-${Math.min(depth, 3)}`;

  return (
    <div className={`task-tree-node ${depthClass}`} role="treeitem" aria-expanded={hasExpandableContent ? expanded : undefined}>
      <div className="task-tree-row">
        {hasExpandableContent ? (
          <button
            className="task-expand-button"
            type="button"
            aria-label={`${expanded ? "收起" : "展开"}${task.title}`}
            aria-expanded={expanded}
            onClick={() => onToggleExpanded(task.sourcePath)}
          >
            <ChevronRight className={expanded ? "expanded" : ""} size={15} aria-hidden="true" />
          </button>
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
              {allChildren.length > 0 ? (
                <span className="task-progress" aria-label={`已完成 ${completedChildren} 个，共 ${allChildren.length} 个直接子任务`}>
                  {completedChildren}/{allChildren.length}
                </span>
              ) : null}
            </span>
            <small>{formatTaskStatus(task)} · {formatDateTime(task.updatedAt)}</small>
            {collection === "archived" && parent !== null ? (
              <small className="task-parent-context">父任务：{parent.title}</small>
            ) : null}
            {depth > 3 ? <small className="task-depth-marker">第 {depth + 1} 层</small> : null}
          </span>
        </button>
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
