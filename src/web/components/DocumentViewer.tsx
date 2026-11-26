import { ExternalLink, FileText } from "lucide-react";
import { createElement, useCallback, useEffect, useMemo, useRef } from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ProjectDocumentResponse } from "../../shared/api";
import { formatDateTime } from "../formatters";
import type { AsyncState } from "../hooks/useProjectConsole";
import { buildHeadingIdMap, resolveMarkdownLink } from "../markdown-links";

interface DocumentViewerProps {
  document: AsyncState<ProjectDocumentResponse>;
  emptyMessage: string;
  onOpenSource: (sourcePath: string) => void;
  /** 上层把项目内链接路由到目标文档；未提供时相对链接只阻止默认导航。 */
  onNavigateDocument?: (sourcePath: string, anchor: string | null) => void;
  /** 跨文档跳转后待滚动的锚点。 */
  anchor?: string | null;
  /** 锚点处理完成，通知上层清空。 */
  onAnchorConsumed?: () => void;
}

type HeadingTag = "h1" | "h2" | "h3" | "h4" | "h5" | "h6";

/** 安全展示 Markdown 或 JSONL 文档，并保留源路径信息。 */
export function DocumentViewer({
  document,
  emptyMessage,
  onOpenSource,
  onNavigateDocument,
  anchor = null,
  onAnchorConsumed,
}: DocumentViewerProps) {
  const articleRef = useRef<HTMLElement | null>(null);
  const data = document.data;
  const headingIds = useMemo(
    () => buildHeadingIdMap(data?.format === "markdown" ? data.content : ""),
    [data],
  );

  /** 在当前文档容器内滚动到指定锚点。 */
  const scrollToAnchor = useCallback((target: string): void => {
    const container = articleRef.current;
    if (container === null || target.length === 0) {
      return;
    }
    const element = container.querySelector<HTMLElement>(`#${CSS.escape(target)}`);
    element?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, []);

  // 跨文档跳转时，等目标正文渲染完成后再滚动，并通知上层清空锚点。
  useEffect(() => {
    if (anchor === null || data === null) {
      return;
    }
    const frame = window.requestAnimationFrame(() => {
      scrollToAnchor(anchor);
      onAnchorConsumed?.();
    });
    return () => window.cancelAnimationFrame(frame);
  }, [anchor, data, onAnchorConsumed, scrollToAnchor]);

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
  if (data === null) {
    return (
      <div className="content-state">
        <FileText size={22} aria-hidden="true" />
        <span>{emptyMessage}</span>
      </div>
    );
  }

  const currentData = data;
  const markdownComponents: Components = {
    /**
     * 链接拦截：外部链接新窗口打开，相对链接交给应用内路由，锚点在当前容器滚动。
     * 任何情况下都阻止 WebView 直接导航到文件地址，避免白屏或丢失选择。
     */
    a: ({ node, href, children, ...props }) => {
      void node;
      const target = resolveMarkdownLink(href, currentData.sourcePath);
      if (target.kind === "external") {
        return (
          <a {...props} href={href} target="_blank" rel="noreferrer">
            {children}
          </a>
        );
      }
      return (
        <a
          {...props}
          href={href}
          onClick={(event) => {
            event.preventDefault();
            if (target.kind === "anchor") {
              scrollToAnchor(target.anchor);
              return;
            }
            if (target.kind === "file") {
              onNavigateDocument?.(target.sourcePath, target.anchor);
            }
          }}
        >
          {children}
        </a>
      );
    },
    h1: createHeadingRenderer("h1", headingIds),
    h2: createHeadingRenderer("h2", headingIds),
    h3: createHeadingRenderer("h3", headingIds),
    h4: createHeadingRenderer("h4", headingIds),
    h5: createHeadingRenderer("h5", headingIds),
    h6: createHeadingRenderer("h6", headingIds),
  };

  return (
    <article className="document-viewer" ref={articleRef}>
      <header className="document-toolbar">
        <div>
          <span className="document-format">{currentData.format === "markdown" ? "Markdown" : "JSONL"}</span>
          <code>{currentData.sourcePath}</code>
          <small>修改于 {formatDateTime(currentData.modifiedAt)}</small>
        </div>
        <button className="icon-button" type="button" onClick={() => onOpenSource(currentData.sourcePath)}>
          <ExternalLink size={16} aria-hidden="true" />
          外部打开
        </button>
      </header>

      {currentData.format === "markdown" ? (
        <div className="markdown-body">
          <ReactMarkdown remarkPlugins={[remarkGfm]} components={markdownComponents}>
            {currentData.content}
          </ReactMarkdown>
        </div>
      ) : (
        <pre className="jsonl-body" tabIndex={0}>
          <code>{currentData.content}</code>
        </pre>
      )}
    </article>
  );
}

/** 创建带 GitHub 风格 id 的标题渲染器，供锚点定位使用。 */
function createHeadingRenderer(
  tag: HeadingTag,
  headingIds: Map<number, string>,
): NonNullable<Components[HeadingTag]> {
  return ({ node, children, ...props }) => {
    const startLine = node?.position?.start.line;
    const id = startLine === undefined ? undefined : headingIds.get(startLine);
    return createElement(tag, { ...props, id }, children);
  };
}
