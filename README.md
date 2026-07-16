# Trellis Visual Console

一个面向个人本机使用的 Trellis 只读可视化内容中心。

## 当前状态

项目已完成运行骨架、本机持久化、项目扫描与内容解析、焦点项目实时更新、正式只读 HTTP API 与 Web 控制台，以及阶段六系统验证与交付。当前可直接登记本机 Trellis 项目并浏览概览、Spec、Task、Workflow 和诊断。

核心方向：

- 独立仓库
- 本地 Node.js 服务 + 浏览器 Web UI
- 指定目录快速扫描与手动添加 Trellis 项目
- 焦点项目实时监听，历史项目仅保留摘要快照
- 浏览 Spec、活动/归档 Task、任务规划资料和 Workflow 摘要
- 不修改被查看项目的 `.trellis/` 内容

当前已具备：

- 跨平台应用数据目录解析。
- 版本化 `registry.json` 项目注册表。
- 版本化 `snapshots.json` 摘要快照。
- 原子写入、进程内写入串行化、损坏文件隔离恢复和版本保护。
- 指定目录递归发现与单项目结构校验。
- monorepo 配置、Spec 树、活动/归档 Task 和 Workflow 摘要解析。
- 单个坏文件诊断隔离、项目登记和受路径保护的 Markdown 按需读取。
- `history | focus | unavailable` 项目生命周期与启动恢复。
- 焦点项目受限路径监听、事件防抖、批量重索引和退出清理。
- 原生文件事件失败后的低频轮询降级与非实时状态标记。
- 可供后续 SSE 路由复用的轻量事件合同和进程内订阅中心。
- 项目列表、扫描、批量登记、详情、焦点切换、刷新和外部打开 API。
- 基于快照白名单和 realpath 边界的 Spec、Task Markdown/JSONL 内容 API。
- 带心跳和连接清理的 `/api/events` SSE 订阅接口。
- 焦点/历史/不可用项目分组导航，以及项目发现和中文错误反馈。
- 概览、Spec、Task、Workflow、诊断页面和安全 Markdown 渲染。
- URL 阅读上下文恢复、SSE 自动刷新和 375–1440px 响应式布局。
- macOS 实机异常、监听降级、重启恢复、生产退出和多项目性能基线验证。
- Windows/Linux 路径、应用数据目录、Chokidar 和外部打开的平台中立审查。

## 本地运行

环境要求：Node.js 22.12+、pnpm 10+。

```bash
pnpm install
pnpm dev
```

开发模式会同时启动 `127.0.0.1:3100` 的本地服务和 `127.0.0.1:5173` 的 Vite 页面，并自动打开浏览器。

生产构建与启动：

```bash
pnpm build
pnpm start
```

生产模式由 Node 服务托管 Web 静态资源，健康检查地址为 `http://127.0.0.1:3100/api/health`。

## 规划文档

- [产品需求](docs/planning/prd.md)
- [技术设计](docs/planning/design.md)
- [实施清单](docs/planning/implement.md)
- [第一性原理分析](docs/planning/fp-analysis.md)
- [新会话交接说明](docs/planning/session-handoff.md)
- [阶段六验证与交付报告](docs/validation/phase-6-report.md)

## 验证状态

阶段六已完成 macOS 实机验证，并对 Windows/Linux 完成平台中立代码审查。Windows/Linux 的真实文件事件、权限模型、系统外部打开和信号行为尚未实机覆盖，详细结果与指标见[阶段六验证与交付报告](docs/validation/phase-6-report.md)。
