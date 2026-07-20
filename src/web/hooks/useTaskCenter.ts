import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  ProjectListItem,
  TaskCenterItemApi,
  TaskCenterResponse,
} from "../../shared/api";
import { fetchTaskCenter } from "../api-client";
import {
  formatTaskStatusValue,
  readTaskStatusGroup,
  type TaskStatusGroup,
} from "../formatters";

/** 任务中心项目范围。 */
export type TaskCenterScope = "focus" | "all";

/** 任务中心集合范围。 */
export type TaskCenterCollection = "active" | "archived" | "all";

/** 任务中心更新时间排序。 */
export type TaskCenterSort = "updated_desc" | "updated_asc";

/** 任务中心 URL 与交互选择。 */
export interface TaskCenterSelection {
  scope: TaskCenterScope;
  collection: TaskCenterCollection;
  query: string;
  projectId: string | null;
  status: string | null;
  phase: string | null;
  assignee: string | null;
  packageName: string | null;
  sort: TaskCenterSort;
}

/** 任务中心默认选择。 */
export const DEFAULT_TASK_CENTER_SELECTION: TaskCenterSelection = {
  scope: "focus",
  collection: "active",
  query: "",
  projectId: null,
  status: null,
  phase: null,
  assignee: null,
  packageName: null,
  sort: "updated_desc",
};

/** 任务中心有限状态选项。 */
export interface TaskCenterStatusOption {
  value: string;
  label: string;
}

/** 任务中心筛选选项。 */
export interface TaskCenterFilterOptions {
  projects: ProjectListItem[];
  statuses: TaskCenterStatusOption[];
  phases: string[];
  assignees: string[];
  packages: string[];
}

/** 任务中心汇总。 */
export interface TaskCenterSummary {
  total: number;
  active: number;
  archived: number;
  planning: number;
  inProgress: number;
  review: number;
  completed: number;
  other: number;
}

/** 已关联项目元数据的任务中心行。 */
export interface TaskCenterResultItem {
  item: TaskCenterItemApi;
  project: ProjectListItem;
}

interface UseTaskCenterOptions {
  active: boolean;
  initialSelection: TaskCenterSelection;
  refreshGeneration: number;
}

const EMPTY_SUMMARY: TaskCenterSummary = {
  total: 0,
  active: 0,
  archived: 0,
  planning: 0,
  inProgress: 0,
  review: 0,
  completed: 0,
  other: 0,
};

const TEXT_COLLATOR = new Intl.Collator("zh-CN");
const SEARCH_DEBOUNCE_MILLISECONDS = 200;

