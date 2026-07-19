import { execFile, type ChildProcess } from "node:child_process";
import type { DirectoryPickerResponse } from "../../shared/api.js";

const WINDOWS_PICKER_SCRIPT = `
$ErrorActionPreference = 'Stop'
[Console]::OutputEncoding = [System.Text.UTF8Encoding]::new($false)
Add-Type -AssemblyName System.Windows.Forms
$dialog = New-Object System.Windows.Forms.FolderBrowserDialog
$dialog.Description = '选择目录'
$dialog.ShowNewFolderButton = $true
try {
  $result = $dialog.ShowDialog()
  if ($result -eq [System.Windows.Forms.DialogResult]::OK) {
    [Console]::Write($dialog.SelectedPath)
  }
} finally {
  $dialog.Dispose()
}
`;

const MACOS_PICKER_SCRIPT = `
try
  set selectedFolder to choose folder with prompt "选择目录"
  return POSIX path of selectedFolder
on error number -128
  return ""
end try
`;

/** 已有系统目录选择对话框正在运行。 */
export class DirectoryPickerBusyError extends Error {
  /** 创建目录选择器忙碌错误。 */
  constructor() {
    super("已有目录选择窗口正在等待操作");
    this.name = "DirectoryPickerBusyError";
  }
}

/** 当前操作系统不支持原生目录选择。 */
export class DirectoryPickerUnsupportedError extends Error {
  /** 创建平台不支持错误。 */
  constructor() {
    super("当前操作系统暂不支持目录选择，请手工输入路径");
    this.name = "DirectoryPickerUnsupportedError";
  }
}

/** 系统目录选择能力无法启动或异常退出。 */
export class DirectoryPickerUnavailableError extends Error {
  /** 创建目录选择能力不可用错误。 */
  constructor(public readonly reasonName: string) {
    super("系统目录选择器启动失败，请手工输入路径");
    this.name = "DirectoryPickerUnavailableError";
  }
}

/** 调用操作系统原生目录选择对话框。 */
export class DirectoryPicker {
  private active = false;
  private activeProcess: ChildProcess | null = null;

  /** 打开当前平台的目录选择对话框并返回选择结果。 */
  async selectDirectory(): Promise<DirectoryPickerResponse> {
    if (this.active) {
      throw new DirectoryPickerBusyError();
    }

    this.active = true;
    try {
      switch (process.platform) {
        case "win32":
          return createPickerResponse(
            await this.runCommand(
              "powershell.exe",
              ["-NoProfile", "-NonInteractive", "-STA", "-Command", WINDOWS_PICKER_SCRIPT],
              true,
            ),
          );
        case "darwin":
          return createPickerResponse(
            await this.runCommand("osascript", ["-e", MACOS_PICKER_SCRIPT]),
          );
        default:
          throw new DirectoryPickerUnsupportedError();
      }
    } catch (error) {
      if (
        error instanceof DirectoryPickerBusyError ||
        error instanceof DirectoryPickerUnsupportedError ||
        error instanceof DirectoryPickerUnavailableError
      ) {
        throw error;
      }
      throw new DirectoryPickerUnavailableError(getErrorName(error));
    } finally {
      this.active = false;
    }
  }

  /** 终止仍在等待用户操作的原生目录选择进程。 */
  close(): void {
    const process = this.activeProcess;
    this.activeProcess = null;
    process?.kill();
  }

  /** 使用 UTF-8 执行系统命令并跟踪活动子进程。 */
  private runCommand(command: string, args: string[], windowsHide = false): Promise<string> {
    return new Promise((resolve, reject) => {
      const process = execFile(
        command,
        args,
        { encoding: "utf8", windowsHide },
        (error, stdout) => {
          if (this.activeProcess === process) {
            this.activeProcess = null;
          }
          if (error !== null) {
            reject(error);
            return;
          }
          resolve(stdout);
        },
      );
      this.activeProcess = process;
    });
  }
}

/** 将系统命令输出转换为稳定的目录选择结果。 */
function createPickerResponse(stdout: string): DirectoryPickerResponse {
  const path = stdout.trim();
  return path === "" ? { status: "cancelled" } : { status: "selected", path };
}

/** 提取不包含命令参数和本机路径的错误类型。 */
function getErrorName(error: unknown): string {
  return error instanceof Error ? error.name : "UnknownError";
}
