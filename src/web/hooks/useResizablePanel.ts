/**
 * @author wanglinqiao
 * Date 2026/11/26
 * Time 10:20
 */
import { useCallback, useEffect, useRef, useState } from "react";
import type { KeyboardEvent as ReactKeyboardEvent, PointerEvent as ReactPointerEvent } from "react";

interface UseResizablePanelOptions {
  /** localStorage 中的持久化键 */
  storageKey: string;
  /** 首次使用时的默认宽度 */
  defaultWidth: number;
  /** 允许的最小宽度 */
  minWidth: number;
  /** 允许的最大宽度 */
  maxWidth: number;
  /** 分隔线的无障碍名称 */
  ariaLabel: string;
}

/** 把宽度限制在允许区间内。 */
function clampWidth(value: number, minWidth: number, maxWidth: number): number {
  return Math.min(Math.max(value, minWidth), maxWidth);
}

/** 从 localStorage 读取已保存的宽度，非法或不可用时回退到默认值。 */
function readStoredWidth(
  storageKey: string,
  defaultWidth: number,
  minWidth: number,
  maxWidth: number,
): number {
  if (typeof window === "undefined") {
    return clampWidth(defaultWidth, minWidth, maxWidth);
  }
  try {
    const stored = Number(window.localStorage.getItem(storageKey));
    if (Number.isFinite(stored) && stored > 0) {
      return clampWidth(stored, minWidth, maxWidth);
    }
  } catch {
    // 隐私模式等存储不可用时直接使用默认宽度
  }
  return clampWidth(defaultWidth, minWidth, maxWidth);
}

/**
 * 管理左侧面板宽度：支持拖动分隔线调整、键盘微调，并持久化到 localStorage。
 * 返回的 separatorProps 直接展开到分隔线元素上即可获得完整交互。
 */
export function useResizablePanel({
  storageKey,
  defaultWidth,
  minWidth,
  maxWidth,
  ariaLabel,
}: UseResizablePanelOptions) {
  const [width, setWidth] = useState(() =>
    readStoredWidth(storageKey, defaultWidth, minWidth, maxWidth),
  );
  const [resizing, setResizing] = useState(false);
  // 拖动过程中使用 ref 记录起始状态，避免 pointermove 读到过期的 state
  const resizingRef = useRef(false);
  const startXRef = useRef(0);
  const startWidthRef = useRef(0);

  // 宽度变化时写入本地存储；拖动过程中跳过落盘，松手后再写入，避免高频同步写入拖慢拖动
  useEffect(() => {
    if (resizing) {
      return;
    }
    try {
      window.localStorage.setItem(storageKey, String(Math.round(width)));
    } catch {
      // 存储不可用不影响拖动本身
    }
  }, [storageKey, width, resizing]);

  // 拖动期间禁止选中文本，并统一显示左右调整光标
  useEffect(() => {
    if (!resizing) {
      return;
    }
    document.body.classList.add("is-resizing-panel");
    return () => document.body.classList.remove("is-resizing-panel");
  }, [resizing]);

  const handlePointerDown = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (event.button !== 0) {
        return;
      }
      event.preventDefault();
      // preventDefault 会阻止元素自动获得焦点，这里手动聚焦，保证拖动后可直接用方向键微调
      event.currentTarget.focus({ preventScroll: true });
      startXRef.current = event.clientX;
      startWidthRef.current = width;
      resizingRef.current = true;
      setResizing(true);
      // 捕获指针，保证快速拖动时移出分隔线也不会丢失事件
      event.currentTarget.setPointerCapture(event.pointerId);
    },
    [width],
  );

  const handlePointerMove = useCallback(
    (event: ReactPointerEvent<HTMLDivElement>) => {
      if (!resizingRef.current) {
        return;
      }
      const nextWidth = startWidthRef.current + (event.clientX - startXRef.current);
      setWidth(clampWidth(nextWidth, minWidth, maxWidth));
    },
    [minWidth, maxWidth],
  );

  const stopResizing = useCallback((event: ReactPointerEvent<HTMLDivElement>) => {
    if (!resizingRef.current) {
      return;
    }
    resizingRef.current = false;
    setResizing(false);
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
  }, []);

  // 键盘可达性：左右方向键微调，按住 Shift 时步长更大
  const handleKeyDown = useCallback(
    (event: ReactKeyboardEvent<HTMLDivElement>) => {
      if (event.key !== "ArrowLeft" && event.key !== "ArrowRight") {
        return;
      }
      event.preventDefault();
      const step = event.shiftKey ? 48 : 16;
      const delta = event.key === "ArrowRight" ? step : -step;
      setWidth((current) => clampWidth(current + delta, minWidth, maxWidth));
    },
    [minWidth, maxWidth],
  );

  const separatorProps = {
    role: "separator" as const,
    "aria-orientation": "vertical" as const,
    "aria-label": ariaLabel,
    "aria-valuemin": minWidth,
    "aria-valuemax": maxWidth,
    "aria-valuenow": Math.round(width),
    tabIndex: 0,
    className: `panel-resize-handle${resizing ? " panel-resize-handle--active" : ""}`,
    onPointerDown: handlePointerDown,
    onPointerMove: handlePointerMove,
    onPointerUp: stopResizing,
    onPointerCancel: stopResizing,
    // 指针捕获被系统收回时也要复位，避免拖动状态与全局光标残留
    onLostPointerCapture: stopResizing,
    onKeyDown: handleKeyDown,
  };

  return { width, resizing, separatorProps };
}
