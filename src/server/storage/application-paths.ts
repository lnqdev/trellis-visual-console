import { homedir } from "node:os";
import { isAbsolute, join, resolve } from "node:path";

const APPLICATION_DIRECTORY_NAME = "Trellis Visual Console";
const LINUX_APPLICATION_DIRECTORY_NAME = "trellis-visual-console";
const DATA_DIRECTORY_ENV_NAME = "TRELLIS_VISUAL_CONSOLE_DATA_DIR";

/** 应用持久化文件的绝对路径集合。 */
export interface ApplicationPaths {
  dataDirectory: string;
  registryFile: string;
  snapshotsFile: string;
}

/**
 * 解析当前平台的应用数据目录和固定数据文件路径。
 *
 * @param dataDirectoryOverride 可选的应用数据目录覆盖值
 * @returns 注册表和快照文件的绝对路径
 */
export function resolveApplicationPaths(dataDirectoryOverride?: string): ApplicationPaths {
  const configuredDirectory = dataDirectoryOverride ?? process.env[DATA_DIRECTORY_ENV_NAME];
  const dataDirectory = configuredDirectory?.trim()
    ? resolveConfiguredDirectory(configuredDirectory.trim())
    : resolveDefaultDataDirectory();

  return {
    dataDirectory,
    registryFile: join(dataDirectory, "registry.json"),
    snapshotsFile: join(dataDirectory, "snapshots.json"),
  };
}

/** 将用户配置的目录统一转换为绝对路径。 */
function resolveConfiguredDirectory(configuredDirectory: string): string {
  return isAbsolute(configuredDirectory) ? configuredDirectory : resolve(configuredDirectory);
}

/** 根据操作系统约定解析默认应用数据目录。 */
function resolveDefaultDataDirectory(): string {
  switch (process.platform) {
    case "darwin":
      return join(homedir(), "Library", "Application Support", APPLICATION_DIRECTORY_NAME);
    case "win32": {
      const roamingDirectory = process.env.APPDATA?.trim()
        ? process.env.APPDATA.trim()
        : join(homedir(), "AppData", "Roaming");
      return join(roamingDirectory, APPLICATION_DIRECTORY_NAME);
    }
    default: {
      const configDirectory = process.env.XDG_CONFIG_HOME?.trim()
        ? process.env.XDG_CONFIG_HOME.trim()
        : join(homedir(), ".config");
      return join(configDirectory, LINUX_APPLICATION_DIRECTORY_NAME);
    }
  }
}
