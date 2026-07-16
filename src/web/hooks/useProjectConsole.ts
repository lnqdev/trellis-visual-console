import { useCallback, useEffect, useMemo, useState } from "react";
import type {
  ProjectDetailResponse,
  ProjectDocumentResponse,
  ProjectListItem,
  ProjectRegisterInput,
  ProjectRegisterResponse,
  ProjectScanResponse,
  TaskDetailResponse,
} from "../../shared/api";
import { isProjectRealtimeEvent } from "../../shared/project-events";
import {
  fetchProject,
  fetchProjects,
  fetchSpecDocument,
  fetchTaskDetail,
  fetchTaskDocument,
  openProjectPath,
  refreshProject,
  registerProjects,
  scanProjects,
  setProjectFocus,
} from "../api-client";

/** 主工作区视图集合。 */
export type ProjectView = "overview" | "spec" | "tasks" | "workflow" | "diagnostics";

/** 通用异步数据状态。 */
export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** SSE 连接状态。 */
export type EventStreamState = "connecting" | "connected" | "reconnecting";

/** 页面顶部展示的操作反馈。 */
export interface ConsoleNotice {
  tone: "success" | "error" | "info";
  message: string;
}

const VALID_VIEWS: ProjectView[] = ["overview", "spec", "tasks", "workflow", "diagnostics"];

