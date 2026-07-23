import {
  ListChecks,
  RefreshCw,
  RotateCcw,
  Search,
  TriangleAlert,
} from "lucide-react";
import { useEffect, useState } from "react";
import type { TaskCenterItemApi } from "../../shared/api";
import { formatDateTime, formatTaskStatusValue, readTaskStatusGroup } from "../formatters";
import {
  DEFAULT_TASK_CENTER_SELECTION,
  type TaskCenterSelection,
  type TaskCenterState,
} from "../hooks/useTaskCenter";
import { Dropdown, type DropdownOption } from "./Dropdown";

interface TaskCenterProps {
  state: TaskCenterState;
  busy: boolean;
  onOpenTask: (item: TaskCenterItemApi) => void;
  onOpenDiagnostics: (projectId: string) => void;
  onOpenDiscovery: () => void;
}

const TASK_CENTER_PAGE_SIZE = 100;
const TASK_CENTER_SORT_OPTIONS: ReadonlyArray<
  DropdownOption<TaskCenterSelection["sort"]>
> = [
  { value: "updated_desc", label: "最近更新优先" },
  { value: "updated_asc", label: "最早更新优先" },
];
const ALL_DROPDOWN_OPTION: DropdownOption<null> = {
  value: null,
  label: "全部",
};