/** 管理任务中心请求、筛选、汇总和确定性排序。 */
export function useTaskCenter({
  active,
  initialSelection,
  refreshGeneration,
}: UseTaskCenterOptions) {
  const requestGenerationRef = useRef(0);
  const completedRequestKeyRef = useRef<string | null>(null);
  const [response, setResponse] = useState<TaskCenterResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [retryGeneration, setRetryGeneration] = useState(0);
  const [selection, setSelection] = useState<TaskCenterSelection>(initialSelection);
  const debouncedQuery = useDebouncedValue(selection.query, SEARCH_DEBOUNCE_MILLISECONDS);

  useEffect(() => {
    if (!active) {
      return;
    }

    const requestKey = `${refreshGeneration}:${retryGeneration}`;
    if (response !== null && completedRequestKeyRef.current === requestKey) {
      return;
    }

    const controller = new AbortController();
    const generation = requestGenerationRef.current + 1;
    requestGenerationRef.current = generation;
    setLoading(true);
    setError(null);
    void fetchTaskCenter(controller.signal)
      .then((nextResponse) => {
        if (requestGenerationRef.current === generation) {
          completedRequestKeyRef.current = requestKey;
          setResponse(nextResponse);
          setLoading(false);
        }
      })
      .catch((requestError: unknown) => {
        if (!isAbortError(requestError) && requestGenerationRef.current === generation) {
          setLoading(false);
          setError(getErrorMessage(requestError));
        }
      });

    return () => controller.abort();
  }, [active, refreshGeneration, response, retryGeneration]);

  const projectById = useMemo(
    () => new Map((response?.projects ?? []).map((project) => [project.project.id, project])),
    [response],
  );
  const eligibleProjects = useMemo(
    () => (response?.projects ?? []).filter(
      (project) => project.project.state !== "unavailable" && project.hasSnapshot,
    ),
    [response],
  );
  const scopedProjects = useMemo(
    () => eligibleProjects
      .filter((project) => selection.scope === "all" || project.project.state === "focus")
      .sort(compareProjectNames),
    [eligibleProjects, selection.scope],
  );
  const scopedProjectIds = useMemo(
    () => new Set(scopedProjects.map((project) => project.project.id)),
    [scopedProjects],
  );
  const scopedItems = useMemo(
    () => (response?.tasks ?? []).filter((item) => scopedProjectIds.has(item.projectId)),
    [response, scopedProjectIds],
  );
  const collectionItems = useMemo(
    () => scopedItems.filter(
      (item) => selection.collection === "all" || item.collection === selection.collection,
    ),
    [scopedItems, selection.collection],
  );
  const filterOptions = useMemo<TaskCenterFilterOptions>(() => ({
    projects: scopedProjects,
    statuses: createStatusOptions(collectionItems),
    phases: createStringOptions(collectionItems.map((item) => item.task.phase)),
    assignees: createStringOptions(collectionItems.map((item) => item.task.assignee)),
    packages: createStringOptions(collectionItems.map((item) => item.task.packageName)),
  }), [collectionItems, scopedProjects]);

  useEffect(() => {
    if (response === null) {
      return;
    }

    setSelection((current) => {
      const next: TaskCenterSelection = {
        ...current,
        projectId: hasProjectOption(filterOptions.projects, current.projectId)
          ? current.projectId
          : null,
        status: hasValueOption(filterOptions.statuses, current.status)
          ? current.status
          : null,
        phase: hasStringOption(filterOptions.phases, current.phase) ? current.phase : null,
        assignee: hasStringOption(filterOptions.assignees, current.assignee)
          ? current.assignee
          : null,
        packageName: hasStringOption(filterOptions.packages, current.packageName)
          ? current.packageName
          : null,
      };
      return selectionsEqual(current, next) ? current : next;
    });
  }, [filterOptions, response]);

  const results = useMemo(() => {
    const normalizedQuery = debouncedQuery.trim().toLocaleLowerCase("zh-CN");
    return collectionItems
      .filter((item) => selection.projectId === null || item.projectId === selection.projectId)
      .filter((item) => selection.status === null || matchesStatusFilter(item, selection.status))
      .filter((item) => selection.phase === null || item.task.phase === selection.phase)
      .filter((item) => selection.assignee === null || item.task.assignee === selection.assignee)
      .filter(
        (item) => selection.packageName === null || item.task.packageName === selection.packageName,
      )
      .map((item): TaskCenterResultItem | null => {
        const project = projectById.get(item.projectId);
        return project === undefined ? null : { item, project };
      })
      .filter((item): item is TaskCenterResultItem => item !== null)
      .filter((item) => normalizedQuery === "" || matchesQuery(item, normalizedQuery))
      .sort((left, right) => compareTaskCenterItems(
        left,
        right,
        selection.scope,
        selection.sort,
      ));
  }, [
    collectionItems,
    debouncedQuery,
    projectById,
    selection.assignee,
    selection.packageName,
    selection.phase,
    selection.projectId,
    selection.scope,
    selection.sort,
    selection.status,
  ]);

  const summary = useMemo(() => results.reduce<TaskCenterSummary>(
    (current, result) => addSummaryItem(current, result.item),
    { ...EMPTY_SUMMARY },
  ), [results]);

  const unavailableProjects = useMemo(
    () => (response?.projects ?? []).filter((project) => project.project.state === "unavailable"),
    [response],
  );
  const noSnapshotProjects = useMemo(
    () => (response?.projects ?? []).filter(
      (project) => project.project.state !== "unavailable" && !project.hasSnapshot,
    ),
    [response],
  );

  /** 合并一组任务中心选择。 */
  const updateSelection = useCallback((patch: Partial<TaskCenterSelection>) => {
    setSelection((current) => ({ ...current, ...patch }));
  }, []);

  /** 清除搜索和筛选，恢复任务中心默认状态。 */
  const clearSelection = useCallback(() => {
    setSelection(DEFAULT_TASK_CENTER_SELECTION);
  }, []);

  /** 重新请求任务中心响应。 */
  const retry = useCallback(() => {
    setRetryGeneration((current) => current + 1);
  }, []);

  return {
    response,
    loading,
    error,
    selection,
    queryPending: selection.query !== debouncedQuery,
    filterOptions,
    results,
    summary,
    unavailableProjects,
    noSnapshotProjects,
    updateSelection,
    clearSelection,
    retry,
  };
}

/** 任务中心 Hook 的公开返回合同。 */
export type TaskCenterState = ReturnType<typeof useTaskCenter>;

/** 将旧完成状态规范化为标准筛选值。 */
function normalizeStatusFilter(status: string): string {
  return status === "done" ? "completed" : status;
}

/** 判断任务是否命中标准或未知状态筛选。 */
function matchesStatusFilter(item: TaskCenterItemApi, selectedStatus: string): boolean {
  const normalized = normalizeStatusFilter(selectedStatus);
  return normalized === "completed"
    ? readTaskStatusGroup(item.task.status) === "completed"
    : item.task.status === normalized;
}

/** 创建去重且稳定排序的状态选项。 */
function createStatusOptions(items: TaskCenterItemApi[]): TaskCenterStatusOption[] {
  const values = new Set(items.map((item) => normalizeStatusFilter(item.task.status)));
  return [...values]
    .sort(compareStatusValues)
    .map((value) => ({ value, label: formatTaskStatusValue(value) }));
}

/** 创建去重且稳定排序的非空字符串选项。 */
function createStringOptions(values: Array<string | null>): string[] {
  return [...new Set(values.filter((value): value is string => value !== null))]
    .sort((left, right) => TEXT_COLLATOR.compare(left, right));
}

