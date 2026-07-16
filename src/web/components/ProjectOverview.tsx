import { AlertTriangle, Boxes, GitBranch, ListTodo, Package, Radio } from "lucide-react";
import type { ProjectDetailResponse } from "../../shared/api";
import { formatDateTime, formatWatchMode } from "../formatters";

interface ProjectOverviewProps {
  detail: ProjectDetailResponse;
}

/** 展示项目快照的关键指标、包和 Workflow 摘要。 */
export function ProjectOverview({ detail }: ProjectOverviewProps) {
  const snapshot = detail.snapshot;
  if (snapshot === null) {
    return <div className="content-state">当前项目还没有可用摘要快照，请先刷新项目。</div>;
  }

  return (
    <section className="overview-grid" aria-label="项目概览">
      <div className="metric-grid">
        <MetricCard icon={<ListTodo size={18} />} label="活动任务" value={snapshot.tasks.active.length} />
        <MetricCard icon={<Boxes size={18} />} label="归档任务" value={snapshot.tasks.archived.length} />
        <MetricCard icon={<Package size={18} />} label="项目包" value={snapshot.overview.packages.length} />
        <MetricCard icon={<AlertTriangle size={18} />} label="诊断" value={snapshot.diagnostics.length} />
      </div>

      <article className="panel-card overview-status-card">
        <div className="panel-title">
          <Radio size={19} aria-hidden="true" />
          <div>
            <h2>数据状态</h2>
            <p>快照与运行时监听是两个独立状态。</p>
          </div>
        </div>
        <dl className="detail-list">
          <div>
            <dt>监听模式</dt>
            <dd>{formatWatchMode(detail.runtime.watchMode)}</dd>
          </div>
          <div>
            <dt>快照时间</dt>
            <dd>{formatDateTime(snapshot.indexedAt)}</dd>
          </div>
          <div>
            <dt>待处理变化</dt>
            <dd>{detail.runtime.pendingChanges}</dd>
          </div>
          <div>
            <dt>事实来源</dt>
            <dd><code>{snapshot.overview.path}/.trellis</code></dd>
          </div>
        </dl>
      </article>

      <article className="panel-card">
        <div className="panel-title">
          <GitBranch size={19} aria-hidden="true" />
          <div>
            <h2>Workflow</h2>
            <p>根据活动任务状态推断的当前阶段。</p>
          </div>
        </div>
        <div className="workflow-summary-card">
          <strong>{snapshot.workflow.name ?? "未识别 Workflow 名称"}</strong>
          <span>{snapshot.workflow.summary ?? "当前没有活动阶段"}</span>
          {snapshot.workflow.sourcePath !== null ? <code>{snapshot.workflow.sourcePath}</code> : null}
        </div>
      </article>

      <article className="panel-card package-card">
        <div className="panel-title">
          <Package size={19} aria-hidden="true" />
          <div>
            <h2>项目包</h2>
            <p>来自 `.trellis/config.yaml` 的 monorepo 配置。</p>
          </div>
        </div>
        {snapshot.overview.packages.length === 0 ? (
          <p className="empty-copy">单仓库项目或没有配置 packages。</p>
        ) : (
          <div className="package-list">
            {snapshot.overview.packages.map((projectPackage) => (
              <div key={projectPackage.name}>
                <strong>{projectPackage.name}</strong>
                <code>{projectPackage.path}</code>
                <span>{projectPackage.type ?? "未指定类型"}{projectPackage.git ? " · 独立 Git" : ""}</span>
              </div>
            ))}
          </div>
        )}
      </article>
    </section>
  );
}

interface MetricCardProps {
  icon: React.ReactNode;
  label: string;
  value: number;
}

/** 展示单个项目摘要指标。 */
function MetricCard({ icon, label, value }: MetricCardProps) {
  return (
    <article className="metric-card">
      <span aria-hidden="true">{icon}</span>
      <div>
        <strong>{value}</strong>
        <small>{label}</small>
      </div>
    </article>
  );
}
