import { Download, RefreshCw, RotateCcw, ShieldCheck, X } from "lucide-react";
import { useEffect, useRef } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { ApplicationUpdaterController } from "../hooks/useApplicationUpdater";
import { formatDateTime } from "../formatters";

interface ApplicationUpdateProps {
  updater: ApplicationUpdaterController;
}

/** 在工作区顶部非阻断提示可用更新或待重启状态。 */
export function ApplicationUpdateNotice({ updater }: ApplicationUpdateProps) {
  const { state } = updater;
  if (state.phase !== "available" && state.phase !== "installed") {
    return null;
  }
  return (
    <div className="update-notice" aria-live="polite">
      <div>
        {state.phase === "available" ? <Download size={18} aria-hidden="true" /> : <RotateCcw size={18} aria-hidden="true" />}
        <span>
          <strong>{state.phase === "available" ? `发现 ${state.update?.version ?? "新版本"}` : "更新已安装"}</strong>
          <small>{state.phase === "available" ? "查看更新说明后决定是否安装" : "重启应用后使用新版本"}</small>
        </span>
      </div>
      <button className="secondary-button" type="button" onClick={updater.openDialog}>
        {state.phase === "available" ? "查看更新" : "立即重启"}
      </button>
    </div>
  );
}

/** 在诊断页展示应用版本、内测边界和更新检查入口。 */
export function ApplicationUpdatePanel({ updater }: ApplicationUpdateProps) {
  const { state } = updater;
  return (
    <section className="application-update-panel" aria-labelledby="application-update-title">
      <div className="application-update-heading">
        <span className="application-update-icon"><ShieldCheck size={19} aria-hidden="true" /></span>
        <div>
          <h2 id="application-update-title">应用更新</h2>
          <p>{describeUpdateState(state.phase, state.error)}</p>
        </div>
      </div>
      <dl className="application-update-meta">
        <div><dt>当前版本</dt><dd><code>{state.currentVersion ?? "读取中"}</code></dd></div>
        <div><dt>发布通道</dt><dd><span className="beta-badge">免费内测</span></dd></div>
      </dl>
      <div className="application-update-actions">
        {state.phase === "available" || state.phase === "installed" ? (
          <button className="primary-button" type="button" onClick={updater.openDialog}>
            {state.phase === "available" ? <Download size={15} aria-hidden="true" /> : <RotateCcw size={15} aria-hidden="true" />}
            {state.phase === "available" ? "查看更新" : "立即重启"}
          </button>
        ) : null}
        <button
          className="secondary-button"
          type="button"
          disabled={state.phase === "checking" || state.phase === "downloading"}
          onClick={() => void updater.check("manual")}
        >
          <RefreshCw className={state.phase === "checking" ? "spin" : undefined} size={15} aria-hidden="true" />
          {state.phase === "checking" ? "正在检查" : "检查更新"}
        </button>
      </div>
    </section>
  );
}

