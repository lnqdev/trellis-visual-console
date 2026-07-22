import { useCallback, useEffect, useRef, useState } from "react";
import type {
  ApplicationPlatform,
  ApplicationUpdateMetadata,
  UpdateCheckMode,
  UpdateDownloadProgress,
} from "../../shared/api";
import {
  checkForApplicationUpdate,
  installApplicationUpdate,
  restartApplication,
} from "../api-client";

/** 应用在线更新阶段。 */
export type ApplicationUpdatePhase =
  | "idle"
  | "checking"
  | "skipped"
  | "upToDate"
  | "available"
  | "downloading"
  | "installed"
  | "error";

/** 应用在线更新界面状态。 */
export interface ApplicationUpdaterState {
  phase: ApplicationUpdatePhase;
  currentVersion: string | null;
  platform: ApplicationPlatform | null;
  update: ApplicationUpdateMetadata | null;
  downloaded: number;
  contentLength: number | null;
  downloadFinished: boolean;
  error: string | null;
  dialogOpen: boolean;
}

/** 应用在线更新控制器。 */
export interface ApplicationUpdaterController {
  state: ApplicationUpdaterState;
  check: (mode?: UpdateCheckMode) => Promise<void>;
  install: () => Promise<void>;
  restart: () => Promise<void>;
  openDialog: () => void;
  closeDialog: () => void;
}

const INITIAL_STATE: ApplicationUpdaterState = {
  phase: "idle",
  currentVersion: __APP_VERSION__,
  platform: null,
  update: null,
  downloaded: 0,
  contentLength: null,
  downloadFinished: false,
  error: null,
  dialogOpen: false,
};

/** 管理自动检查、用户确认、下载进度和更新后重启。 */
export function useApplicationUpdater(): ApplicationUpdaterController {
  const mountedRef = useRef(true);
  const automaticCheckStartedRef = useRef(false);
  const operationActiveRef = useRef(false);
  const [state, setState] = useState<ApplicationUpdaterState>(INITIAL_STATE);

  /** 检查更新，并按触发方式控制是否打开确认界面。 */
  const check = useCallback(async (mode: UpdateCheckMode = "manual") => {
    if (operationActiveRef.current) {
      return;
    }
    operationActiveRef.current = true;
    setState((current) => ({
      ...current,
      phase: "checking",
      error: null,
      dialogOpen: mode === "manual" ? current.dialogOpen : false,
    }));
    try {
      const response = await checkForApplicationUpdate(mode);
      if (!mountedRef.current) {
        return;
      }
      if (response.status === "available") {
        setState((current) => ({
          ...current,
          phase: "available",
          currentVersion: response.update.currentVersion,
          platform: response.update.platform,
          update: response.update,
          downloaded: 0,
          contentLength: null,
          downloadFinished: false,
          error: null,
          dialogOpen: mode === "manual",
        }));
        return;
      }
      setState((current) => ({
        ...current,
        phase: response.status,
        currentVersion: response.currentVersion,
        platform: response.platform,
        update: null,
        downloaded: 0,
        contentLength: null,
        downloadFinished: false,
        error: null,
        dialogOpen: false,
      }));
    } catch (error) {
      if (mountedRef.current) {
        setState((current) => ({
          ...current,
          phase: "error",
          error: getErrorMessage(error),
          dialogOpen: mode === "manual",
        }));
      }
    } finally {
      operationActiveRef.current = false;
    }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    if (!automaticCheckStartedRef.current) {
      automaticCheckStartedRef.current = true;
      void check("automatic");
    }
    return () => {
      mountedRef.current = false;
    };
  }, [check]);

  /** 下载、验签并安装当前待更新版本。 */
  const install = useCallback(async () => {
    if (operationActiveRef.current) {
      return;
    }
    operationActiveRef.current = true;
    setState((current) => ({
      ...current,
      phase: "downloading",
      downloaded: 0,
      contentLength: null,
      downloadFinished: false,
      error: null,
      dialogOpen: true,
    }));
    try {
      const response = await installApplicationUpdate((progress) => {
        if (mountedRef.current) {
          setState((current) => applyProgress(current, progress));
        }
      });
      if (mountedRef.current) {
        setState((current) => ({
          ...current,
          phase: "installed",
          downloadFinished: true,
          error: null,
          dialogOpen: response.restartRequired,
        }));
      }
    } catch (error) {
      if (mountedRef.current) {
        setState((current) => ({
          ...current,
          phase: "error",
          error: getErrorMessage(error),
          dialogOpen: true,
        }));
      }
    } finally {
      operationActiveRef.current = false;
    }
  }, []);

  /** 请求桌面进程完成受控重启。 */
  const restart = useCallback(async () => {
    try {
      await restartApplication();
    } catch (error) {
      if (mountedRef.current) {
        setState((current) => ({
          ...current,
          phase: "error",
          error: getErrorMessage(error),
          dialogOpen: true,
        }));
      }
    }
  }, []);

  /** 打开当前更新状态对应的弹窗。 */
  const openDialog = useCallback(() => {
    setState((current) => ({ ...current, dialogOpen: true }));
  }, []);

  /** 关闭更新弹窗，但保留已下载或待重启状态。 */
  const closeDialog = useCallback(() => {
    setState((current) => ({ ...current, dialogOpen: false }));
  }, []);

  return {
    state,
    check,
    install,
    restart,
    openDialog,
    closeDialog,
  };
}

/** 将单条下载进度事件合并到界面状态。 */
function applyProgress(
  state: ApplicationUpdaterState,
  progress: UpdateDownloadProgress,
): ApplicationUpdaterState {
  switch (progress.event) {
    case "started":
      return { ...state, contentLength: progress.contentLength, downloadFinished: false };
    case "progress":
      return {
        ...state,
        downloaded: progress.downloaded,
        contentLength: progress.contentLength,
      };
    case "downloadFinished":
      return { ...state, downloadFinished: true };
  }
}

/** 提取用户可见的稳定中文错误消息。 */
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "更新操作失败，请重试";
}
