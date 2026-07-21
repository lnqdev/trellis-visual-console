import {
  Check,
  FolderOpen,
  FolderSearch,
  LoaderCircle,
  Plus,
  ScanSearch,
  X,
} from "lucide-react";
import { useState } from "react";
import type {
  DirectoryPickerResponse,
  ProjectRegisterInput,
  ProjectRegisterResponse,
  ProjectScanResponse,
} from "../../shared/api";

interface ProjectDiscoveryProps {
  canClose: boolean;
  busyAction: string | null;
  onScan: (rootPath: string) => Promise<ProjectScanResponse>;
  onSelectDirectory: () => Promise<DirectoryPickerResponse>;
  onRegister: (projects: ProjectRegisterInput[]) => Promise<ProjectRegisterResponse>;
  onClose: () => void;
}

interface DiscoveryNotice {
  tone: "info" | "error";
  message: string;
}

/** 提供快速扫描、候选批量登记和单项目手动添加。 */
export function ProjectDiscovery({
  canClose,
  busyAction,
  onScan,
  onSelectDirectory,
  onRegister,
  onClose,
}: ProjectDiscoveryProps) {
  const [scanRoot, setScanRoot] = useState("");
  const [manualPath, setManualPath] = useState("");
  const [scanResult, setScanResult] = useState<ProjectScanResponse | null>(null);
  const [selectedPaths, setSelectedPaths] = useState<Set<string>>(new Set());
  const [localNotice, setLocalNotice] = useState<DiscoveryNotice | null>(null);
  const [pickingField, setPickingField] = useState<"scan" | "manual" | null>(null);

  /** 更新项目发现页的局部提示。 */
  function showLocalNotice(message: string, tone: DiscoveryNotice["tone"] = "info"): void {
    setLocalNotice({ tone, message });
  }

  /** 打开系统目录选择器，并处理扫描路径回填或单项目直接登记。 */
  async function handleSelectDirectory(target: "scan" | "manual"): Promise<void> {
    if (pickingField !== null) {
      return;
    }

    setPickingField(target);
    try {
      const result = await onSelectDirectory();
      if (result.status === "cancelled") {
        return;
      }

      if (target === "scan") {
        setScanRoot(result.path);
        showLocalNotice("扫描根目录已选择，可继续扫描");
      } else {
        setManualPath(result.path);
        await registerManualProject(result.path);
      }
    } catch (error) {
      showLocalNotice(
        error instanceof Error ? error.message : "目录选择失败，请手工输入路径",
        "error",
      );
    } finally {
      setPickingField(null);
    }
  }

  /** 校验并登记单个项目路径。 */
  async function registerManualProject(path: string): Promise<void> {
    try {
      const response = await onRegister([{ path }]);
      const result = response.results[0];
      if (result === undefined) {
        showLocalNotice("项目登记未返回结果", "error");
        return;
      }
      if (result.status === "invalid") {
        showLocalNotice(result.diagnostics[0]?.message ?? "项目结构无效", "error");
        return;
      }
      showLocalNotice("项目已登记");
      setManualPath("");
    } catch {
      showLocalNotice("项目登记失败", "error");
    }
  }

  /** 执行快速扫描并默认选中全部候选。 */
  async function handleScan(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (scanRoot.trim() === "") {
      showLocalNotice("请输入本机扫描根路径", "error");
      return;
    }
    try {
      const result = await onScan(scanRoot.trim());
      setScanResult(result);
      setSelectedPaths(new Set(result.candidates.map((candidate) => candidate.project.path)));
      showLocalNotice(
        result.candidates.length === 0 ? "没有发现有效 Trellis 项目" : `发现 ${result.candidates.length} 个候选项目`,
      );
    } catch {
      showLocalNotice("扫描失败，请检查路径和权限", "error");
    }
  }

  /** 登记当前选中的扫描候选。 */
  async function handleRegisterCandidates(): Promise<void> {
    const projects = [...selectedPaths].map((path) => ({ path }));
    if (projects.length === 0) {
      showLocalNotice("请至少选择一个候选项目", "error");
      return;
    }
    try {
      const response = await onRegister(projects);
      const succeeded = response.results.filter((result) => result.status !== "invalid").length;
      showLocalNotice(`已处理 ${response.results.length} 个项目，其中 ${succeeded} 个登记成功`);
    } catch {
      showLocalNotice("候选项目登记失败", "error");
    }
  }

  /** 手动登记用户输入的单项目路径。 */
  async function handleManualAdd(event: React.FormEvent): Promise<void> {
    event.preventDefault();
    if (manualPath.trim() === "") {
      showLocalNotice("请输入项目根路径", "error");
      return;
    }
    await registerManualProject(manualPath.trim());
  }

  /** 切换候选项目选择状态。 */
  function toggleCandidate(path: string): void {
    setSelectedPaths((current) => {
      const next = new Set(current);
      if (next.has(path)) {
        next.delete(path);
      } else {
        next.add(path);
      }
      return next;
    });
  }

  return (
    <section className="discovery-page" aria-labelledby="discovery-title">
      <header className="page-heading">
        <div>
          <span className="eyebrow">PROJECT DISCOVERY</span>
          <h1 id="discovery-title">添加 Trellis 项目</h1>
          <p>可直接输入本机绝对路径，也可使用目录选择按钮。客户端只扫描或登记你明确确认的位置。</p>
        </div>
        {canClose ? (
          <button className="icon-only-button" type="button" onClick={onClose} aria-label="关闭添加项目">
            <X size={18} aria-hidden="true" />
          </button>
        ) : null}
      </header>

      {localNotice !== null ? (
        <div
          className={`inline-notice${localNotice.tone === "error" ? " inline-notice--error" : ""}`}
          role={localNotice.tone === "error" ? "alert" : undefined}
          aria-live={localNotice.tone === "error" ? "assertive" : "polite"}
        >
          {localNotice.message}
        </div>
      ) : null}

      <div className="discovery-grid">
        <article className="panel-card">
          <div className="panel-title">
            <ScanSearch size={19} aria-hidden="true" />
            <div>
              <h2>快速扫描</h2>
              <p>递归查找指定根目录下的有效 `.trellis` 项目，扫描本身不会登记。</p>
            </div>
          </div>
          <form className="path-form" onSubmit={(event) => void handleScan(event)}>
            <label htmlFor="scan-root">扫描根路径</label>
            <div className="input-action-row">
              <div className="path-picker-field">
                <input
                  id="scan-root"
                  value={scanRoot}
                  onChange={(event) => setScanRoot(event.target.value)}
                  placeholder="选择或输入扫描根目录"
                  autoComplete="off"
                />
                <button
                  className="icon-button path-picker-button"
                  type="button"
                  disabled={busyAction !== null || pickingField !== null}
                  aria-label="选择扫描根目录"
                  title="选择扫描根目录"
                  onClick={() => void handleSelectDirectory("scan")}
                >
                  {pickingField === "scan" ? (
                    <LoaderCircle className="spin" size={17} aria-hidden="true" />
                  ) : (
                    <FolderOpen size={17} aria-hidden="true" />
                  )}
                </button>
              </div>
              <button className="primary-button" type="submit" disabled={busyAction !== null}>
                <FolderSearch size={16} aria-hidden="true" />
                扫描
              </button>
            </div>
          </form>

          {scanResult !== null ? (
            <div className="scan-results">
              <header>
                <strong>扫描候选</strong>
                <button
                  className="secondary-button"
                  type="button"
                  disabled={busyAction !== null || selectedPaths.size === 0}
                  onClick={() => void handleRegisterCandidates()}
                >
                  <Check size={15} aria-hidden="true" />
                  登记所选 {selectedPaths.size > 0 ? `(${selectedPaths.size})` : ""}
                </button>
              </header>
              {scanResult.candidates.length === 0 ? (
                <p className="empty-copy">没有候选项目</p>
              ) : (
                scanResult.candidates.map((candidate) => (
                  <label className="candidate-row" key={candidate.project.id}>
                    <input
                      type="checkbox"
                      checked={selectedPaths.has(candidate.project.path)}
                      onChange={() => toggleCandidate(candidate.project.path)}
                    />
                    <span>
                      <strong>{candidate.project.label}</strong>
                      <code>{candidate.project.path}</code>
                    </span>
                    <small>{candidate.snapshot.tasks.active.length} 个活动任务</small>
                  </label>
                ))
              )}
              {scanResult.diagnostics.length > 0 ? (
                <div className="diagnostic-summary">
                  {scanResult.diagnostics.map((diagnostic, index) => (
                    <p key={`${diagnostic.code}-${index}`}>{diagnostic.message}</p>
                  ))}
                </div>
              ) : null}
            </div>
          ) : null}
        </article>

        <article className="panel-card">
          <div className="panel-title">
            <Plus size={19} aria-hidden="true" />
            <div>
              <h2>手动添加</h2>
              <p>已知单个项目路径时直接校验并登记，项目默认进入历史列表。</p>
            </div>
          </div>
          <form className="path-form" onSubmit={(event) => void handleManualAdd(event)}>
            <label htmlFor="manual-project-path">项目根路径</label>
            <div className="path-picker-field">
              <input
                id="manual-project-path"
                value={manualPath}
                onChange={(event) => setManualPath(event.target.value)}
                placeholder="选择或输入 Trellis 项目目录"
                autoComplete="off"
              />
              <button
                className="icon-button path-picker-button"
                type="button"
                disabled={busyAction !== null || pickingField !== null}
                aria-label="选择并添加项目目录"
                title="选择并添加项目目录"
                onClick={() => void handleSelectDirectory("manual")}
              >
                {pickingField === "manual" ? (
                  <LoaderCircle className="spin" size={17} aria-hidden="true" />
                ) : (
                  <FolderOpen size={17} aria-hidden="true" />
                )}
              </button>
            </div>
            <button className="secondary-button" type="submit" disabled={busyAction !== null}>
              <Plus size={16} aria-hidden="true" />
              校验并添加
            </button>
          </form>
        </article>
      </div>
    </section>
  );
}