/** 展示更新说明、下载进度和 macOS 重启选择。 */
export function ApplicationUpdateDialog({ updater }: ApplicationUpdateProps) {
  const { state, closeDialog } = updater;
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const dialogRef = useRef<HTMLElement>(null);
  const busy = state.phase === "downloading";
  const busyRef = useRef(busy);
  busyRef.current = busy;

  useEffect(() => {
    if (!state.dialogOpen) {
      return undefined;
    }
    const previouslyFocused = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    closeButtonRef.current?.focus();
    /** 允许非下载阶段通过 Escape 安全关闭弹窗。 */
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busyRef.current) {
        closeDialog();
      }
    };
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      previouslyFocused?.focus();
    };
  }, [closeDialog, state.dialogOpen]);

  useEffect(() => {
    if (busy) {
      dialogRef.current?.focus();
    }
  }, [busy]);

  if (!state.dialogOpen) {
    return null;
  }
  const progress = calculateProgress(state.downloaded, state.contentLength);
  return (
    <div className="update-dialog-backdrop" role="presentation">
      <section
        className="update-dialog"
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="update-dialog-title"
        tabIndex={-1}
      >
        <header>
          <div>
            <span>应用在线更新</span>
            <h2 id="update-dialog-title">{dialogTitle(state.phase, state.update?.version)}</h2>
          </div>
          <button
            className="icon-only-button"
            ref={closeButtonRef}
            type="button"
            disabled={busy}
            onClick={updater.closeDialog}
            aria-label="关闭更新窗口"
            title="关闭"
          >
            <X size={17} aria-hidden="true" />
          </button>
        </header>

        {state.update !== null ? (
          <div className="update-release-notes">
            <strong>更新说明 · 发布于 {formatDateTime(state.update.publishedAt)}</strong>
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
                {state.update.notes}
              </ReactMarkdown>
            </div>
          </div>
        ) : null}

        {state.phase === "downloading" ? (
          <div className="update-progress" aria-live="polite">
            <div><span>{state.downloadFinished ? "下载完成，正在安装" : "正在下载并验证更新包"}</span><strong>{progress === null ? formatBytes(state.downloaded) : `${progress}%`}</strong></div>
            <progress max={state.contentLength ?? undefined} value={state.contentLength === null ? undefined : state.downloaded} />
          </div>
        ) : null}

        {state.error !== null ? <div className="update-dialog-error" role="alert">{state.error}</div> : null}

        {state.phase === "available" && state.platform === "windows" ? (
          <p className="update-platform-note">确认安装后应用将关闭，并由 Windows 安装器完成更新。未签名内测包可能显示 SmartScreen 提示。</p>
        ) : state.phase === "available" && state.platform === "macos" ? (
          <p className="update-platform-note">更新包将先验证 Tauri 签名。当前为未公证内测版，系统仍可能显示 Gatekeeper 提示。</p>
        ) : null}

        <footer>
          {state.phase === "available" ? (
            <>
              <button className="secondary-button" type="button" onClick={updater.closeDialog}>暂不更新</button>
              <button className="primary-button" type="button" onClick={() => void updater.install()}><Download size={15} aria-hidden="true" />下载并安装</button>
            </>
          ) : state.phase === "installed" ? (
            <>
              <button className="secondary-button" type="button" onClick={updater.closeDialog}>稍后重启</button>
              <button className="primary-button" type="button" onClick={() => void updater.restart()}><RotateCcw size={15} aria-hidden="true" />立即重启</button>
            </>
          ) : state.phase === "error" ? (
            <>
              <button className="secondary-button" type="button" onClick={updater.closeDialog}>关闭</button>
              <button className="primary-button" type="button" onClick={() => void updater.check("manual")}><RefreshCw size={15} aria-hidden="true" />重新检查</button>
            </>
          ) : null}
        </footer>
      </section>
    </div>
  );
}

/** 返回诊断页的简短更新状态。 */
function describeUpdateState(phase: string, error: string | null): string {
  if (error !== null) {
    return error;
  }
  switch (phase) {
    case "checking": return "正在从 Gitee 检查最新内测版本";
    case "upToDate": return "当前已是最新内测版本";
    case "available": return "发现新版本，安装前可查看中文更新说明";
    case "downloading": return "正在下载、验签并安装更新";
    case "installed": return "更新已安装，重启后生效";
    case "skipped": return "24 小时内已自动检查，可随时手动检查";
    default: return "启动后每 24 小时最多自动检查一次，不会静默下载";
  }
}

/** 返回更新弹窗标题。 */
function dialogTitle(phase: string, version: string | undefined): string {
  if (phase === "installed") {
    return "更新已安装";
  }
  if (phase === "downloading") {
    return `正在安装 ${version ?? "新版本"}`;
  }
  if (phase === "error") {
    return "更新未完成";
  }
  return `发现 ${version ?? "新版本"}`;
}

/** 计算已知总大小时的整数下载百分比。 */
function calculateProgress(downloaded: number, contentLength: number | null): number | null {
  if (contentLength === null || contentLength === 0) {
    return null;
  }
  return Math.min(100, Math.round((downloaded / contentLength) * 100));
}

/** 将下载字节数格式化为紧凑文本。 */
function formatBytes(bytes: number): string {
  if (bytes < 1024 * 1024) {
    return `${Math.round(bytes / 1024)} KiB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MiB`;
}
