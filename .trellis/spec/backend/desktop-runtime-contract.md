# 桌面运行时可执行合同

## 范围

修改 Tauri Builder、插件、窗口、单实例、系统对话框、外部打开、清理或退出时必须遵守本合同。

## 合同

- single-instance 插件最先注册；二次启动只显示并聚焦 `main` 窗口。
- 产品名为 `Trellis Visual Console`，bundle identifier 为 `com.wanglinqiao.trellis-visual-console`。
- macOS 最低版本为 13；Windows 使用当前用户 NSIS 和 WebView2 在线引导。
- 前端 capability 不获得任意文件系统或任意 opener 权限。
- 目录选择由 Rust 侧 Dialog API 执行；同一时间只允许一个活动对话框，取消是正常响应。
- 外部打开只接受 Core 已验证的项目根、`.trellis` 内源路径或固定日志目录。
- 初始化存储失败时窗口仍可显示；业务 Command 返回稳定初始化错误，不能覆盖原数据。
- 关闭主窗口先拒绝新 Core 任务、等待队列并关闭 watcher/线程，再退出进程。
- `clear_application_data_and_exit` 只在 `confirmed=true` 时执行，先关闭 Core，再删除固定应用数据目录并退出。
- Windows 卸载器默认保留应用数据，用户明确选择后才删除 `%APPDATA%\Trellis Visual Console`。
- 生产运行不得启动 Node、HTTP 端口、浏览器、sidecar、托盘或第二窗口。
- 在线更新是唯一受控联网例外：只允许 Rust updater 访问配置的 HTTPS 清单和清单选中的 HTTPS 更新包；前端不获得网络或 updater capability。

## 验证

- 二次启动只有一个应用进程和一套 watcher。
- 原生目录面板可打开并取消。
- 受控项目路径和日志目录可打开，越界路径被拒绝。
- 隔离数据目录清理后应用退出，已登记源项目字节不变。
- 关闭窗口后 1 秒内进程退出。