/** 展示跨项目任务搜索、筛选、汇总和扁平工作列表。 */
export function TaskCenter({
  state,
  busy,
  onOpenTask,
  onOpenDiagnostics,
  onOpenDiscovery,
}: TaskCenterProps) {
  const [visibleCount, setVisibleCount] = useState(TASK_CENTER_PAGE_SIZE);
  const projects = state.response?.projects ?? [];
  const focusCount = projects.filter((project) => project.project.state === "focus").length;
  const historyCount = projects.filter((project) => project.project.state === "history").length;
  const hasFilters = !isDefaultSelection(state.selection);
  const visibleResults = state.results.slice(0, visibleCount);
  const hasMoreResults = visibleResults.length < state.results.length;

  useEffect(() => {
    setVisibleCount(TASK_CENTER_PAGE_SIZE);
  }, [state.results]);

  if (state.response === null && state.error === null) {
    return <div className="workspace-loading">正在聚合跨项目 Task 摘要…</div>;
  }

  if (state.error !== null && state.response === null) {
    return (
      <section className="empty-workspace" role="alert">
        <TriangleAlert size={28} aria-hidden="true" />
        <h1>任务中心读取失败</h1>
        <p>{state.error}</p>
        <button className="secondary-button" type="button" onClick={state.retry}>
          <RefreshCw size={15} aria-hidden="true" />
          重试
        </button>
      </section>
    );
  }

  if (projects.length === 0) {
    return (
      <section className="empty-workspace">
        <ListChecks size={28} aria-hidden="true" />
        <h1>还没有可聚合的项目</h1>
        <p>先登记一个 Trellis 项目，再从任务中心集中查看任务。</p>
        <button className="primary-button" type="button" onClick={onOpenDiscovery}>
          添加项目
        </button>
      </section>
    );
  }

  return (
    <section className="task-center-page" aria-label="跨项目任务中心">
      <header className="task-center-heading">
        <div>
          <span className="eyebrow">GLOBAL TASK CENTER</span>
          <h1>跨项目任务中心</h1>
          <p>
            当前结果 {state.summary.total} 个 · 焦点 {focusCount} 个 · 历史 {historyCount} 个 ·
            不可用 {state.unavailableProjects.length} 个 · 无快照 {state.noSnapshotProjects.length} 个
          </p>
        </div>
        {state.loading || state.queryPending ? (
          <span className="task-center-refreshing" aria-live="polite">
            {state.loading ? "正在刷新…" : "正在筛选…"}
          </span>
        ) : null}
      </header>

      {state.error !== null ? (
        <div className="task-center-inline-error" role="alert">
          <span>{state.error}</span>
          <button type="button" onClick={state.retry}>重试</button>
        </div>
      ) : null}

      <div className="task-center-segments">
        <SegmentedControl
          label="项目范围"
          value={state.selection.scope}
          options={[
            { value: "focus", label: "焦点项目" },
            { value: "all", label: "全部项目" },
          ]}
          onChange={(scope) => state.updateSelection({ scope })}
        />
        <SegmentedControl
          label="任务集合"
          value={state.selection.collection}
          options={[
            { value: "active", label: "活动" },
            { value: "archived", label: "归档" },
            { value: "all", label: "全部" },
          ]}
          onChange={(collection) => state.updateSelection({ collection })}
        />
      </div>

      <div className="task-center-filters">
        {/* 第一行：搜索输入 + 排序 + 清除 */}
        <div className="task-center-filters-primary">
          <label className="task-center-search">
            <span>搜索</span>
            <span className="task-center-search-control">
              <Search size={15} aria-hidden="true" />
              <input
                type="search"
                aria-label="搜索"
                value={state.selection.query}
                placeholder="项目、标题、ID、状态、阶段、负责人或包"
                onChange={(event) => state.updateSelection({ query: event.target.value })}
              />
            </span>
          </label>
          <Dropdown
            className="task-center-sort"
            label="排序"
            value={state.selection.sort}
            options={TASK_CENTER_SORT_OPTIONS}
            onChange={(sort) => state.updateSelection({ sort })}
          />
          <button
            className="task-center-reset"
            type="button"
            title="清除搜索和筛选"
            disabled={!hasFilters}
            onClick={state.clearSelection}
          >
            <RotateCcw size={15} aria-hidden="true" />
            清除条件
          </button>
        </div>
        {/* 第二行：五个维度筛选下拉 */}
        <div className="task-center-filters-secondary">
          <Dropdown
            label="项目"
            value={state.selection.projectId}
            options={withAllOption(state.filterOptions.projects.map((project) => ({
              value: project.project.id,
              label: project.project.label,
            })))}
            onChange={(projectId) => state.updateSelection({ projectId })}
          />
          <Dropdown
            label="状态"
            value={state.selection.status}
            options={withAllOption(state.filterOptions.statuses)}
            onChange={(status) => state.updateSelection({ status })}
          />
          <Dropdown
            label="阶段"
            value={state.selection.phase}
            options={withAllOption(toTextOptions(state.filterOptions.phases))}
            onChange={(phase) => state.updateSelection({ phase })}
          />
          <Dropdown
            label="负责人"
            value={state.selection.assignee}
            options={withAllOption(toTextOptions(state.filterOptions.assignees))}
            onChange={(assignee) => state.updateSelection({ assignee })}
          />
          <Dropdown
            label="包"
            value={state.selection.packageName}
            options={withAllOption(toTextOptions(state.filterOptions.packages))}
            onChange={(packageName) => state.updateSelection({ packageName })}
          />
        </div>
      </div>

      <div className="task-center-summary" aria-label="当前任务汇总">
        <SummaryItem label="总数" value={state.summary.total} />
        <SummaryItem label="活动" value={state.summary.active} />
        <SummaryItem label="归档" value={state.summary.archived} />
        <SummaryItem label="规划中" value={state.summary.planning} />
        <SummaryItem label="实施中" value={state.summary.inProgress} />
        <SummaryItem label="评审中" value={state.summary.review} />
        <SummaryItem label="已完成" value={state.summary.completed} />
        <SummaryItem label="其他" value={state.summary.other} />
      </div>

      <UnavailableProjects
        projects={state.unavailableProjects}
        onOpenDiagnostics={onOpenDiagnostics}
      />

      {state.selection.scope === "focus" && focusCount === 0 ? (
        <div className="task-center-empty">
          <ListChecks size={24} aria-hidden="true" />
          <strong>当前没有焦点项目</strong>
          <span>可以切换到全部项目查看历史快照任务。</span>
          <button
            className="secondary-button"
            type="button"
            onClick={() => state.updateSelection({ scope: "all" })}
          >
            查看全部项目
          </button>
        </div>
      ) : state.results.length === 0 ? (
        <div className="task-center-empty">
          <Search size={24} aria-hidden="true" />
          <strong>没有匹配的任务</strong>
          <span>当前条件会继续保留，可以调整筛选或一键清除。</span>
          <button className="secondary-button" type="button" onClick={state.clearSelection}>
            清除条件
          </button>
        </div>
      ) : (
        <div className="task-center-results">
          <div className="task-center-list" aria-label="跨项目 Task 列表">
            {visibleResults.map(({ item, project }) => (
              <button
                key={`${item.projectId}:${item.collection}:${item.task.sourcePath}`}
                className="task-center-row"
                type="button"
                disabled={busy}
                onClick={() => onOpenTask(item)}
              >
                <span className="task-center-project-cell">
                  <strong>{project.project.label}</strong>
                  <small>
                    {project.project.state === "history" ? "历史快照" : "焦点项目"}
                    {project.project.state === "history"
                      ? ` · ${formatDateTime(project.project.lastIndexedAt)}`
                      : ""}
                  </small>
                </span>
                <span className="task-center-title-cell">
                  <strong>{item.task.title}</strong>
                  <small>{item.task.id}</small>
                  {item.parentTitle !== null ? <small>父任务：{item.parentTitle}</small> : null}
                </span>
                <span className="task-center-collection-cell">
                  {item.collection === "active" ? "活动" : "归档"}
                </span>
                <span
                  className={`task-center-status task-center-status--${readTaskStatusGroup(item.task.status)}`}
                >
                  {formatTaskStatusValue(item.task.status)}
                </span>
                <MetaValue label="阶段" value={item.task.phase} />
                <MetaValue label="负责人" value={item.task.assignee} />
                <MetaValue label="包" value={item.task.packageName} />
                <span className="task-center-time-cell">
                  <small>更新时间</small>
                  <strong>{formatDateTime(item.task.updatedAt)}</strong>
                </span>
              </button>
            ))}
          </div>
          {hasMoreResults ? (
            <div className="task-center-load-more" aria-live="polite">
              <span>已显示 {visibleResults.length} / {state.results.length} 个任务</span>
              <button
                className="secondary-button"
                type="button"
                onClick={() => setVisibleCount((current) => Math.min(
                  current + TASK_CENTER_PAGE_SIZE,
                  state.results.length,
                ))}
              >
                加载更多
              </button>
            </div>
          ) : null}
        </div>
      )}
    </section>
  );
}

