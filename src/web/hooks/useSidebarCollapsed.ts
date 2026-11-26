/**
 * @author wanglinqiao
 * Date 2026/11/26
 * Time 10:52
 */
import { useCallback, useEffect, useState } from "react";

const STORAGE_KEY = "trellis-console:sidebar-collapsed";

/** 从 localStorage 读取初始折叠状态，读取失败时默认展开。 */
function readInitialCollapsed(): boolean {
  if (typeof window === "undefined") {
    return false;
  }
  try {
    return window.localStorage.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

/**
 * 管理左侧项目导航侧边栏的折叠状态。
 * 折叠状态持久化到 localStorage，并支持 Cmd/Ctrl + B 快捷键切换。
 */
export function useSidebarCollapsed() {
  const [collapsed, setCollapsed] = useState(readInitialCollapsed);

  // 状态变化时写入本地存储；隐私模式等存储不可用的情况静默忽略
  useEffect(() => {
    try {
      window.localStorage.setItem(STORAGE_KEY, collapsed ? "1" : "0");
    } catch {
      // 存储不可用不影响折叠功能本身
    }
  }, [collapsed]);

  const toggle = useCallback(() => setCollapsed((previous) => !previous), []);

  // 全局快捷键：macOS 为 Cmd + B，其他平台为 Ctrl + B
  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.repeat) {
        return;
      }
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "b") {
        return;
      }
      event.preventDefault();
      setCollapsed((previous) => !previous);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, []);

  return { collapsed, toggle };
}