/** 按标准状态顺序排列筛选项，未知状态使用中文排序。 */
function compareStatusValues(left: string, right: string): number {
  const order: Record<TaskStatusGroup, number> = {
    planning: 0,
    in_progress: 1,
    review: 2,
    completed: 3,
    other: 4,
  };
  const groupDifference = order[readTaskStatusGroup(left)] - order[readTaskStatusGroup(right)];
  return groupDifference === 0 ? TEXT_COLLATOR.compare(left, right) : groupDifference;
}

/** 判断任务中心行是否命中元数据关键词。 */
function matchesQuery(result: TaskCenterResultItem, normalizedQuery: string): boolean {
  const { task } = result.item;
  return [
    result.project.project.label,
    task.title,
    task.id,
    task.status,
    formatTaskStatusValue(task.status),
    task.phase ?? "",
    task.assignee ?? "",
    task.packageName ?? "",
  ].some((value) => value.toLocaleLowerCase("zh-CN").includes(normalizedQuery));
}

/** 按范围、更新时间和稳定回退键排序任务中心结果。 */
function compareTaskCenterItems(
  left: TaskCenterResultItem,
  right: TaskCenterResultItem,
  scope: TaskCenterScope,
  sort: TaskCenterSort,
): number {
  if (scope === "all") {
    const stateDifference = readProjectStateOrder(left.project) - readProjectStateOrder(right.project);
    if (stateDifference !== 0) {
      return stateDifference;
    }
  }

  const timeDifference = compareUpdatedAt(
    left.item.task.updatedAt,
    right.item.task.updatedAt,
    sort,
  );
  if (timeDifference !== 0) {
    return timeDifference;
  }

  return compareStableTexts(
    [
      left.project.project.label,
      left.item.task.title,
      left.item.task.id,
      left.item.task.sourcePath,
    ],
    [
      right.project.project.label,
      right.item.task.title,
      right.item.task.id,
      right.item.task.sourcePath,
    ],
  );
}

/** 缺少更新时间的任务始终排在有时间任务之后。 */
function compareUpdatedAt(
  left: string | null,
  right: string | null,
  sort: TaskCenterSort,
): number {
  if (left === null && right === null) {
    return 0;
  }
  if (left === null) {
    return 1;
  }
  if (right === null) {
    return -1;
  }
  const difference = Date.parse(left) - Date.parse(right);
  return sort === "updated_asc" ? difference : -difference;
}

/** 依次比较稳定文本键。 */
function compareStableTexts(left: string[], right: string[]): number {
  for (let index = 0; index < left.length; index += 1) {
    const difference = TEXT_COLLATOR.compare(left[index] ?? "", right[index] ?? "");
    if (difference !== 0) {
      return difference;
    }
  }
  return 0;
}

/** 按项目显示名称稳定排序。 */
function compareProjectNames(left: ProjectListItem, right: ProjectListItem): number {
  return TEXT_COLLATOR.compare(left.project.label, right.project.label);
}

/** 返回项目在全部范围内的展示优先级。 */
function readProjectStateOrder(project: ProjectListItem): number {
  switch (project.project.state) {
    case "focus":
      return 0;
    case "history":
      return 1;
    case "unavailable":
      return 2;
  }
}

/** 累加一个任务到当前汇总。 */
function addSummaryItem(
  summary: TaskCenterSummary,
  item: TaskCenterItemApi,
): TaskCenterSummary {
  summary.total += 1;
  summary[item.collection] += 1;
  switch (readTaskStatusGroup(item.task.status)) {
    case "planning":
      summary.planning += 1;
      break;
    case "in_progress":
      summary.inProgress += 1;
      break;
    case "review":
      summary.review += 1;
      break;
    case "completed":
      summary.completed += 1;
      break;
    case "other":
      summary.other += 1;
      break;
  }
  return summary;
}

/** 判断项目筛选是否仍然有效。 */
function hasProjectOption(projects: ProjectListItem[], projectId: string | null): boolean {
  return projectId === null || projects.some((project) => project.project.id === projectId);
}

/** 判断值标签筛选是否仍然有效。 */
function hasValueOption(options: TaskCenterStatusOption[], value: string | null): boolean {
  return value === null || options.some((option) => option.value === value);
}

/** 判断字符串筛选是否仍然有效。 */
function hasStringOption(options: string[], value: string | null): boolean {
  return value === null || options.includes(value);
}

/** 判断两个选择对象是否完全一致。 */
function selectionsEqual(left: TaskCenterSelection, right: TaskCenterSelection): boolean {
  return Object.keys(left).every((key) => {
    const typedKey = key as keyof TaskCenterSelection;
    return left[typedKey] === right[typedKey];
  });
}

/** 判断错误是否来自主动取消请求。 */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === "AbortError";
}

/** 提取用户可见错误消息。 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "任务中心读取失败，请重试";
}

/** 延迟高频输入值，避免每次按键都重跑全量筛选和排序。 */
function useDebouncedValue<T>(value: T, delay: number): T {
  const [debouncedValue, setDebouncedValue] = useState(value);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedValue(value), delay);
    return () => window.clearTimeout(timer);
  }, [delay, value]);

  return debouncedValue;
}
