import { ChevronRight, FileText, Folder } from "lucide-react";
import { useEffect } from "react";
import type { SpecTreeNodeApi } from "../../shared/api";
import type { ProjectDocumentResponse } from "../../shared/api";
import type { AsyncState } from "../hooks/useProjectConsole";
import { DocumentViewer } from "./DocumentViewer";

interface SpecBrowserProps {
  tree: SpecTreeNodeApi[];
  selectedPath: string | null;
  document: AsyncState<ProjectDocumentResponse>;
  onSelectPath: (sourcePath: string) => void;
  onOpenSource: (sourcePath: string) => void;
}

/** 展示 Spec 目录树和按需读取的 Markdown 正文。 */
export function SpecBrowser({
  tree,
  selectedPath,
  document,
  onSelectPath,
  onOpenSource,
}: SpecBrowserProps) {
  useEffect(() => {
    if (selectedPath === null) {
      const firstFile = findFirstFile(tree);
      if (firstFile !== null) {
        onSelectPath(firstFile);
      }
    }
  }, [onSelectPath, selectedPath, tree]);

  return (
    <section className="split-browser" aria-label="Spec 浏览器">
      <aside className="resource-list-panel">
        <header>
          <span className="eyebrow">SPEC TREE</span>
          <h2>规范目录</h2>
        </header>
        {tree.length === 0 ? (
          <p className="empty-copy">快照中没有 Markdown Spec。</p>
        ) : (
          <div className="tree-root">
            {tree.map((node) => (
              <SpecNode key={node.relativePath} node={node} selectedPath={selectedPath} onSelect={onSelectPath} />
            ))}
          </div>
        )}
      </aside>
      <DocumentViewer document={document} emptyMessage="选择一个 Spec 文件开始阅读" onOpenSource={onOpenSource} />
    </section>
  );
}

interface SpecNodeProps {
  node: SpecTreeNodeApi;
  selectedPath: string | null;
  onSelect: (sourcePath: string) => void;
}

/** 递归展示一个 Spec 目录或文件节点。 */
function SpecNode({ node, selectedPath, onSelect }: SpecNodeProps) {
  if (node.kind === "file") {
    return (
      <button
        className={`tree-file ${selectedPath === node.relativePath ? "tree-file--active" : ""}`}
        type="button"
        onClick={() => onSelect(node.relativePath)}
      >
        <FileText size={15} aria-hidden="true" />
        <span>{node.name}</span>
      </button>
    );
  }

  return (
    <details className="tree-directory" open>
      <summary>
        <ChevronRight size={14} aria-hidden="true" />
        <Folder size={15} aria-hidden="true" />
        <span>{node.name}</span>
      </summary>
      <div>
        {node.children.map((child) => (
          <SpecNode key={child.relativePath} node={child} selectedPath={selectedPath} onSelect={onSelect} />
        ))}
      </div>
    </details>
  );
}

/** 深度优先查找第一个可阅读 Spec 文件。 */
function findFirstFile(nodes: SpecTreeNodeApi[]): string | null {
  for (const node of nodes) {
    if (node.kind === "file") {
      return node.relativePath;
    }
    const childFile = findFirstFile(node.children);
    if (childFile !== null) {
      return childFile;
    }
  }
  return null;
}