/** 集中管理项目列表、详情、文档、URL 选择和 SSE 刷新。 */
export function useProjectConsole() {
  const initialSelection = useMemo(readUrlSelection, []);
  const [projects, setProjects] = useState<AsyncState<ProjectListItem[]>>(createAsyncState([]));
  const [detail, setDetail] = useState<AsyncState<ProjectDetailResponse>>(
    createAsyncState<ProjectDetailResponse>(null),
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    initialSelection.projectId,
  );
  const [view, setView] = useState<ProjectView>(initialSelection.view);
  const [selectedSpecPath, setSelectedSpecPath] = useState<string | null>(
    initialSelection.specPath,
  );
  const [selectedTaskSourcePath, setSelectedTaskSourcePath] = useState<string | null>(
    initialSelection.taskSourcePath,
  );
  const [selectedTaskDocumentPath, setSelectedTaskDocumentPath] = useState<string | null>(
    initialSelection.taskDocumentPath,
  );
  const [specDocument, setSpecDocument] = useState<AsyncState<ProjectDocumentResponse>>(
    createAsyncState<ProjectDocumentResponse>(null),
  );
  const [taskDetail, setTaskDetail] = useState<AsyncState<TaskDetailResponse>>(
    createAsyncState<TaskDetailResponse>(null),
  );
  const [taskDocument, setTaskDocument] = useState<AsyncState<ProjectDocumentResponse>>(
    createAsyncState<ProjectDocumentResponse>(null),
  );
  const [eventStreamState, setEventStreamState] = useState<EventStreamState>("connecting");
  const [busyAction, setBusyAction] = useState<string | null>(null);
  const [notice, setNotice] = useState<ConsoleNotice | null>(null);
  const [discoveryOpen, setDiscoveryOpen] = useState(false);

  /** 读取项目列表并修复失效的当前选择。 */
  const loadProjects = useCallback(async (background = false, signal?: AbortSignal) => {
    if (!background) {
      setProjects((current) => ({ ...current, loading: true, error: null }));
    }
    try {
      const response = await fetchProjects(signal);
      setProjects({ data: response.projects, loading: false, error: null });
      setSelectedProjectId((current) => {
        if (current !== null && response.projects.some((item) => item.project.id === current)) {
          return current;
        }
        return response.projects[0]?.project.id ?? null;
      });
      if (response.projects.length === 0) {
        setDiscoveryOpen(true);
      }
    } catch (error) {
      if (!isAbortError(error)) {
        setProjects((current) => ({ ...current, loading: false, error: getErrorMessage(error) }));
      }
    }
  }, []);

  /** 读取一个项目的缓存详情。 */
  const loadDetail = useCallback(
    async (projectId: string, background = false, signal?: AbortSignal) => {
      if (!background) {
        setDetail({ data: null, loading: true, error: null });
      }
      try {
        const response = await fetchProject(projectId, signal);
        setDetail({ data: response, loading: false, error: null });
        const specTree = response.snapshot?.specTree ?? [];
        const tasks = response.snapshot === null
          ? []
          : [...response.snapshot.tasks.active, ...response.snapshot.tasks.archived];
        setSelectedSpecPath((current) =>
          current !== null && containsSpecFile(specTree, current) ? current : null,
        );
        setSelectedTaskSourcePath((current) =>
          current !== null && tasks.some((task) => task.sourcePath === current) ? current : null,
        );
      } catch (error) {
        if (!isAbortError(error)) {
          setDetail((current) => ({ ...current, loading: false, error: getErrorMessage(error) }));
        }
      }
    },
    [],
  );

  /** 读取当前 Spec 文档。 */
  const loadSpecDocument = useCallback(
    async (projectId: string, sourcePath: string, signal?: AbortSignal) => {
      setSpecDocument({ data: null, loading: true, error: null });
      try {
        const response = await fetchSpecDocument(projectId, sourcePath, signal);
        setSpecDocument({ data: response, loading: false, error: null });
      } catch (error) {
        if (!isAbortError(error)) {
          setSpecDocument((current) => ({
            ...current,
            loading: false,
            error: getErrorMessage(error),
          }));
        }
      }
    },
    [],
  );

  /** 读取当前 Task 详情和文档清单。 */
  const loadTaskDetail = useCallback(
    async (projectId: string, sourcePath: string, signal?: AbortSignal) => {
      setTaskDetail({ data: null, loading: true, error: null });
      try {
        const response = await fetchTaskDetail(projectId, sourcePath, signal);
        setTaskDetail({ data: response, loading: false, error: null });
        setSelectedTaskDocumentPath((current) => {
          if (current !== null && response.documents.some((item) => item.relativePath === current)) {
            return current;
          }
          return response.documents[0]?.relativePath ?? null;
        });
      } catch (error) {
        if (!isAbortError(error)) {
          setTaskDetail((current) => ({ ...current, loading: false, error: getErrorMessage(error) }));
        }
      }
    },
    [],
  );

  /** 读取当前 Task 文档正文。 */
  const loadTaskDocument = useCallback(
    async (
      projectId: string,
      taskSourcePath: string,
      documentPath: string,
      signal?: AbortSignal,
    ) => {
      setTaskDocument({ data: null, loading: true, error: null });
      try {
        const response = await fetchTaskDocument(
          projectId,
          taskSourcePath,
          documentPath,
          signal,
        );
        setTaskDocument({ data: response, loading: false, error: null });
      } catch (error) {
        if (!isAbortError(error)) {
          setTaskDocument((current) => ({
            ...current,
            loading: false,
            error: getErrorMessage(error),
          }));
        }
      }
    },
    [],
  );

  useEffect(() => {
    const controller = new AbortController();
    void loadProjects(false, controller.signal);
    return () => controller.abort();
  }, [loadProjects]);

  useEffect(() => {
    if (selectedProjectId === null) {
      setDetail(createAsyncState<ProjectDetailResponse>(null));
      return;
    }
    const controller = new AbortController();
    void loadDetail(selectedProjectId, false, controller.signal);
    return () => controller.abort();
  }, [loadDetail, selectedProjectId]);

  useEffect(() => {
    if (
      selectedProjectId === null ||
      selectedSpecPath === null ||
      detail.data?.project.id !== selectedProjectId ||
      !containsSpecFile(detail.data.snapshot?.specTree ?? [], selectedSpecPath)
    ) {
      setSpecDocument(createAsyncState<ProjectDocumentResponse>(null));
      return;
    }
    const controller = new AbortController();
    void loadSpecDocument(selectedProjectId, selectedSpecPath, controller.signal);
    return () => controller.abort();
  }, [detail.data, loadSpecDocument, selectedProjectId, selectedSpecPath]);

  useEffect(() => {
    if (
      selectedProjectId === null ||
      selectedTaskSourcePath === null ||
      detail.data?.project.id !== selectedProjectId ||
      !containsTask(detail.data, selectedTaskSourcePath)
    ) {
      setTaskDetail(createAsyncState<TaskDetailResponse>(null));
      setTaskDocument(createAsyncState<ProjectDocumentResponse>(null));
      return;
    }
    const controller = new AbortController();
    void loadTaskDetail(selectedProjectId, selectedTaskSourcePath, controller.signal);
    return () => controller.abort();
  }, [detail.data, loadTaskDetail, selectedProjectId, selectedTaskSourcePath]);

  useEffect(() => {
    if (selectedTaskSourcePath === null) {
      setSelectedTaskDocumentPath(null);
    }
  }, [selectedTaskSourcePath]);

  useEffect(() => {
    if (
      selectedProjectId === null ||
      selectedTaskSourcePath === null ||
      selectedTaskDocumentPath === null ||
      taskDetail.data?.projectId !== selectedProjectId ||
      taskDetail.data.task.sourcePath !== selectedTaskSourcePath ||
      !taskDetail.data.documents.some(
        (document) => document.relativePath === selectedTaskDocumentPath,
      )
    ) {
      setTaskDocument(createAsyncState<ProjectDocumentResponse>(null));
      return;
    }
    const controller = new AbortController();
    void loadTaskDocument(
      selectedProjectId,
      selectedTaskSourcePath,
      selectedTaskDocumentPath,
      controller.signal,
    );
    return () => controller.abort();
  }, [
    loadTaskDocument,
    selectedProjectId,
    selectedTaskDocumentPath,
    selectedTaskSourcePath,
    taskDetail.data,
  ]);

  useEffect(() => {
    writeUrlSelection({
      projectId: selectedProjectId,
      view,
      specPath: selectedSpecPath,
      taskSourcePath: selectedTaskSourcePath,
      taskDocumentPath: selectedTaskDocumentPath,
    });
  }, [selectedProjectId, selectedSpecPath, selectedTaskDocumentPath, selectedTaskSourcePath, view]);

  useEffect(() => {
    const eventSource = new EventSource("/api/events");
    setEventStreamState("connecting");
    eventSource.onopen = () => setEventStreamState("connected");
    eventSource.onerror = () => setEventStreamState("reconnecting");
    eventSource.onmessage = (message) => {
      let payload: unknown;
      try {
        payload = JSON.parse(message.data) as unknown;
      } catch {
        return;
      }
      if (!isProjectRealtimeEvent(payload)) {
        return;
      }

      void loadProjects(true);
      if (payload.projectId !== selectedProjectId || selectedProjectId === null) {
        return;
      }
      void loadDetail(selectedProjectId, true);
    };
    return () => eventSource.close();
  }, [
    loadDetail,
    loadProjects,
    selectedProjectId,
  ]);

  /** 选择项目并重置项目内导航。 */
  const selectProject = useCallback((projectId: string) => {
    setSelectedProjectId(projectId);
    setView("overview");
    setSelectedSpecPath(null);
    setSelectedTaskSourcePath(null);
    setSelectedTaskDocumentPath(null);
    setDiscoveryOpen(false);
  }, []);

  /** 切换当前项目主视图。 */
  const selectView = useCallback((nextView: ProjectView) => setView(nextView), []);

  /** 执行项目聚焦或取消聚焦。 */
  const changeFocus = useCallback(
    async (focused: boolean) => {
      if (selectedProjectId === null) {
        return;
      }
      await runAction(`focus:${selectedProjectId}`, async () => {
        const response = await setProjectFocus(selectedProjectId, focused);
        setDetail({ data: response, loading: false, error: null });
        await loadProjects(true);
        setNotice({
          tone: "success",
          message: focused ? "项目已加入焦点并开始监听" : "项目已移出焦点，最后快照已保留",
        });
      });
    },
    [loadProjects, selectedProjectId],
  );

  /** 显式刷新当前项目。 */
  const refreshSelectedProject = useCallback(async () => {
    if (selectedProjectId === null) {
      return;
    }
    await runAction(`refresh:${selectedProjectId}`, async () => {
      const response = await refreshProject(selectedProjectId);
      setDetail({ data: response, loading: false, error: null });
      await loadProjects(true);
      setNotice({ tone: "success", message: "项目快照已重新索引" });
    });
  }, [loadProjects, selectedProjectId]);

  /** 使用系统外部应用打开当前项目或源路径。 */
  const openSelectedPath = useCallback(
    async (sourcePath?: string) => {
      if (selectedProjectId === null) {
        return;
      }
      await runAction(`open:${sourcePath ?? "project"}`, async () => {
        await openProjectPath(selectedProjectId, sourcePath);
        setNotice({ tone: "info", message: sourcePath ? "已交给外部应用打开" : "已打开项目目录" });
      });
    },
    [selectedProjectId],
  );

  /** 扫描一个用户显式输入的本机根路径。 */
  const discoverProjects = useCallback(async (rootPath: string): Promise<ProjectScanResponse> => {
    return runActionWithResult("scan", () => scanProjects(rootPath));
  }, []);

  /** 登记发现候选或手动输入的项目。 */
  const addProjects = useCallback(
    async (inputs: ProjectRegisterInput[]): Promise<ProjectRegisterResponse> => {
      const response = await runActionWithResult("register", () => registerProjects(inputs));
      await loadProjects(true);
      const firstProject = response.results.find((result) => result.project !== null)?.project;
      if (firstProject !== undefined && firstProject !== null) {
        selectProject(firstProject.id);
      }
      setNotice({ tone: "success", message: "项目登记结果已更新" });
      return response;
    },
    [loadProjects, selectProject],
  );

  /** 执行无返回值操作并统一管理忙碌和错误状态。 */
  async function runAction(action: string, operation: () => Promise<void>): Promise<void> {
    setBusyAction(action);
    setNotice(null);
    try {
      await operation();
    } catch (error) {
      setNotice({ tone: "error", message: getErrorMessage(error) });
    } finally {
      setBusyAction(null);
    }
  }

  /** 执行有返回值操作并让调用组件处理结果。 */
  async function runActionWithResult<T>(action: string, operation: () => Promise<T>): Promise<T> {
    setBusyAction(action);
    setNotice(null);
    try {
      return await operation();
    } catch (error) {
      const message = getErrorMessage(error);
      setNotice({ tone: "error", message });
      throw error;
    } finally {
      setBusyAction(null);
    }
  }

  return {
    projects,
    detail,
    selectedProjectId,
    view,
    selectedSpecPath,
    selectedTaskSourcePath,
    selectedTaskDocumentPath,
    specDocument,
    taskDetail,
    taskDocument,
    eventStreamState,
    busyAction,
    notice,
    discoveryOpen,
    selectProject,
    selectView,
    selectSpecPath: setSelectedSpecPath,
    selectTaskSourcePath: (sourcePath: string) => {
      setSelectedTaskSourcePath(sourcePath);
      setSelectedTaskDocumentPath(null);
    },
    selectTaskDocumentPath: setSelectedTaskDocumentPath,
    changeFocus,
    refreshSelectedProject,
    openSelectedPath,
    discoverProjects,
    addProjects,
    openDiscovery: () => setDiscoveryOpen(true),
    closeDiscovery: () => setDiscoveryOpen(false),
    clearNotice: () => setNotice(null),
    retryProjects: () => loadProjects(false),
    retryDetail: () => {
      if (selectedProjectId !== null) {
        void loadDetail(selectedProjectId);
      }
    },
  };
}

