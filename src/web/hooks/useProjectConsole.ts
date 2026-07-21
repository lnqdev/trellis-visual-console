import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { listen } from "@tauri-apps/api/event";
import type {
  DirectoryPickerResponse,
  ProjectDetailResponse,
  ProjectDocumentResponse,
  ProjectListItem,
  ProjectRegisterInput,
  ProjectRegisterResponse,
  ProjectScanResponse,
  TaskCenterItemApi,
  TaskDetailResponse,
} from "../../shared/api";
import { isProjectRealtimeEvent } from "../../shared/project-events";
import {
  fetchProject,
  fetchProjects,
  fetchSpecDocument,
  fetchTaskDetail,
  fetchTaskDocument,
  clearApplicationDataAndExit,
  openLogDirectory,
  openProjectPath,
  refreshProject,
  registerProjects,
  scanProjects,
  selectDirectory,
  setProjectFocus,
} from "../api-client";
import {
  DEFAULT_TASK_CENTER_SELECTION,
  useTaskCenter,
  type TaskCenterCollection,
  type TaskCenterScope,
  type TaskCenterSelection,
  type TaskCenterSort,
} from "./useTaskCenter";

/** 主工作区视图集合。 */
export type ProjectView = "overview" | "spec" | "tasks" | "workflow" | "diagnostics";

/** 控制台顶层工作区模式。 */
export type ConsoleMode = "project" | "tasks";

/** 通用异步数据状态。 */
export interface AsyncState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
}

/** 桌面进程内事件通道状态。 */
export type EventStreamState = "connecting" | "connected" | "unavailable";

/** 页面顶部展示的操作反馈。 */
export interface ConsoleNotice {
  tone: "success" | "error" | "info";
  message: string;
}

const VALID_VIEWS: ProjectView[] = ["overview", "spec", "tasks", "workflow", "diagnostics"];
const VALID_TASK_CENTER_SCOPES: TaskCenterScope[] = ["focus", "all"];
const VALID_TASK_CENTER_COLLECTIONS: TaskCenterCollection[] = ["active", "archived", "all"];
const VALID_TASK_CENTER_SORTS: TaskCenterSort[] = ["updated_desc", "updated_asc"];

