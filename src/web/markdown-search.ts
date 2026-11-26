/**
 * Markdown 文内查找高亮工具。
 *
 * 在 rehype 渲染阶段遍历语法树，把正文文本按关键词切分并包装成 `<mark>`，
 * 避免直接改写 React 管理的 DOM，同时保证高亮结果与最终渲染内容一致。
 * 这里刻意不依赖 unified / hast 类型包（pnpm 严格依赖下不可直接引用），
 * 只定义最小可用的节点结构。
 */

/** 文内查找高亮插件的参数。 */
export interface SearchHighlightOptions {
  /** 原始关键词，内部会去首尾空白并转为小写后再匹配。 */
  query: string;
  /** 当前激活的命中序号，从 0 开始；用于追加更强的强调样式。 */
  activeIndex: number;
}

/** hast 文本节点。 */
interface HastTextNode {
  type: "text";
  value: string;
}

/** hast 元素节点，仅保留本工具需要的字段。 */
interface HastElementNode {
  type: "element";
  tagName: string;
  properties: Record<string, unknown>;
  children: HastNode[];
}

/** hast 根节点。 */
interface HastRootNode {
  type: "root";
  children: HastNode[];
}

/** 其余未知节点（注释、doctype 等），遍历时直接跳过。 */
interface HastUnknownNode {
  type: string;
}

type HastNode = HastTextNode | HastElementNode | HastRootNode | HastUnknownNode;

type HastParentNode = HastElementNode | HastRootNode;

/** 文本组中的单个文本节点及其在拼接文本里的起始偏移。 */
interface TextGroupEntry {
  node: HastTextNode;
  start: number;
}

/** 最近块级容器内的一组可见文本，用于跨行内元素匹配。 */
interface TextGroup {
  text: string;
  entries: TextGroupEntry[];
}

/** 文本节点内部的一段落命中区间。 */
interface TextMatchRange {
  start: number;
  end: number;
  matchIndex: number;
}

/**
 * 块级标签集合：遇到这些元素时切分文本组，
 * 保证匹配不会跨越段落、列表项、表格单元格等块级边界。
 */
const BLOCK_TAGS = new Set<string>([
  "p",
  "li",
  "td",
  "th",
  "h1",
  "h2",
  "h3",
  "h4",
  "h5",
  "h6",
  "blockquote",
  "pre",
  "dt",
  "dd",
  "figcaption",
  "summary",
  "div",
  "ul",
  "ol",
  "table",
  "thead",
  "tbody",
  "tfoot",
  "tr",
  "caption",
  "details",
  "section",
  "article",
  "aside",
  "header",
  "footer",
  "main",
  "nav",
  "figure",
  "dl",
]);

/** 创建 rehype 插件：在渲染阶段把命中的正文文本包装成 mark 元素。 */
export function createSearchHighlightPlugin(
  options: SearchHighlightOptions,
): () => (tree: unknown) => void {
  // 关键词在创建插件时归一化一次，后续每次渲染直接复用。
  const query = options.query.trim().toLocaleLowerCase("zh-CN");
  const activeIndex = options.activeIndex;

  return () => (tree: unknown): void => {
    // 空关键词不产生任何高亮，原样返回语法树。
    if (query.length === 0) {
      return;
    }
    if (!isParentNode(tree)) {
      return;
    }

    // 第一步：按块级容器收集可见文本，行内元素文本并入最近的块级组。
    const groups: TextGroup[] = [];
    collectTextGroups(tree, groups);

    // 第二步：在拼接文本上查找命中，并映射回具体文本节点的局部区间。
    const rangesByNode = new Map<HastTextNode, TextMatchRange[]>();
    let matchIndex = 0;
    for (const group of groups) {
      const haystack = group.text.toLocaleLowerCase("zh-CN");
      let found = haystack.indexOf(query);
      while (found !== -1) {
        const matchEnd = found + query.length;
        for (const entry of group.entries) {
          const nodeStart = entry.start;
          const nodeEnd = entry.start + entry.node.value.length;
          const overlapStart = Math.max(found, nodeStart);
          const overlapEnd = Math.min(matchEnd, nodeEnd);
          if (overlapStart < overlapEnd) {
            const ranges = rangesByNode.get(entry.node) ?? [];
            ranges.push({
              start: overlapStart - nodeStart,
              end: overlapEnd - nodeStart,
              matchIndex,
            });
            rangesByNode.set(entry.node, ranges);
          }
        }
        matchIndex += 1;
        // 非重叠匹配：从当前命中末尾继续查找，避免同一个字符被重复计算。
        found = haystack.indexOf(query, matchEnd);
      }
    }

    if (matchIndex === 0) {
      return;
    }

    // 第三步：重建每个父节点的 children，把文本节点替换为 text / mark 片段。
    rewriteChildren(tree, rangesByNode, activeIndex);
  };
}

