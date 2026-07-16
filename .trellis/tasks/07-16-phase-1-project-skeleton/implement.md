# 阶段一项目运行骨架实施计划

## 实施清单

1. 创建 pnpm、TypeScript、Vite、ESLint 基础配置和忽略文件。
2. 创建 `src/shared` 健康检查 DTO。
3. 创建 Fastify 服务入口，绑定 `127.0.0.1`，实现健康接口和生产静态托管。
4. 创建 React 最小页面壳，通过 `/api/health` 验证前后端链路。
5. 配置开发并行启动、Vite 自动打开、生产构建与单进程启动脚本。
6. 安装依赖并生成 `pnpm-lock.yaml`。
7. 运行格式与范围检查，确认未实现阶段二及以后功能。
8. 运行 `pnpm lint`、`pnpm typecheck`、`pnpm build`。
9. 启动生产服务，验证健康接口与首页静态资源后退出进程。

## 风险文件与回滚点

- `src/server/index.ts`：监听地址、静态目录和 SPA 回退必须限制在本项目构建目录。
- `vite.config.ts`：开发代理只转发 `/api`，避免隐藏错误路由。
- `package.json`：保持单包结构；若脚本复杂度增长，再在后续阶段评估 workspace，当前不提前拆包。

## 验证命令

```bash
pnpm lint
pnpm typecheck
pnpm build
pnpm start
curl http://127.0.0.1:3100/api/health
curl -I http://127.0.0.1:3100/
```

## 启动前复核

- 需求、技术设计和实施清单都只覆盖 `docs/planning/implement.md` 的阶段一。
- 没有把 `@mindfoldhq/trellis-core` 设为依赖。
- 没有增加测试文件，也没有开始注册表、扫描、解析、监听或业务页面实现。
