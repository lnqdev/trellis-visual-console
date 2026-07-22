# 桌面运行时可执行合同

## 范围

修改 Tauri Builder、桌面打包与安装、插件、窗口、单实例、系统对话框、外部打开、清理或退出时必须遵守本合同。

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

## 场景：macOS DMG 安装与挂载清理

### 1. 范围与触发条件

- 任何包含 macOS DMG 构建、挂载、首次安装、覆盖安装或原生验收的任务都必须执行本场景。
- 规划任务时，`prd.md` 的验收标准必须显式包含“唯一安装副本”和“验收后清理”两项；只写在 `design.md` 或 `implement.md` 中不算满足。

### 2. 产物与安装标识

- 产品名固定为 `Trellis Visual Console`，bundle identifier 固定为 `com.wanglinqiao.trellis-visual-console`。
- 每次验收必须先声明唯一目标安装路径，例如 `/Applications/Trellis Visual Console.app`；不得同时把 `/Applications` 与用户级 `Applications` 都视为正式安装位置。
- DMG、挂载卷中的 `.app`、`target/**/bundle/macos/*.app` 都是构建或测试副本，不等于已经完成目标目录安装。
- macOS 允许相同 bundle identifier 的应用存在于不同目录；覆盖一个目录不会自动清理其他目录中的同名应用。

### 3. 验收与清理合同

- 安装前枚举所有同 bundle identifier 的 `.app`，记录路径、版本、可执行文件 SHA-256，并区分既有用户副本与本轮测试副本。
- 首次安装或覆盖安装后，目标目录中的 bundle identifier、版本、架构和可执行文件 SHA-256 必须与本轮 DMG 内应用一致。
- 完成功能测试后立即退出测试进程、卸载本轮挂载的 DMG，并清理本轮创建的非目标 `.app`；交付用 DMG 可以保留。
- 既有用户副本不属于本轮测试产物时，删除前必须取得用户明确授权；获得授权后优先移入废纸篓，保留可恢复性。
- 清理后再次枚举应用和挂载卷：系统只能发现声明的目标安装副本，不得残留用户级副本、调试 bundle 或挂载卷副本。
- 验收报告必须记录目标安装路径、清理的副本、卸载的卷以及最终枚举结果，不能只记录“DMG 构建成功”。

后续桌面交付任务的 `prd.md` 至少包含以下验收项：

```markdown
- [ ] **AC（macOS 安装与清理）**：应用在已声明的唯一目标目录完成首次或覆盖安装，安装内容与本轮 DMG 一致；验收结束后已退出测试进程、卸载 DMG、清理本轮产生的额外应用副本，最终系统只发现目标目录中的最新安装。
```

### 4. 验证与异常矩阵

| 条件 | 结果与处理 |
| --- | --- |
| 目标目录只有一个副本，哈希与 DMG 一致，挂载卷已卸载 | 通过 |
| `/Applications`、用户级 `Applications` 或构建目录仍有第二个可发现副本 | 不通过；清理后重新枚举 |
| DMG 仍挂载或应用仍直接从挂载卷运行 | 不通过；退出进程并卸载卷 |
| 发现本轮测试前已经存在的额外用户副本 | 暂停删除并请求用户授权；不得静默移除 |
| 只验证 DMG 文件存在，未验证目标目录安装内容 | 不通过；补做安装内容与哈希核对 |

### 5. Good / Base / Bad Cases

- Good：覆盖唯一目标路径，核对版本、架构和哈希，测试后卸载 DMG 并清理所有本轮额外副本，最终枚举只有目标应用。
- Base：只挂载 DMG 检查内容而不安装；检查后卸载卷，安装目录和系统应用枚举均保持原状。
- Bad：构建完成后把挂载卷或 `target/debug` 中的 `.app` 当作已安装应用，结束任务时仍留下多个同名副本。

### 6. 必需验证与断言点

- 使用 `hdiutil verify <dmg>` 验证镜像可读，并在挂载后核对 `Info.plist` 与可执行文件架构。
- 对 DMG 内应用和目标安装应用计算 SHA-256，断言二者一致。
- 清理后通过 bundle identifier 枚举应用，断言结果数量为 1 且路径等于规划中声明的目标安装路径。
- 检查 `/Volumes`，断言本轮 DMG 卷不存在；检查进程列表，断言没有从挂载卷或非目标副本运行的进程。
- 检查 Git 状态，断言验收清理没有修改源项目文件。

### 7. Wrong vs Correct

#### Wrong

```text
DMG 生成成功 -> 打开并运行 -> 任务完成
```

该流程没有区分挂载运行与正式安装，也没有处理跨目录重复副本。

#### Correct

```text
记录既有副本 -> 挂载并核对 DMG -> 安装到唯一目标路径 -> 验证覆盖与功能
-> 退出应用 -> 卸载 DMG -> 经授权清理额外副本 -> 再次枚举并记录结果
```
