# macOS 桌面客户端验收记录

## 范围

本记录覆盖 2026/7/21 在 Apple Silicon macOS 上完成的 Tauri debug/release `.app`、arm64/x64 DMG 与前端 IPC mock 验收。应用数据使用 `/tmp/trellis-desktop-dev-data` 隔离，未读取或删除正式应用数据。迁移前 Web 行为基线保留在[阶段六报告](phase-6-report.md)。

## Playwright IPC mock

| 场景 | 结果 |
| --- | --- |
| 成功响应 Zod 校验 | 通过 |
| 非法成功响应 | 转换为 `invalid-command-response` |
| 结构化 Command 错误 | 保留稳定 code、中文消息和 details |
| 450ms 延迟详情竞态 | 旧项目响应未覆盖当前项目 |
| 单活动事件订阅 | 通过；开发严格模式会执行一次订阅清理复查 |
| 150ms 事件合并 | 三条事件只触发一次列表、详情和任务中心刷新 |
| 2000 条任务 | 首屏 100 行，约 383ms 可用；加载后 200 行 |
| 375/768/1024/1440 | 均无页面横向滚动或越界元素 |
| Markdown 安全 | 脚本未执行，危险协议清空，HTTPS 安全属性正确 |
| 诊断操作 | 日志 Command 与清理确认参数正确 |

## 真实 Tauri 应用

| 场景 | 结果 |
| --- | --- |
| debug `.app` 启动 | 通过，URL 为 `tauri://localhost/` |
| 项目扫描与登记 | 通过 |
| 历史刷新与正文授权 | 通过 |
| Spec/Task 正文 | 通过 |
| 加入焦点 | 进入原生实时监听 |
| 原生目录选择 | 系统面板可打开，取消语义正常 |
| 项目目录打开 | 通过受控 opener |
| 日志目录打开 | 通过受控 opener |
| 原生事件到 UI | 修改任务 `notes.md` 后自动重索引并刷新当前正文 |
| 清除本地数据并退出 | 隔离数据目录删除、进程正常退出，源项目与 Git 状态不变 |

## Release 构建与安装

| 架构 | 文件 | 大小 | SHA-256 |
| --- | --- | ---: | --- |
| arm64 | `Trellis Visual Console_0.1.0_aarch64.dmg` | 3,752,851 字节 | `e994e8b1425f6b22b1dcfa2144acad4f361b09dc9188a1edf44f36193f4871a5` |
| x64 | `Trellis Visual Console_0.1.0_x64.dmg` | 3,840,161 字节 | `301baa61f45bcc88e7fd8be45f9683ddf3bc6b425c998c2fa7e275801a6df4c4` |

- 两个 DMG 均通过 `hdiutil verify`，远低于单架构 30 MiB 预算。
- 内部二进制分别确认为纯 arm64 和纯 x86_64 Mach-O。
- arm64 应用已从 DMG 安装到用户级 `~/Applications`，首次安装和同版本覆盖安装后均可完成页面加载、焦点恢复和原生监听。
- 最终交付前再次从校验通过的 arm64 DMG 覆盖安装并正常启动；应用使用正式数据目录恢复 5 个已登记项目和 4 个焦点项目，焦点项目均显示原生实时监听。
- x64 应用已在 Apple Silicon 上通过 Rosetta 启动，任务列表和文档核心流程正常；未完成 Intel 实机与 Intel 性能验证。
- arm64 release 已验证单实例：二次启动约 20ms 内退出，进程数保持 1，`desktop-starting` 计数不增加。
- 当前包为未签名/ad-hoc 内测形态，未通过 Developer ID 严格签名校验；README 已说明安全的 Gatekeeper 首次打开方式，正式发布仍需签名和公证。
- 自动化环境没有 Finder Apple Events 权限；普通 DMG 美化脚本会失败，使用 `CI=true` 构建后跳过图标定位脚本并成功生成有效镜像。应用内容、图标资源和 Applications 链接不受影响。

### 打包命令复验

清理旧产物并增加按架构脚本后，实际执行 `CI=true pnpm build:mac:arm64` 与 `CI=true pnpm build:mac:x64`，两个命令均成功。重建产物如下：

| 架构 | 大小 | 本次 SHA-256 | 镜像验证 |
| --- | ---: | --- | --- |
| arm64 | 3,752,851 字节 | `e4645940e1cda0c7360a1996cd2a42333871fb4b7dec9daf17beca97426ef3e5` | `hdiutil verify` 通过 |
| x64 | 3,840,156 字节 | `57d4e0269f476fb6cfef9e1a629a06fd877ba55a56ed7442955794c4273eddc0` | `hdiutil verify` 通过 |

DMG 包含文件系统布局时间等构建元数据，每次重建的 SHA-256 不保证一致。前表保留首次 release 安装验收包的摘要；实际对外交付时必须针对交付文件重新计算摘要。

## macOS 性能

| 指标 | arm64 release 结果 | 预算 |
| --- | ---: | ---: |
| Core ready | 6 ms | 窗口可操作总计不超过 2 s |
| `desktop-starting` 到 `desktop-page-loaded` | 723 ms | 不超过 2 s |
| 覆盖安装后页面加载 | 527 ms | 不超过 2 s |
| 稳定 RSS | 31 MiB | 不超过 150 MiB |
| 30 个 10 秒空闲样本平均 CPU | 0.000% | 低于 1% |
| 30 个 10 秒空闲样本峰值 CPU | 0.000% | 记录值 |
| Core 关闭资源释放 | 2 ms | 进程 1 s 内退出 |

`desktop-page-loaded` 由 Tauri `PageLoadEvent::Finished` 记录，和 `desktop-starting` 使用同一进程时钟；随后通过可访问性树确认窗口主操作可用。应用进程没有子进程、TCP/UDP 连接或监听。

## 已验证边界

- 生产 bundle 不包含或启动 Node/Fastify 服务。
- 前端通信只使用 Tauri Command/Event。
- Core 路径、存储、监听和日志的仓库外 probe 结果记录在任务 `notes.md`。
- 真实清理仅删除 `/tmp/trellis-desktop-dev-data`：清理前目录及 `registry.json` 存在，清理后均消失，应用 PID `75203` 退出且启动会话返回退出码 0。
- 清理前后源项目 Git 状态指纹均为 `358149db758a55eb13bb569f66219c1d8117b4d90843b1e32ae9291e78901510`，任务目录仍存在；正式应用数据和已登记源项目未被触碰。

## 后续缺口

- macOS 未签名包的真实 quarantine/Gatekeeper 提示尚未在干净用户环境复现；正式签名和公证不在首版内测前置范围。
- x64 只完成 Rosetta 核心流程，Intel 实机和性能验证仍明确保留缺口。
- 当前仅完成运行期零 TCP/UDP 连接审计；主动断开系统网络的完整离线流程按用户要求后置，本轮未执行。
- Windows x64 原生 NSIS 构建、WebView2、卸载数据选项、UNC/中文路径、监听和性能验收已拆分到 `.trellis/tasks/07-21-desktop-client-windows-x64`。

本文只作为 macOS 交付报告；Windows 结果由独立任务和独立验证报告管理，不再阻塞当前 macOS 任务收尾。
