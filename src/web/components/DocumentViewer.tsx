import { ExternalLink, FileText } from "lucide-react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ProjectDocumentResponse } from "../../shared/api";
import { formatDateTime } from "../formatters";
import type { AsyncState } from "../hooks/useProjectConsole";

interface DocumentViewerProps {
  document: AsyncState<ProjectDocumentResponse>;
  emptyMessage: string;
  onOpenSource: (sourcePath: string) => void;
}

/** 安全展示 Markdown 或 JSONL 文档，并保留源路径信息。 */
export function DocumentViewer({ document, emptyMessage, onOpenSource }: DocumentViewerProps) {
  if (document.loading && document.data === null) {
    return <div className="content-state">正在读取文档…</div>;
  }
  if (document.error !== null) {
    return (
      <div className="content-state content-state--error" role="alert">
        <strong>文档读取失败</strong>
        <span>{document.error}</span>
      </div>
    );
  }
  if (document.data === null) {
    return (
      <div className="content-state">
        <FileText size={22} aria-hidden="true" />
        <span>{emptyMessage}</span>
      </div>
    );
  }

  const data = document.data;
  return (
    <article className="document-viewer">
      <header className="document-toolbar">
        <div>
          <span className="document-format">{data.format === "markdown" ? "Markdown" : "JSONL"}</span>
          <code>{data.sourcePath}</code>
          <small>修改于 {formatDateTime(data.modifiedAt)}</small>
        </div>
        <button className="icon-button" type="button" onClick={() => onOpenSource(data.sourcePath)}>
          <ExternalLink size={16} aria-hidden="true" />
          外部打开
        </button>
      </header>

      {data.format === "markdown" ? (
        <div className="markdown-body">
          <ReactMarkdown
            remarkPlugins={[remarkGfm]}
            components={{
              a: ({ node, href, children, ...props }) => {
                void node;
                const external = href?.startsWith("http://") || href?.startsWith("https://");
                return (
                  <a
                    {...props}
                    href={href}
                    {...(external ? { target: "_blank", rel: "noreferrer" } : {})}
                  >
                    {children}
                  </a>
                );
              },
            }}
          >
            {data.content}
          </ReactMarkdown>
        </div>
      ) : (
        <pre className="jsonl-body" tabIndex={0}>
          <code>{data.content}</code>
        </pre>
      )}
    </article>
  );
}