/** 判断节点是否包含 children，可作为遍历的父节点。 */
function isParentNode(node: unknown): node is HastParentNode {
  if (node === null || typeof node !== "object") {
    return false;
  }
  const candidate = node as { type?: unknown; children?: unknown };
  return (
    (candidate.type === "root" || candidate.type === "element") && Array.isArray(candidate.children)
  );
}

/** 判断是否为文本节点。 */
function isTextNode(node: HastNode): node is HastTextNode {
  return node.type === "text";
}

/** 判断是否为元素节点。 */
function isElementNode(node: HastNode): node is HastElementNode {
  return node.type === "element";
}

/**
 * 按最近的块级容器收集文本组。
 *
 * 块级元素之间互不串组；行内元素（strong、em、code、a 等）的文本继续并入
 * 当前块级组，因此被行内标记打断的关键词依然可以命中。
 */
function collectTextGroups(parent: HastParentNode, groups: TextGroup[]): void {
  let current = createTextGroup();

  /** 结束当前文本组，非空时加入结果集。 */
  const flush = (): void => {
    if (current.text.length > 0) {
      groups.push(current);
    }
    current = createTextGroup();
  };

  /** 递归遍历子节点；块级元素会切分文本组，行内元素保持同一组。 */
  const visit = (node: HastNode): void => {
    if (isTextNode(node)) {
      if (node.value.length > 0) {
        current.entries.push({ node, start: current.text.length });
        current.text += node.value;
      }
      return;
    }
    if (!isElementNode(node)) {
      return;
    }
    if (BLOCK_TAGS.has(node.tagName)) {
      flush();
      collectTextGroups(node, groups);
      return;
    }
    // 行内元素：其文本并入当前块级组，从而支持跨行内元素匹配。
    for (const child of node.children) {
      visit(child);
    }
  };

  for (const child of parent.children) {
    visit(child);
  }
  flush();
}

/** 创建空文本组。 */
function createTextGroup(): TextGroup {
  return { text: "", entries: [] };
}

/** 重建子节点列表，把命中文本节点替换为普通文本与高亮片段。 */
function rewriteChildren(
  parent: HastParentNode,
  rangesByNode: Map<HastTextNode, TextMatchRange[]>,
  activeIndex: number,
): void {
  const nextChildren: HastNode[] = [];

  for (const child of parent.children) {
    if (isTextNode(child)) {
      const ranges = rangesByNode.get(child);
      if (ranges === undefined || ranges.length === 0) {
        nextChildren.push(child);
        continue;
      }
      nextChildren.push(...splitTextNode(child, ranges, activeIndex));
      continue;
    }
    if (isElementNode(child)) {
      // 行内元素内部可能还有命中文本，继续向下重建。
      rewriteChildren(child, rangesByNode, activeIndex);
    }
    nextChildren.push(child);
  }

  parent.children = nextChildren;
}

/** 按命中区间把一个文本节点切分为若干 text / mark 节点。 */
function splitTextNode(
  node: HastTextNode,
  ranges: TextMatchRange[],
  activeIndex: number,
): HastNode[] {
  const parts: HastNode[] = [];
  let cursor = 0;

  for (const range of ranges) {
    if (range.start > cursor) {
      parts.push({ type: "text", value: node.value.slice(cursor, range.start) });
    }
    if (range.end > range.start) {
      parts.push(createMarkNode(node.value.slice(range.start, range.end), range.matchIndex, activeIndex));
    }
    cursor = Math.max(cursor, range.end);
  }

  if (cursor < node.value.length) {
    parts.push({ type: "text", value: node.value.slice(cursor) });
  }
  return parts;
}

/** 创建高亮片段，当前命中额外追加强调类名。 */
function createMarkNode(value: string, matchIndex: number, activeIndex: number): HastElementNode {
  const className = ["markdown-search-hit"];
  if (matchIndex === activeIndex) {
    className.push("markdown-search-hit--active");
  }
  return {
    type: "element",
    tagName: "mark",
    // hast 的 data 属性写法：dataSearchMatchIndex 会渲染为 data-search-match-index。
    properties: { className, dataSearchMatchIndex: matchIndex },
    children: [{ type: "text", value }],
  };
}
