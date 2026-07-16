import { AlertCircle, AlertTriangle, RefreshCw } from "lucide-react";
import type { ProjectDetailResponse } from "../../shared/api";

interface DiagnosticsPanelProps {
  detail: ProjectDetailResponse;
  busyAction: string | null;
  onRefresh: () => void;
}

/** 展示项目索引警告、错误和不可用恢复入口。 */
export function DiagnosticsPanel({ detail, busyAction, onRefresh }: DiagnosticsPanelProps) {
  const diagnostics = detail.snapshot?.diagnostics ?? [];
  return (
    <section className="diagnostics-page">
      {detail.project.state === "unavailable" ? (
        <div className="unavailable-banner" role="alert">
          <AlertCircle size={22} aria-hidden="true" />
          <div>
            <strong>项目当前不可用</strong>
            <span>{detail.project.error?.message ?? "项目路径、权限或 Trellis 结构发生变化。"}</span>
          </div>
          <button className="secondary-button" type="button" disabled={busyAction !== null} onClick={onRefresh}>
            <RefreshCw size={15} aria-hidden="true" />
            重新校验
          </button>
        </div>
      ) : null}

      {diagnostics.length === 0 ? (
        <div className="content-state">当前快照没有诊断信息。</div>
      ) : (
        <div className="diagnostic-list">
          {diagnostics.map((diagnostic, index) => (
            <article className={`diagnostic-item diagnostic-item--${diagnostic.severity}`} key={`${diagnostic.code}-${index}`}>
              {diagnostic.severity === "error" ? <AlertCircle size={18} /> : <AlertTriangle size={18} />}
              <div>
                <header>
                  <strong>{diagnostic.severity === "error" ? "错误" : "警告"}</strong>
                  <code>{diagnostic.code}</code>
                </header>
                <p>{diagnostic.message}</p>
                {diagnostic.sourcePath !== null ? <code>{diagnostic.sourcePath}</code> : null}
              </div>
            </article>
          ))}
        </div>
      )}
    </section>
  );
}