interface SegmentedControlProps<T extends string> {
  label: string;
  value: T;
  options: Array<{ value: T; label: string }>;
  onChange: (value: T) => void;
}

/** 展示单选分段控件。 */
function SegmentedControl<T extends string>({
  label,
  value,
  options,
  onChange,
}: SegmentedControlProps<T>) {
  return (
    <div className="task-center-segment" role="group" aria-label={label}>
      {options.map((option) => (
        <button
          key={option.value}
          type="button"
          className={value === option.value ? "active" : ""}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

/** 展示一个汇总数字。 */
function SummaryItem({ label, value }: { label: string; value: number }) {
  return (
    <span>
      <small>{label}</small>
      <strong>{value}</strong>
    </span>
  );
}

/** 展示单个任务元数据值。 */
function MetaValue({ label, value }: { label: string; value: string | null }) {
  return (
    <span className="task-center-meta-cell">
      <small>{label}</small>
      <strong>{value ?? "—"}</strong>
    </span>
  );
}

interface UnavailableProjectsProps {
  projects: TaskCenterState["unavailableProjects"];
  onOpenDiagnostics: (projectId: string) => void;
}

/** 展示不可用项目数量和诊断入口。 */
function UnavailableProjects({ projects, onOpenDiagnostics }: UnavailableProjectsProps) {
  if (projects.length === 0) {
    return null;
  }

  if (projects.length === 1 && projects[0] !== undefined) {
    const project = projects[0];
    return (
      <button
        className="task-center-unavailable"
        type="button"
        onClick={() => onOpenDiagnostics(project.project.id)}
      >
        <TriangleAlert size={15} aria-hidden="true" />
        {project.project.label} 当前不可用，查看诊断
      </button>
    );
  }

  return (
    <details className="task-center-unavailable-list">
      <summary>
        <TriangleAlert size={15} aria-hidden="true" />
        {projects.length} 个项目当前不可用，展开查看诊断
      </summary>
      <div>
        {projects.map((project) => (
          <button
            key={project.project.id}
            type="button"
            onClick={() => onOpenDiagnostics(project.project.id)}
          >
            {project.project.label}
          </button>
        ))}
      </div>
    </details>
  );
}

/** 为可空筛选选项补充统一的“全部”入口。 */
function withAllOption<T extends string>(
  options: ReadonlyArray<DropdownOption<T>>,
): Array<DropdownOption<T | null>> {
  return [ALL_DROPDOWN_OPTION, ...options];
}

/** 将字符串数组转换为下拉选项。 */
function toTextOptions(values: string[]): Array<DropdownOption<string>> {
  return values.map((value) => ({ value, label: value }));
}

/** 判断任务中心是否仍处于默认选择。 */
function isDefaultSelection(selection: TaskCenterSelection): boolean {
  return Object.keys(DEFAULT_TASK_CENTER_SELECTION).every((key) => {
    const typedKey = key as keyof TaskCenterSelection;
    return selection[typedKey] === DEFAULT_TASK_CENTER_SELECTION[typedKey];
  });
}