/** 集中管理项目列表、详情、文档、URL 选择和桌面事件刷新。 */
export function useProjectConsole() {
  const initialSelection = useMemo(readUrlSelection, []);
  const initialProjectSelection = initialSelection.mode === "project"
    ? initialSelection
    : createDefaultProjectUrlSelection();
  const initialTaskCenterSelection = initialSelection.mode === "tasks"
    ? initialSelection.taskCenter
    : DEFAULT_TASK_CENTER_SELECTION;
  const selectedProjectIdRef = useRef<string | null>(initialProjectSelection.projectId);
  const detailRequestGenerationRef = useRef(0);
  const skipNextDetailLoadRef = useRef<string | null>(null);
  const pendingEventProjectIdsRef = useRef(new Set<string>());
  const eventRefreshTimerRef = useRef<number | null>(null);
  const [projects, setProjects] = useState<AsyncState<ProjectListItem[]>>(createAsyncState([]));
  const [detail, setDetail] = useState<AsyncState<ProjectDetailResponse>>(
    createAsyncState<ProjectDetailResponse>(null),
  );
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    initialProjectSelection.projectId,
  );
  const [mode, setMode] = useState<ConsoleMode>(initialSelection.mode);
  const [view, setView] = useState<ProjectView>(initialProjectSelection.view);
  const [selectedSpecPath, setSelectedSpecPath] = useState<string | null>(
    initialProjectSelection.specPath,
  );
  const [selectedTaskSourcePath, setSelectedTaskSourcePath] = useState<string | null>(
    initialProjectSelection.taskSourcePath,
  );
  const [selectedTaskDocumentPath, setSelectedTaskDocumentPath] = useState<string | null>(
    initialProjectSelection.taskDocumentPath,
  );
  const [suppressTaskAutoSelect, setSuppressTaskAutoSelect] = useState(false);
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
  const [taskCenterRefreshGeneration, setTaskCenterRefreshGeneration] = useState(0);
  const taskCenter = useTaskCenter({
    active: mode === "tasks",
    initialSelection: initialTaskCenterSelection,
    refreshGeneration: taskCenterRefreshGeneration,
  });

  /** 提交当前项目选择，并同步失效所有旧项目详情请求。 */
  const applyProjectSelection = useCallback(
    (projectId: string | null, resetNavigation: boolean) => {
      if (selectedProjectIdRef.current !== projectId) {
        selectedProjectIdRef.current = projectId;
        detailRequestGenerationRef.current += 1;
        setSelectedProjectId(projectId);
        setDetail(createAsyncState<ProjectDetailResponse>(null));
      }
      if (resetNavigation) {
        setView("overview");
        setSelectedSpecPath(null);
        setSelectedTaskSourcePath(null);
        setSelectedTaskDocumentPath(null);
        setSpecDocument(createAsyncState<ProjectDocumentResponse>(null));
        setTaskDetail(createAsyncState<TaskDetailResponse>(null));
        setTaskDocument(createAsyncState<ProjectDocumentResponse>(null));
        setSuppressTaskAutoSelect(false);
      }
    },
    [],
  );

  /** 仅在请求仍属于当前项目和最新代次时提交详情。 */
  const commitProjectDetail = useCallback(
    (projectId: string, generation: number, response: ProjectDetailResponse): boolean => {
      if (
        selectedProjectIdRef.current !== projectId ||
        detailRequestGenerationRef.current !== generation ||
        response.project.id !== projectId
      ) {
        return false;
      }

      setDetail({ data: response, loading: false, error: null });
      if (!response.contentReadable) {
        setSelectedSpecPath(null);
        setSelectedTaskSourcePath(null);
        setSelectedTaskDocumentPath(null);
        setSpecDocument(createAsyncState<ProjectDocumentResponse>(null));
        setTaskDetail(createAsyncState<TaskDetailResponse>(null));
        setTaskDocument(createAsyncState<ProjectDocumentResponse>(null));
        return true;
      }

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
      return true;
    },
    [],
  );

  /** 读取项目列表并修复失效的当前选择。 */
  const loadProjects = useCallback(async (background = false, signal?: AbortSignal) => {
    if (!background) {
      setProjects((current) => ({ ...current, loading: true, error: null }));
    }
    try {
      const response = await fetchProjects(signal);
      setProjects({ data: response.projects, loading: false, error: null });
      const currentProjectId = selectedProjectIdRef.current;
      const nextProjectId =
        currentProjectId !== null &&
        response.projects.some((item) => item.project.id === currentProjectId)
          ? currentProjectId
          : response.projects[0]?.project.id ?? null;
      applyProjectSelection(nextProjectId, nextProjectId !== currentProjectId);
      if (response.projects.length === 0) {
        setDiscoveryOpen(true);
      }
    } catch (error) {
      if (!isAbortError(error)) {
        setProjects((current) => ({ ...current, loading: false, error: getErrorMessage(error) }));
      }
    }
  }, [applyProjectSelection]);

  /** 读取一个项目的缓存详情。 */
  const loadDetail = useCallback(
    async (projectId: string, background = false, signal?: AbortSignal) => {
      const generation = detailRequestGenerationRef.current + 1;
      detailRequestGenerationRef.current = generation;
      if (!background) {
        setDetail({ data: null, loading: true, error: null });
      }
      try {
        const response = await fetchProject(projectId, signal);
        commitProjectDetail(projectId, generation, response);
      } catch (error) {
        if (
          !isAbortError(error) &&
          selectedProjectIdRef.current === projectId &&
          detailRequestGenerationRef.current === generation
        ) {
          setDetail((current) => ({ ...current, loading: false, error: getErrorMessage(error) }));
        }
      }
    },
    [commitProjectDetail],
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
    if (mode !== "project" || selectedProjectId === null) {
      if (selectedProjectId === null) {
        setDetail(createAsyncState<ProjectDetailResponse>(null));
      }
      return;
    }
    if (skipNextDetailLoadRef.current === selectedProjectId) {
      skipNextDetailLoadRef.current = null;
      return;
    }
    const controller = new AbortController();
    void loadDetail(selectedProjectId, false, controller.signal);
    return () => controller.abort();
  }, [loadDetail, mode, selectedProjectId]);

  useEffect(() => {
    if (
      selectedProjectId === null ||
      selectedSpecPath === null ||
      detail.data?.project.id !== selectedProjectId ||
      !detail.data.contentReadable ||
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
      !detail.data.contentReadable ||
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
      detail.data?.project.id !== selectedProjectId ||
      !detail.data.contentReadable ||
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
    detail.data,
    selectedProjectId,
    selectedTaskDocumentPath,
    selectedTaskSourcePath,
    taskDetail.data,
  ]);

  useEffect(() => {
    if (mode === "tasks") {
      writeUrlSelection({ mode, taskCenter: taskCenter.selection });
      return;
    }
    writeUrlSelection({
      mode,
      projectId: selectedProjectId,
      view,
      specPath: selectedSpecPath,
      taskSourcePath: selectedTaskSourcePath,
      taskDocumentPath: selectedTaskDocumentPath,
    });
  }, [
    mode,
    selectedProjectId,
    selectedSpecPath,
    selectedTaskDocumentPath,
    selectedTaskSourcePath,
    taskCenter.selection,
    view,
  ]);

  useEffect(() => {
    const pendingProjectIds = pendingEventProjectIdsRef.current;
    let disposed = false;
    let unlisten: (() => void) | null = null;
    setEventStreamState("connecting");
    void listen("trellis://project-realtime", (event) => {
      const payload: unknown = event.payload;
      if (isProjectRealtimeEvent(payload)) {
        pendingProjectIds.add(payload.projectId);
        if (eventRefreshTimerRef.current !== null) {
          window.clearTimeout(eventRefreshTimerRef.current);
        }
        eventRefreshTimerRef.current = window.setTimeout(() => {
          const projectIds = new Set(pendingProjectIds);
          pendingProjectIds.clear();
          eventRefreshTimerRef.current = null;
          void loadProjects(true);
          setTaskCenterRefreshGeneration((current) => current + 1);
          const currentProjectId = selectedProjectIdRef.current;
          if (currentProjectId !== null && projectIds.has(currentProjectId)) {
            void loadDetail(currentProjectId, true);
          }
        }, 150);
      }
    }).then((disposeListener) => {
      if (disposed) {
        disposeListener();
      } else {
        unlisten = disposeListener;
        setEventStreamState("connected");
      }
    }).catch(() => {
      if (!disposed) {
        setEventStreamState("unavailable");
      }
    });
    return () => {
      disposed = true;
      if (eventRefreshTimerRef.current !== null) {
        window.clearTimeout(eventRefreshTimerRef.current);
        eventRefreshTimerRef.current = null;
      }
      pendingProjectIds.clear();
      unlisten?.();
    };
  }, [loadDetail, loadProjects]);

  /** 选择项目并重置项目内导航。 */
  const selectProject = useCallback((projectId: string) => {
    setMode("project");
    applyProjectSelection(projectId, true);
    setDiscoveryOpen(false);
  }, [applyProjectSelection]);

  /** 打开全局跨项目任务中心。 */
  const openTaskCenter = useCallback(() => {
    setMode("tasks");
    setDiscoveryOpen(false);
  }, []);

  /** 从任务中心打开现有单项目 Task 详情。 */
  const openTaskCenterItem = useCallback(async (item: TaskCenterItemApi) => {
    const project = taskCenter.response?.projects.find(
      (candidate) => candidate.project.id === item.projectId,
    );
    if (project === undefined) {
      setNotice({ tone: "error", message: "任务所属项目已不在当前任务中心响应中，请重试" });
      return;
    }

    if (project.project.state === "focus") {
      setMode("project");
      applyProjectSelection(item.projectId, true);
      setView("tasks");
      setSelectedTaskSourcePath(item.task.sourcePath);
      setSelectedTaskDocumentPath(null);
      setSuppressTaskAutoSelect(false);
      setDiscoveryOpen(false);
      return;
    }

    await runAction(`task-center:${item.projectId}`, async () => {
      const response = await refreshProject(item.projectId);
      const projectChanged = selectedProjectIdRef.current !== item.projectId;
      if (projectChanged) {
        // 刷新接口已返回完整详情，避免项目切换 Effect 再发起一条重复详情请求。
        skipNextDetailLoadRef.current = item.projectId;
      }
      setMode("project");
      applyProjectSelection(item.projectId, true);
      const generation = detailRequestGenerationRef.current + 1;
      detailRequestGenerationRef.current = generation;
      commitProjectDetail(item.projectId, generation, response);
      setDiscoveryOpen(false);

      if (response.project.state === "unavailable") {
        setView("diagnostics");
        setNotice({ tone: "error", message: "项目已变为不可用，请查看诊断信息" });
      } else {
        setView("tasks");
        if (containsTask(response, item.task.sourcePath)) {
          setSelectedTaskSourcePath(item.task.sourcePath);
          setSuppressTaskAutoSelect(false);
        } else {
          setSelectedTaskSourcePath(null);
          setSuppressTaskAutoSelect(true);
          setNotice({ tone: "info", message: "任务快照已更新，原任务已不存在" });
        }
        setSelectedTaskDocumentPath(null);
      }

      await loadProjects(true);
      setTaskCenterRefreshGeneration((current) => current + 1);
    });
  }, [applyProjectSelection, commitProjectDetail, loadProjects, taskCenter.response]);

  /** 从任务中心进入不可用项目诊断视图。 */
  const openProjectDiagnostics = useCallback((projectId: string) => {
    setMode("project");
    applyProjectSelection(projectId, true);
    setView("diagnostics");
    setDiscoveryOpen(false);
  }, [applyProjectSelection]);

  /** 切换当前项目主视图。 */
  const selectView = useCallback((nextView: ProjectView) => setView(nextView), []);

  /** 执行项目聚焦或取消聚焦。 */
  const changeFocus = useCallback(
    async (focused: boolean) => {
      if (selectedProjectId === null) {
        return;
      }
      const projectId = selectedProjectId;
      await runAction(`focus:${projectId}`, async () => {
        const response = await setProjectFocus(projectId, focused);
        if (selectedProjectIdRef.current === projectId) {
          const generation = detailRequestGenerationRef.current + 1;
          detailRequestGenerationRef.current = generation;
          commitProjectDetail(projectId, generation, response);
        }
        await loadProjects(true);
        setNotice({
          tone: "success",
          message: focused ? "项目已加入焦点并开始监听" : "项目已移出焦点，最后快照已保留",
        });
      });
    },
    [commitProjectDetail, loadProjects, selectedProjectId],
  );

  /** 显式刷新当前项目。 */
  const refreshSelectedProject = useCallback(async () => {
    if (selectedProjectId === null) {
      return;
    }
    const projectId = selectedProjectId;
    await runAction(`refresh:${projectId}`, async () => {
      const response = await refreshProject(projectId);
      if (selectedProjectIdRef.current === projectId) {
        const generation = detailRequestGenerationRef.current + 1;
        detailRequestGenerationRef.current = generation;
        commitProjectDetail(projectId, generation, response);
      }
      await loadProjects(true);
      setNotice({ tone: "success", message: "项目快照已重新索引" });
    });
  }, [commitProjectDetail, loadProjects, selectedProjectId]);

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

  /** 打开系统目录选择对话框。 */
  const chooseDirectory = useCallback(async (): Promise<DirectoryPickerResponse> => {
    setBusyAction("directory-picker");
    try {
      return await selectDirectory();
    } finally {
      setBusyAction(null);
    }
  }, []);

  /** 打开桌面应用固定日志目录。 */
  const openLogs = useCallback(async () => {
    await runAction("open-logs", async () => {
      await openLogDirectory();
      setNotice({ tone: "info", message: "已打开应用日志目录" });
    });
  }, []);

  /** 明确确认后清除应用自有数据并退出。 */
  const clearApplicationData = useCallback(async () => {
    const confirmed = window.confirm(
      "将删除本地项目列表、摘要快照和应用日志并退出。已登记的 Trellis 项目不会被删除。是否继续？",
    );
    if (confirmed) {
      await runAction("clear-application-data", clearApplicationDataAndExit);
    }
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
    mode,
    taskCenter,
    selectedProjectId,
    view,
    selectedSpecPath,
    selectedTaskSourcePath,
    selectedTaskDocumentPath,
    suppressTaskAutoSelect,
    specDocument,
    taskDetail,
    taskDocument,
    eventStreamState,
    busyAction,
    notice,
    discoveryOpen,
    selectProject,
    openTaskCenter,
    openTaskCenterItem,
    openProjectDiagnostics,
    selectView,
    selectSpecPath: setSelectedSpecPath,
    selectTaskSourcePath: (sourcePath: string) => {
      setSelectedTaskSourcePath(sourcePath);
      setSelectedTaskDocumentPath(null);
      setSuppressTaskAutoSelect(false);
    },
    selectTaskDocumentPath: setSelectedTaskDocumentPath,
    changeFocus,
    refreshSelectedProject,
    openSelectedPath,
    discoverProjects,
    chooseDirectory,
    openLogs,
    clearApplicationData,
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

interface ProjectUrlSelection {
  mode: "project";
  projectId: string | null;
  view: ProjectView;
  specPath: string | null;
  taskSourcePath: string | null;
  taskDocumentPath: string | null;
}

interface TaskCenterUrlSelection {
  mode: "tasks";
  taskCenter: TaskCenterSelection;
}

type UrlSelection = ProjectUrlSelection | TaskCenterUrlSelection;

/** 创建项目工作区默认 URL 选择。 */
function createDefaultProjectUrlSelection(): ProjectUrlSelection {
  return {
    mode: "project",
    projectId: null,
    view: "overview",
    specPath: null,
    taskSourcePath: null,
    taskDocumentPath: null,
  };
}

/** 从 URL 查询参数恢复稳定选择。 */
function readUrlSelection(): UrlSelection {
  const params = new URLSearchParams(window.location.search);
  if (params.get("mode") === "tasks") {
    const status = params.get("status");
    return {
      mode: "tasks",
      taskCenter: {
        scope: readEnumValue(
          params.get("scope"),
          VALID_TASK_CENTER_SCOPES,
          DEFAULT_TASK_CENTER_SELECTION.scope,
        ),
        collection: readEnumValue(
          params.get("collection"),
          VALID_TASK_CENTER_COLLECTIONS,
          DEFAULT_TASK_CENTER_SELECTION.collection,
        ),
        query: params.get("q") ?? "",
        projectId: params.get("taskProject"),
        status: status === "done" ? "completed" : status,
        phase: params.get("phase"),
        assignee: params.get("assignee"),
        packageName: params.get("package"),
        sort: readEnumValue(
          params.get("sort"),
          VALID_TASK_CENTER_SORTS,
          DEFAULT_TASK_CENTER_SELECTION.sort,
        ),
      },
    };
  }

  const viewValue = params.get("view");
  return {
    mode: "project",
    projectId: params.get("project"),
    view: VALID_VIEWS.includes(viewValue as ProjectView) ? (viewValue as ProjectView) : "overview",
    specPath: params.get("spec"),
    taskSourcePath: params.get("task"),
    taskDocumentPath: params.get("document"),
  };
}

/** 将当前选择写回 URL，刷新页面后可以恢复阅读上下文。 */
function writeUrlSelection(selection: UrlSelection): void {
  const params = new URLSearchParams();
  if (selection.mode === "tasks") {
    params.set("mode", "tasks");
    if (selection.taskCenter.scope !== DEFAULT_TASK_CENTER_SELECTION.scope) {
      params.set("scope", selection.taskCenter.scope);
    }
    if (selection.taskCenter.collection !== DEFAULT_TASK_CENTER_SELECTION.collection) {
      params.set("collection", selection.taskCenter.collection);
    }
    if (selection.taskCenter.query.trim() !== "") {
      params.set("q", selection.taskCenter.query);
    }
    if (selection.taskCenter.projectId !== null) {
      params.set("taskProject", selection.taskCenter.projectId);
    }
    if (selection.taskCenter.status !== null) {
      params.set("status", selection.taskCenter.status);
    }
    if (selection.taskCenter.phase !== null) {
      params.set("phase", selection.taskCenter.phase);
    }
    if (selection.taskCenter.assignee !== null) {
      params.set("assignee", selection.taskCenter.assignee);
    }
    if (selection.taskCenter.packageName !== null) {
      params.set("package", selection.taskCenter.packageName);
    }
    if (selection.taskCenter.sort !== DEFAULT_TASK_CENTER_SELECTION.sort) {
      params.set("sort", selection.taskCenter.sort);
    }
    replaceUrlSearch(params);
    return;
  }

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
  replaceUrlSearch(params);
}

/** 使用替换历史记录的方式写入查询参数。 */
function replaceUrlSearch(params: URLSearchParams): void {
  const query = params.toString();
  window.history.replaceState(null, "", query === "" ? window.location.pathname : `?${query}`);
}

/** 读取有限枚举值，非法输入回退默认值。 */
function readEnumValue<T extends string>(
  value: string | null,
  values: T[],
  fallback: T,
): T {
  return values.includes(value as T) ? (value as T) : fallback;
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
