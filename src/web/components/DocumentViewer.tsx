import { ChevronDown, ChevronUp, ExternalLink, FileText, List, Search, X } from "lucide-react";
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
import {
  buildDocumentOutline,
  buildHeadingIdMap,
  resolveMarkdownLink,
  type DocumentOutlineNode,
} from "../markdown-links";
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

/** 判定“当前章节”时标题越过容器顶部的缓冲距离。 */
const OUTLINE_ACTIVE_OFFSET = 28;

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
  // 正文滚动容器，滚动高亮需要以它为参照计算标题位置。
  const markdownBodyRef = useRef<HTMLDivElement | null>(null);
  const data = document.data;
  // 当前文档路径；查找状态必须与它绑定，避免切换文档时用旧关键词统计新文档。
  const documentPath = data?.sourcePath ?? null;
  const headingIds = useMemo(
    () => buildHeadingIdMap(data?.format === "markdown" ? data.content : ""),
    [data],
  );
  // 大纲与正文标题基于同一份内容扫描，切换文档时随内容一起更新。
  const outlineNodes = useMemo(
    () => (data?.format === "markdown" ? buildDocumentOutline(data.content) : []),
    [data],
  );
  // 当前阅读位置对应的标题 id；窄屏抽屉的展开状态也属于本地交互。
  const [activeHeadingId, setActiveHeadingId] = useState<string | null>(null);
  const [outlineOpen, setOutlineOpen] = useState(false);

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

  /** 点击大纲条目：滚动到标题顶部并同步高亮，窄屏抽屉随后收起。 */
  const handleOutlineSelect = useCallback(
    (id: string) => {
      scrollToAnchor(id);
      setActiveHeadingId(id);
      setOutlineOpen(false);
    },
    [scrollToAnchor],
  );

  // 滚动高亮当前章节：取最后一个已越过容器顶部的标题。
  // 用固定阈值判断，而不是多个元素交错触发，避免相邻标题边界处来回抖动。
  useLayoutEffect(() => {
    const container = markdownBodyRef.current;
    if (container === null || outlineNodes.length === 0) {
      setActiveHeadingId(null);
      return;
    }
    let frame = 0;
    const updateActiveHeading = (): void => {
      frame = 0;
      // 宽屏由正文容器滚动，≤820px 时容器不设高度上限、改为整页滚动，
      // 两种模式分别取容器顶边或视口顶边作为判定基准。
      const containerRect = container.getBoundingClientRect();
      const scrollsInContainer = container.scrollHeight > container.clientHeight + 2;
      const pageHeight = window.document.documentElement.scrollHeight;
      // 已滚到底部时，按“最后一段可见章节”判定，避免末章永远高亮不到；
      // 页面本身不能滚动时不算到底，否则短文档会一上来就高亮最后一节。
      const atBottom = scrollsInContainer
        ? container.scrollTop + container.clientHeight >= container.scrollHeight - 2
        : pageHeight > window.innerHeight + 2 && window.scrollY + window.innerHeight >= pageHeight - 2;
      const viewportHeight = scrollsInContainer ? container.clientHeight : window.innerHeight;
      // 顶部判定加一点缓冲，让刚滚到顶部的标题先于下一节成为当前章节。
      const threshold = atBottom ? viewportHeight - 24 : OUTLINE_ACTIVE_OFFSET;
      const headings = Array.from(container.querySelectorAll<HTMLElement>(":is(h1, h2, h3)[id]"));
      let currentId: string | null = null;
      for (const heading of headings) {
        const top = scrollsInContainer
          ? heading.getBoundingClientRect().top - containerRect.top
          : heading.getBoundingClientRect().top;
        if (top <= threshold) {
          currentId = heading.id;
        }
      }
      setActiveHeadingId(currentId ?? headings[0]?.id ?? null);
    };
    const scheduleUpdate = (): void => {
      if (frame !== 0) {
        return;
      }
      frame = window.requestAnimationFrame(updateActiveHeading);
    };
    updateActiveHeading();
    // 容器滚动与整页滚动都要监听，滚动模式由窗口宽度决定。
    container.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("scroll", scheduleUpdate, { passive: true });
    window.addEventListener("resize", scheduleUpdate);
    return () => {
      container.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("scroll", scheduleUpdate);
      window.removeEventListener("resize", scheduleUpdate);
      if (frame !== 0) {
        window.cancelAnimationFrame(frame);
      }
    };
  }, [outlineNodes]);

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
    // 大纲抽屉同样属于单份文档的交互状态，切换文档后回到收起。
    setOutlineOpen(false);
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
  // JSONL、空文档与无标题文档都不提供大纲入口。
  const outlineVisible = isMarkdown && outlineNodes.length > 0;
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
          {/* 窄屏通过此按钮展开大纲抽屉；宽屏大纲常驻，按钮由样式隐藏。 */}
          {outlineVisible ? (
            <button
              className="icon-button document-outline-toggle"
              type="button"
              aria-expanded={outlineOpen}
              aria-controls="document-outline"
              aria-label="文档大纲"
              title="文档大纲"
              onClick={() => setOutlineOpen((open) => !open)}
            >
              <List size={16} aria-hidden="true" />
              大纲
            </button>
          ) : null}
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

      {/* 阅读区容器：查找条相对正文定位，不随正文滚动，也不会压到工具栏。
          有大纲时变为两列，正文列保持可滚动，大纲列独立滚动。 */}
      <div className={`document-body${outlineVisible ? " document-body--with-outline" : ""}`}>
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
          <div className="markdown-body" ref={markdownBodyRef}>
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

        {outlineVisible ? (
          <nav
            id="document-outline"
            className={`document-outline${outlineOpen ? " document-outline--open" : ""}`}
            aria-label="文档大纲"
          >
            <div className="document-outline-panel">
              <header>
                <span className="eyebrow">OUTLINE</span>
                <button
                  className="icon-only-button document-outline-close"
                  type="button"
                  aria-label="关闭大纲"
                  title="关闭大纲"
                  onClick={() => setOutlineOpen(false)}
                >
                  <X size={15} aria-hidden="true" />
                </button>
              </header>
              <ul>
                {outlineNodes.map((node) => (
                  <OutlineNode
                    key={node.id}
                    node={node}
                    depth={0}
                    activeId={activeHeadingId}
                    onSelect={handleOutlineSelect}
                  />
                ))}
              </ul>
            </div>
          </nav>
        ) : null}
      </div>
    </article>
  );
}

