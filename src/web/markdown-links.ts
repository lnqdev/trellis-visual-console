/**
 * Markdown 链接解析与标题锚点工具。
 *
 * 这里的函数全部保持纯函数，便于文档查看器、导航 Hook 复用，
 * 同时把异常输入（编码错误、越界路径、空 href）统一收敛为可判断的结果。
 */

/** Markdown 链接的分类结果。 */
export type MarkdownLinkTarget =
  | { kind: "external" }
  | { kind: "anchor"; anchor: string }
  | { kind: "file"; sourcePath: string; anchor: string | null }
  | { kind: "invalid" };

/** 项目内可浏览路径的统一前缀。 */
const TRELLIS_ROOT_PREFIX = ".trellis/";

/** 扫描出的单个标题：行号、级别、纯文本与锚点 id。 */
interface ScannedHeading {
  /** 标题在原文中的起始行号，从 1 开始。 */
  line: number;
  /** 标题级别，1 表示 h1。 */
  level: number;
  /** 去掉行内 Markdown 标记后的可见文字。 */
  text: string;
  /** GitHub 风格锚点 id，与正文标题元素 id 一致。 */
  id: string;
}

/** 文档大纲中的一个标题节点。 */
export interface DocumentOutlineNode {
  /** 标题锚点 id，点击后滚动到同 id 的正文标题。 */
  id: string;
  /** 标题可见文字。 */
  text: string;
  /** 标题级别，1 表示 h1。 */
  level: 1 | 2 | 3;
  /** 标题在原文中的起始行号，从 1 开始。 */
  line: number;
  /** 下级标题；大纲只展开到 h3。 */
  children: DocumentOutlineNode[];
}

/** 形如 `https:`、`mailto:`、`file:` 的显式协议。 */
const SCHEME_PATTERN = /^[a-z][a-z0-9+.-]*:/i;

/** 可阅读的任务文档扩展名。 */
const READABLE_DOCUMENT_PATTERN = /\.(?:md|jsonl)$/i;

/**
 * 判断目标路径是否是应用内可阅读的 Markdown / JSONL 文档。
 */
export function isReadableDocumentPath(sourcePath: string): boolean {
  return READABLE_DOCUMENT_PATTERN.test(sourcePath);
}

/**
 * 解析 Markdown 链接为外部链接、页内锚点、项目内文件或无效链接。
 *
 * @param href 原始 href，可能为 undefined
 * @param currentSourcePath 当前文档的项目内相对路径，例如 `.trellis/tasks/x/prd.md`
 */
export function resolveMarkdownLink(
  href: string | undefined,
  currentSourcePath: string,
): MarkdownLinkTarget {
  const rawHref = href?.trim();
  if (rawHref === undefined || rawHref.length === 0) {
    return { kind: "invalid" };
  }

  // 纯锚点链接：只在当前文档内滚动。
  if (rawHref.startsWith("#")) {
    const anchor = decodeURIValue(rawHref.slice(1));
    return anchor.length === 0 ? { kind: "invalid" } : { kind: "anchor", anchor };
  }

  // 协议链接与协议相对链接交给系统/新窗口处理。
  if (rawHref.startsWith("//") || SCHEME_PATTERN.test(rawHref)) {
    return { kind: "external" };
  }

  const hashIndex = rawHref.indexOf("#");
  const hash = hashIndex >= 0 ? rawHref.slice(hashIndex + 1) : null;
  const pathAndQuery = hashIndex >= 0 ? rawHref.slice(0, hashIndex) : rawHref;
  const queryIndex = pathAndQuery.indexOf("?");
  const rawPath = queryIndex >= 0 ? pathAndQuery.slice(0, queryIndex) : pathAndQuery;
  const anchor = hash === null ? null : decodeURIValue(hash);

  // 只有查询串/空路径时，视为当前文档内锚点或无效链接。
  if (rawPath.length === 0) {
    if (anchor === null || anchor.length === 0) {
      return { kind: "invalid" };
    }
    return { kind: "anchor", anchor };
  }

  const normalizedPath = normalizeTargetPath(decodeURIValue(rawPath), currentSourcePath);
  if (normalizedPath === null) {
    return { kind: "invalid" };
  }
  return { kind: "file", sourcePath: normalizedPath, anchor };
}

/**
 * 为 Markdown 正文中的标题构建“起始行号 → GitHub 风格 id”的映射。
 *
 * 使用行号而不是渲染顺序作为键，避免 React 渲染顺序变化导致锚点错位；
 * 同名标题按 GitHub 规则追加 `-1`、`-2`。
 */
export function buildHeadingIdMap(content: string): Map<number, string> {
  const headingIds = new Map<number, string>();
  for (const heading of collectHeadings(content)) {
    headingIds.set(heading.line, heading.id);
  }
  return headingIds;
}

/**
 * 构建文档大纲（h1–h3）的层级结构。
 *
 * 标题 id 直接复用 {@link buildHeadingIdMap} 的同一份扫描结果，
 * 因此大纲条目的跳转目标与正文标题 id 必然一致；跳过 fenced code block、
 * 无可见文字（slug 为空）的标题，与锚点生成规则保持一致。
 */
