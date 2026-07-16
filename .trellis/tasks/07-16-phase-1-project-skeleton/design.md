# 阶段一项目运行骨架技术设计

## 架构边界

首阶段采用单仓库、单 `package.json` 的 pnpm 项目，避免在尚无独立发布需求时引入 workspace 或多包管理复杂度。

```text
浏览器 Web UI（React + Vite）
  └─ /api 开发代理
       ▼
Node 本地服务（Fastify）
  ├─ GET /api/health
  └─ 生产模式托管 dist/web

src/shared
  └─ 前后端共享的健康检查 DTO 类型
```

## 目录与构建

- `src/server/`：本地服务入口、HTTP 路由与未来文件系统能力。
- `src/web/`：React 页面入口和最小应用壳。
- `src/shared/`：不依赖 Node 或浏览器运行时的共享 DTO。
- `dist/server/`：TypeScript 编译后的 Node 服务。
- `dist/web/`：Vite 构建后的静态资源。

开发模式由 `concurrently` 同时运行 `tsx watch` 和 Vite；Vite 负责自动打开浏览器，并把 `/api` 代理到本地服务。生产模式由编译后的 Node 服务注册静态资源插件、监听回环地址并自动打开浏览器。

## 技术选择

- HTTP 框架使用 Fastify：首阶段只增加健康接口和静态资源托管，保留后续只读 API 的路由与错误处理扩展点。
- 静态资源使用 `@fastify/static`，不自行实现文件路径解析，降低目录穿越风险。
- 浏览器打开使用 `open`；开发模式由 Vite 打开，生产模式由服务监听成功后打开。
- Node 服务采用 ESM 与 TypeScript `NodeNext` 编译；Web 使用 Vite 的 Bundler 模块解析。
- 不引入数据库、状态管理库、路由库、组件库、Markdown 库、监听库或 Core SDK。

## 接口合同

`GET /api/health` 返回：

```json
{
  "status": "ok",
  "service": "trellis-visual-console",
  "timestamp": "2026-07-16T00:00:00.000Z"
}
```

健康接口不读取任何 Trellis 项目，也不暴露本机路径。

## 安全与回滚

- 默认主机固定为 `127.0.0.1`，只有显式环境变量才允许调整端口；首阶段不开放主机地址配置。
- 生产静态托管只指向本项目 `dist/web`。
- 若 Fastify 或静态插件不满足后续需求，可在保持 `/api/health` 和启动脚本合同的前提下替换，不影响产品数据模型。
