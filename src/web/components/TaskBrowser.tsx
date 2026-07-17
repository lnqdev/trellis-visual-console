import { Archive, CircleDot, FileJson2, FileText, ListTodo, UserRound } from "lucide-react";
import { useEffect, useState } from "react";
import type {
  ProjectDocumentResponse,
  TaskDetailResponse,
  TaskSummaryApi,
} from "../../shared/api";
import { formatDateTime, formatTaskStatus } from "../formatters";
import type { AsyncState } from "../hooks/useProjectConsole";
import { DocumentViewer } from "./DocumentViewer";

interface TaskBrowserProps {
  activeTasks: TaskSummaryApi[];
  archivedTasks: TaskSummaryApi[];
  selectedTaskSourcePath: string | null;
  selectedDocumentPath: string | null;
  taskDetail: AsyncState<TaskDetailResponse>;
  taskDocument: AsyncState<ProjectDocumentResponse>;
  onSelectTask: (sourcePath: string) => void;
  onSelectDocument: (relativePath: string) => void;
  onOpenSource: (sourcePath: string) => void;
}

/** 展示活动/归档 Task、文档清单和正文。 */
export function TaskBrowser({
  activeTasks,
  archivedTasks,
  selectedTaskSourcePath,
  selectedDocumentPath,
  taskDetail,
  taskDocument,
  onSelectTask,
  onSelectDocument,
  onOpenSource,
}: TaskBrowserProps) {
  const [collection, setCollection] = useState<"active" | "archived">(() =>
    archivedTasks.some((task) => task.sourcePath === selectedTaskSourcePath) ? "archived" : "active",
  );
  const tasks = collection === "active" ? activeTasks : archivedTasks;

  useEffect(() => {
    if (selectedTaskSourcePath !== null) {
      if (archivedTasks.some((task) => task.sourcePath === selectedTaskSourcePath)) {
        setCollection("archived");
        return;
      }
      if (activeTasks.some((task) => task.sourcePath === selectedTaskSourcePath)) {
        setCollection("active");
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
  }, [activeTasks, archivedTasks, selectedTaskSourcePath]);

  useEffect(() => {
    if (selectedTaskSourcePath === null && tasks[0] !== undefined) {
      onSelectTask(tasks[0].sourcePath);
    }
  }, [onSelectTask, selectedTaskSourcePath, tasks]);

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

        {tasks.length === 0 ? (
          <p className="empty-copy">当前分组没有 Task。</p>
        ) : (
          <div className="task-list">
            {tasks.map((task) => (
              <button
                key={task.sourcePath}
                className={`task-item ${selectedTaskSourcePath === task.sourcePath ? "task-item--active" : ""}`}
                type="button"
                onClick={() => onSelectTask(task.sourcePath)}
              >
                <span className="task-status-icon" aria-hidden="true"><CircleDot size={15} /></span>
                <span>
                  <strong>{task.title}</strong>
                  <small>{formatTaskStatus(task)} · {formatDateTime(task.updatedAt)}</small>
                </span>
              </button>
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