export function buildDocumentOutline(content: string): DocumentOutlineNode[] {
  const roots: DocumentOutlineNode[] = [];
  // 栈中保留从根到当前标题的祖先链，便于按级别挂载子节点。
  const stack: DocumentOutlineNode[] = [];

  for (const heading of collectHeadings(content)) {
    if (heading.level > 3) {
      continue;
    }
    const node: DocumentOutlineNode = {
      id: heading.id,
      text: heading.text,
      level: heading.level as 1 | 2 | 3,
      line: heading.line,
      children: [],
    };
    // 级别不高于当前标题的节点不再是祖先，先弹出；h3 无 h2 时自然挂到最近的 h1。
    let parent = stack[stack.length - 1];
    while (parent !== undefined && parent.level >= node.level) {
      stack.pop();
      parent = stack[stack.length - 1];
    }
    if (parent === undefined) {
      roots.push(node);
    } else {
      parent.children.push(node);
    }
    stack.push(node);
  }

  return roots;
}

/**
 * 逐行扫描 Markdown 标题并分配锚点 id。
 *
 * 行号键与 GitHub 风格的 `-1`、`-2` 去重规则都在这里统一处理，
 * 供锚点渲染与文档大纲共用，避免两处规则漂移导致跳转错位。
 */
function collectHeadings(content: string): ScannedHeading[] {
  const headings: ScannedHeading[] = [];
  const occurrences = new Map<string, number>();
  let inFence = false;

  content.split("\n").forEach((line, index) => {
    // 跳过 fenced code block，避免把代码注释识别为标题。
    if (/^\s*(```|~~~)/.test(line)) {
      inFence = !inFence;
      return;
    }
    if (inFence) {
      return;
    }

    const match = /^ {0,3}#{1,6}\s+(.+?)\s*#*\s*$/.exec(line);
    if (match === null) {
      return;
    }
    const text = stripInlineMarkdown(match[1] ?? "");
    const baseId = slugifyHeadingText(text);
    if (baseId.length === 0) {
      return;
    }
    const seenCount = occurrences.get(baseId) ?? 0;
    occurrences.set(baseId, seenCount + 1);
    headings.push({
      line: index + 1,
      level: (line.trimStart().match(/^#+/)?.[0].length ?? 1),
      text,
      id: seenCount === 0 ? baseId : `${baseId}-${seenCount}`,
    });
  });

  return headings;
}

/**
 * 按 POSIX 规则把链接路径解析为项目内路径，越出 `.trellis` 根目录时返回 null。
 */
function normalizeTargetPath(rawPath: string, currentSourcePath: string): string | null {
  const normalizedRawPath = rawPath.replace(/\\/g, "/");
  if (normalizedRawPath.startsWith("/")) {
    return null;
  }

  const basePath = normalizedRawPath.startsWith(TRELLIS_ROOT_PREFIX)
    ? normalizedRawPath
    : joinWithParentDirectory(currentSourcePath, normalizedRawPath);
  return normalizeProjectPath(basePath);
}

/** 以当前文档所在目录为基准拼接链接路径。 */
function joinWithParentDirectory(currentSourcePath: string, rawPath: string): string {
  const parentIndex = currentSourcePath.lastIndexOf("/");
  const parentPath = parentIndex >= 0 ? currentSourcePath.slice(0, parentIndex) : "";
  return parentPath.length === 0 ? rawPath : `${parentPath}/${rawPath}`;
}

/** 逐段归一化 `.` 与 `..`，并保证结果仍位于 `.trellis` 目录内。 */
function normalizeProjectPath(path: string): string | null {
  const segments: string[] = [];
  for (const segment of path.split("/")) {
    if (segment.length === 0 || segment === ".") {
      continue;
    }
    if (segment === "..") {
      if (segments.length === 0) {
        return null;
      }
      segments.pop();
      continue;
    }
    segments.push(segment);
  }

  const normalizedPath = segments.join("/");
  if (!normalizedPath.startsWith(TRELLIS_ROOT_PREFIX)) {
    return null;
  }
  return normalizedPath;
}

/** 容错解码 URI 片段，异常时保留原文。 */
function decodeURIValue(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

/**
 * 去掉标题中的常见行内 Markdown 标记，只保留可见文字。
 *
 * 下划线的强调只在词边界生效，避免把 `snake_case` 这类标识符中的下划线删掉，
 * 否则生成的锚点会与 GitHub 不一致。
 */
function stripInlineMarkdown(text: string): string {
  return text
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/`([^`]*)`/g, "$1")
    .replace(/<[^>]+>/g, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/(^|[^\p{L}\p{N}])__([^_]+)__(?![\p{L}\p{N}])/gu, "$1$2")
    .replace(/\*([^*]+)\*/g, "$1")
    .replace(/(^|[^\p{L}\p{N}])_([^_]+)_(?![\p{L}\p{N}])/gu, "$1$2")
    .replace(/~~(.*?)~~/g, "$1");
}

/**
 * 生成与 GitHub 一致的标题 slug：小写、保留文字/数字/标记/下划线/连字符，
 * 每个空格转一个连字符，其余标点移除。
 */
function slugifyHeadingText(text: string): string {
  return text
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{N}\p{M}\p{Pc}\- ]/gu, "")
    .replace(/ /g, "-");
}
