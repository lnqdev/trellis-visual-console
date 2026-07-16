# 阶段一项目运行骨架

## 目标

在不扩大首版范围的前提下，为 Trellis Visual Console 建立可运行、可构建的独立全栈项目骨架，为后续本机注册表、项目扫描、只读解析和实时监听提供清晰边界。

## 背景与已确认事实

- 产品是个人本机使用的 Trellis 只读内容中心，不是 Trellis CLI、编辑器或桌面安装包。
- 产品采用本地 Node.js 服务 + 浏览器 Web UI，服务仅绑定 `127.0.0.1`。
- Web UI 使用 React + TypeScript + Vite，本地服务使用 Node.js + TypeScript。
- 源项目 `.trellis/` 是唯一事实来源；本项目不得写入被浏览项目。
- 完整产品规划以仓库根目录 `README.md` 与 `docs/planning/` 全部文档为依据。

## 需求

1. 初始化独立 pnpm/TypeScript 项目，不引入 `@mindfoldhq/trellis-core`。
2. 建立 `src/server`、`src/web`、`src/shared` 三个代码边界。
3. 配置 React + Vite Web 构建和 Node 本地服务。
4. 开发模式用一个命令同时启动服务与 Vite，并自动打开浏览器。
5. 生产模式由 Node 服务托管构建后的 Web 静态资源，并自动打开本机页面。
6. 服务默认绑定 `127.0.0.1`，提供基础健康检查接口。
7. 提供最小页面壳，仅验证 Web UI、共享类型和健康接口链路，不实现后续产品功能。
8. 所有新增文档与用户可见文本使用中文，文件编码为 UTF-8。
9. 本阶段不生成测试类或测试文件。

## 验收标准

- [x] `pnpm install` 可以完成依赖安装并生成锁文件。
- [x] `pnpm dev` 同时启动本地服务和 Vite，浏览器打开 Web 页面。
- [x] `GET /api/health` 返回明确的健康状态、服务名和时间戳。
- [x] 服务监听地址默认是 `127.0.0.1`，不绑定 `0.0.0.0`。
- [x] Web 页面能通过开发代理读取健康接口并展示连接状态。
- [x] `pnpm lint`、`pnpm typecheck`、`pnpm build` 全部通过。
- [x] `pnpm start` 仅启动一个 Node 进程，能托管生产静态资源和健康接口。
- [x] 代码中不存在项目注册表、目录扫描、Trellis 解析、文件监听、SSE 业务事件或写入源项目的实现。

## 不在本阶段范围内

- 项目注册表与摘要快照。
- 扫描根目录、手动添加项目和 `.trellis/` 结构校验。
- Spec、Task、Workflow 解析与展示。
- 焦点/历史项目生命周期、文件监听和 SSE 更新。
- Electron/Tauri、数据库、账号、团队、远程、云同步。
- Trellis 文件编辑、任务状态操作、Agent 启动、Channel、Mem、Workspace、Runtime 面板。