interface OutlineNodeProps {
  node: DocumentOutlineNode;
  /** 当前条目在树中的深度，用于计算缩进。 */
  depth: number;
  activeId: string | null;
  onSelect: (id: string) => void;
}

/** 递归展示大纲条目；缩进由 data-depth 交给样式，层级最多三层。 */
function OutlineNode({ node, depth, activeId, onSelect }: OutlineNodeProps) {
  const isActive = node.id === activeId;
  return (
    <li>
      <button
        className={`document-outline-item${isActive ? " is-active" : ""}`}
        type="button"
        data-depth={Math.min(depth, 2)}
        title={node.text}
        {...(isActive ? { "aria-current": "location" as const } : {})}
        onClick={(event) => {
          // 鼠标点击后释放焦点，让收起态的导轨立即复原；键盘激活（detail 为 0）保留焦点。
          if (event.detail > 0) {
            event.currentTarget.blur();
          }
          onSelect(node.id);
        }}
      >
        {/* 收起态只显示短横线，展开面板时才露出文字。 */}
        <span className="document-outline-dash" aria-hidden="true" />
        <span className="document-outline-label">{node.text}</span>
      </button>
      {node.children.length > 0 ? (
        <ul>
          {node.children.map((child) => (
            <OutlineNode
              key={child.id}
              node={child}
              depth={depth + 1}
              activeId={activeId}
              onSelect={onSelect}
            />
          ))}
        </ul>
      ) : null}
    </li>
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