/** 创建统一异步状态。 */
function createAsyncState<T>(data: T | null): AsyncState<T> {
  return { data, loading: false, error: null };
}

/** 从 URL 查询参数恢复稳定选择。 */
function readUrlSelection(): {
  projectId: string | null;
  view: ProjectView;
  specPath: string | null;
  taskSourcePath: string | null;
  taskDocumentPath: string | null;
} {
  const params = new URLSearchParams(window.location.search);
  const viewValue = params.get("view");
  return {
    projectId: params.get("project"),
    view: VALID_VIEWS.includes(viewValue as ProjectView) ? (viewValue as ProjectView) : "overview",
    specPath: params.get("spec"),
    taskSourcePath: params.get("task"),
    taskDocumentPath: params.get("document"),
  };
}

/** 将当前选择写回 URL，刷新页面后可以恢复阅读上下文。 */
function writeUrlSelection(selection: {
  projectId: string | null;
  view: ProjectView;
  specPath: string | null;
  taskSourcePath: string | null;
  taskDocumentPath: string | null;
}): void {
  const params = new URLSearchParams();
  if (selection.projectId !== null) {
    params.set("project", selection.projectId);
  }
  if (selection.view !== "overview") {
    params.set("view", selection.view);
  }
  if (selection.specPath !== null) {
    params.set("spec", selection.specPath);
  }
  if (selection.taskSourcePath !== null) {
    params.set("task", selection.taskSourcePath);
  }
  if (selection.taskDocumentPath !== null) {
    params.set("document", selection.taskDocumentPath);
  }
  const query = params.toString();
  window.history.replaceState(null, "", query === "" ? window.location.pathname : `?${query}`);
}

/** 判断错误是否来自主动请求取消。 */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** 提取用户可见的中文错误消息。 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "操作失败，请重试";
}

/** 递归判断 Spec 快照是否包含指定文件。 */
function containsSpecFile(
  nodes: NonNullable<ProjectDetailResponse["snapshot"]>["specTree"],
  sourcePath: string,
): boolean {
  return nodes.some(
    (node) =>
      (node.kind === "file" && node.relativePath === sourcePath) ||
      (node.kind === "directory" && containsSpecFile(node.children, sourcePath)),
  );
}

/** 判断项目快照是否包含指定 Task。 */
function containsTask(detail: ProjectDetailResponse, sourcePath: string): boolean {
  if (detail.snapshot === null) {
    return false;
  }
  return [...detail.snapshot.tasks.active, ...detail.snapshot.tasks.archived].some(
    (task) => task.sourcePath === sourcePath,
  );
}
