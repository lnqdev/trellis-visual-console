# Trellis Visual Console

一个面向个人本机使用的 Trellis 只读可视化内容中心。

## 当前状态

项目已完成第一阶段运行骨架，尚未开始项目注册表、扫描、解析、监听和正式内容页面的实现。

核心方向：

- 独立仓库
- 本地 Node.js 服务 + 浏览器 Web UI
- 指定目录快速扫描与手动添加 Trellis 项目
- 焦点项目实时监听，历史项目仅保留摘要快照
- 浏览 Spec、活动/归档 Task、任务规划资料和 Workflow 摘要
- 不修改被查看项目的 `.trellis/` 内容

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

## 下一步

按照 [实施清单](docs/planning/implement.md) 进入阶段 2：本机注册表与摘要快照。每个阶段单独建立 Trellis 任务，避免越过已确认的首版边界。
