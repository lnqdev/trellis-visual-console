import { ExternalLink, GitBranch } from "lucide-react";
import type { ProjectDetailResponse } from "../../shared/api";
import { formatDateTime } from "../formatters";

interface WorkflowPanelProps {
  detail: ProjectDetailResponse;
  onOpenSource: (sourcePath: string) => void;
}

/** 展示 Workflow 名称、当前阶段和源文件定位。 */
export function WorkflowPanel({ detail, onOpenSource }: WorkflowPanelProps) {
  const snapshot = detail.snapshot;
  if (snapshot === null) {
    return <div className="content-state">当前项目没有 Workflow 快照。</div>;
  }
  const workflow = snapshot.workflow;
  return (
    <section className="workflow-page">
      <article className="panel-card workflow-hero">
        <GitBranch size={24} aria-hidden="true" />
        <span className="eyebrow">WORKFLOW SUMMARY</span>
        <h2>{workflow.name ?? "未识别 Workflow 名称"}</h2>
        <strong>{workflow.summary ?? "当前没有活动阶段"}</strong>
        <dl className="detail-list">
          <div><dt>阶段键</dt><dd>{workflow.currentPhase ?? "无"}</dd></div>
          <div><dt>索引时间</dt><dd>{formatDateTime(snapshot.indexedAt)}</dd></div>
          <div><dt>来源</dt><dd>{workflow.sourcePath ?? "workflow.md 不可用"}</dd></div>
        </dl>
        {workflow.sourcePath !== null ? (
          <button className="secondary-button" type="button" onClick={() => onOpenSource(workflow.sourcePath!)}>
            <ExternalLink size={15} aria-hidden="true" />
            外部打开 Workflow
          </button>
        ) : null}
      </article>
    </section>
  );
}
