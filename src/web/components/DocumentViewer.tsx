import { ChevronDown, ChevronUp, ExternalLink, FileText, Search, X } from "lucide-react";
import {
  createElement,
  useCallback,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
} from "react";
import ReactMarkdown, { type Components } from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ProjectDocumentResponse } from "../../shared/api";
import { formatDateTime } from "../formatters";
import type { AsyncState } from "../hooks/useProjectConsole";
import { buildHeadingIdMap, resolveMarkdownLink } from "../markdown-links";
import { createSearchHighlightPlugin } from "../markdown-search";

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
  // 当前文档路径；查找状态必须与它绑定，避免切换文档时用旧关键词统计新文档。
  const documentPath = data?.sourcePath ?? null;
  const headingIds = useMemo(
    () => buildHeadingIdMap(data?.format === "markdown" ? data.content : ""),
    [data],
  );

  // 文内查找全部使用组件本地状态：仅影响当前阅读区，不写入 URL。
  const [findOpen, setFindOpen] = useState(false);
  const [findQuery, setFindQuery] = useState("");
  const [activeMatch, setActiveMatch] = useState(0);
  const [matchCount, setMatchCount] = useState(0);
  const findInputRef = useRef<HTMLInputElement | null>(null);
  // 记录当前查找会话所属的文档路径，用于识别切换文档后的陈旧状态。
  const findDocumentPathRef = useRef<string | null>(documentPath);

  // 关闭查找条后不再渲染高亮，但保留关键词便于再次打开继续调整。
  const highlightQuery = findOpen ? findQuery : "";

  // 固定 remark 插件引用，避免查找相关状态变化时无谓地重复解析 Markdown。
  const remarkPlugins = useMemo(() => [remarkGfm], []);
  const rehypePlugins = useMemo(
    () =>
      highlightQuery.trim().length > 0
        ? [createSearchHighlightPlugin({ query: highlightQuery, activeIndex: activeMatch })]
        : undefined,
    [highlightQuery, activeMatch],
  );

  /** 关闭查找条并清除高亮与计数，保留已输入关键词。 */
  const closeFind = useCallback(() => {
    setFindOpen(false);
    setActiveMatch(0);
    setMatchCount(0);
  }, []);

  /** 在命中之间循环移动；无命中时保持当前位置。 */
  const moveMatch = useCallback(
    (direction: 1 | -1) => {
      setActiveMatch((previous) => {
        if (matchCount === 0) {
          return 0;
        }
        return (previous + direction + matchCount) % matchCount;
      });
    },
    [matchCount],
  );

  /** 关键词变化后回到第一处命中并重新计数。 */
  const handleFindQueryChange = useCallback((value: string) => {
    findDocumentPathRef.current = documentPath;
    setFindQuery(value);
    setActiveMatch(0);
  }, [documentPath]);

  /** 打开查找条；已打开时（重复按快捷键）重新聚焦并全选关键词。 */
  const openFind = useCallback(() => {
    // 查找会话绑定到打开时的文档，切换文档后不再沿用。
    findDocumentPathRef.current = documentPath;
    setFindOpen(true);
    const input = findInputRef.current;
    if (input !== null) {
      input.focus();
      input.select();
    }
  }, [documentPath]);

  /** 查找条按键：Esc 关闭，输入框内 Enter / Shift + Enter 跳转。 */
  const handleFindKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      // 中文输入法组词确认时的回车用于上屏，不能当作跳转。
      // 部分 WebKit 版本在确认组词时 isComposing 为 false，用 keyCode 229 兜底。
      if (event.nativeEvent.isComposing || event.nativeEvent.keyCode === 229) {
        return;
      }
      if (event.key === "Escape") {
        event.preventDefault();
        closeFind();
        return;
      }
      // 只处理输入框上的回车，避免按钮聚焦时重复触发跳转。
      if (event.key === "Enter" && event.target === findInputRef.current) {
        event.preventDefault();
        moveMatch(event.shiftKey ? -1 : 1);
      }
    },
    [closeFind, moveMatch],
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

  // Markdown 文档内拦截 Ctrl/Cmd + F，改由应用内查找条处理，避免 WebView 原生查找。
  useEffect(() => {
    if (data?.format !== "markdown") {
      return;
    }
    const handleWindowKeyDown = (event: KeyboardEvent): void => {
      if ((!event.metaKey && !event.ctrlKey) || event.altKey) {
        return;
      }
      if (event.key.toLowerCase() !== "f") {
        return;
      }
      // 弹窗内部保留原生快捷键语义，不与文档查找冲突。
      if (event.target instanceof Element && event.target.closest('[role="dialog"]') !== null) {
        return;
      }
      event.preventDefault();
      openFind();
    };
    window.addEventListener("keydown", handleWindowKeyDown);
    return () => window.removeEventListener("keydown", handleWindowKeyDown);
  }, [data?.format, openFind]);

  // 切换文档（含切换 Task / Spec、切换为无文档）时彻底重置查找状态。
  // 使用 layout effect：在绘制前关闭高亮，避免新文档闪现旧关键词的命中。
  useLayoutEffect(() => {
    setFindOpen(false);
    setFindQuery("");
    setActiveMatch(0);
    setMatchCount(0);
  }, [documentPath]);

  // 打开查找条后聚焦并全选关键词，便于直接覆盖输入。
  useEffect(() => {
    if (!findOpen) {
      return;
    }
    const input = findInputRef.current;
    if (input === null) {
      return;
    }
    input.focus();
    input.select();
  }, [findOpen]);

  // 渲染完成后再读取实际高亮结果：统计命中总数、钳制越界序号并滚动到当前命中。
  useLayoutEffect(() => {
    if (!findOpen) {
      setMatchCount(0);
      return;
    }
    // 查找会话属于旧文档时，本次提交不做统计和滚动，等重置后的渲染再处理。
    if (findDocumentPathRef.current !== documentPath) {
      return;
    }
    const container = articleRef.current;
    if (container === null) {
      return;
    }
    const marks = container.querySelectorAll<HTMLElement>("mark[data-search-match-index]");
    const indices = new Set<number>();
    marks.forEach((mark) => {
      const rawIndex = mark.dataset.searchMatchIndex;
      if (rawIndex !== undefined) {
        indices.add(Number(rawIndex));
      }
    });
    const total = indices.size;
    setMatchCount(total);
    if (total === 0) {
      return;
    }
    // 关键词或文档变化导致当前序号越界时回到第一处。
    if (activeMatch >= total) {
      setActiveMatch(0);
      return;
    }
    const activeMark = container.querySelector<HTMLElement>(
      `mark[data-search-match-index="${activeMatch}"]`,
    );
    activeMark?.scrollIntoView({ block: "center" });
  }, [activeMatch, data?.content, documentPath, findOpen, findQuery]);

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
  const isMarkdown = currentData.format === "markdown";
  // 空关键词不展示计数；无命中时给出明确提示。
  const trimmedQuery = findQuery.trim();
  const findStatus =
    trimmedQuery.length === 0 ? "" : matchCount === 0 ? "无结果" : `${activeMatch + 1} / ${matchCount}`;
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
          <span className="document-format">{isMarkdown ? "Markdown" : "JSONL"}</span>
          <code>{currentData.sourcePath}</code>
          <small>修改于 {formatDateTime(currentData.modifiedAt)}</small>
        </div>
        {/* 使用 span 包裹按钮，避免命中 .document-toolbar > div 的网格布局。 */}
        <span className="document-toolbar-actions">
          {isMarkdown ? (
            <button
              className="icon-button"
              type="button"
              aria-label="在文档内查找"
              title="在文档内查找（Ctrl/Cmd + F）"
              onClick={openFind}
            >
              <Search size={16} aria-hidden="true" />
              查找
            </button>
          ) : null}
          <button
            className="icon-button"
            type="button"
            onClick={() => onOpenSource(currentData.sourcePath)}
          >
            <ExternalLink size={16} aria-hidden="true" />
            外部打开
          </button>
        </span>
      </header>

      {/* 阅读区容器：查找条相对正文定位，不随正文滚动，也不会压到工具栏。 */}
      <div className="document-body">
        {/* 文内查找条浮于正文右上角，不挤压正文布局。 */}
        {isMarkdown && findOpen ? (
          <div
            className="document-find"
            role="search"
            aria-label="文档内查找"
            onKeyDown={handleFindKeyDown}
          >
            <Search size={15} aria-hidden="true" />
            <input
              ref={findInputRef}
              className="document-find-input"
              type="search"
              value={findQuery}
              onChange={(event) => handleFindQueryChange(event.target.value)}
              aria-label="在文档中查找"
              placeholder="在文档中查找"
              autoComplete="off"
            />
            <span className="document-find-status" aria-live="polite">
              {findStatus}
            </span>
            <button
              className="icon-only-button document-find-button"
              type="button"
              aria-label="上一个命中"
              title="上一个命中（Shift + Enter）"
              disabled={matchCount === 0}
              onClick={() => moveMatch(-1)}
            >
              <ChevronUp size={15} aria-hidden="true" />
            </button>
            <button
              className="icon-only-button document-find-button"
              type="button"
              aria-label="下一个命中"
              title="下一个命中（Enter）"
              disabled={matchCount === 0}
              onClick={() => moveMatch(1)}
            >
              <ChevronDown size={15} aria-hidden="true" />
            </button>
            <button
              className="icon-only-button document-find-button"
              type="button"
              aria-label="关闭查找"
              title="关闭查找（Esc）"
              onClick={closeFind}
            >
              <X size={15} aria-hidden="true" />
            </button>
          </div>
        ) : null}

        {isMarkdown ? (
          <div className="markdown-body">
            <ReactMarkdown
              remarkPlugins={remarkPlugins}
              rehypePlugins={rehypePlugins}
              components={markdownComponents}
            >
              {currentData.content}
            </ReactMarkdown>
          </div>
        ) : (
          <pre className="jsonl-body" tabIndex={0}>
            <code>{currentData.content}</code>
          </pre>
        )}
      </div>
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
