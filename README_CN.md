# Trellis Visual Console

[English](README.md)

Trellis Visual Console 是一个面向个人本机的 Trellis 只读 Web 控制台，用于集中浏览多个本地项目中的 Trellis 数据。

它帮助用户在不逐个打开仓库的情况下快速回答：

- 本机有哪些项目使用了 Trellis？
- 每个项目包含哪些规范？
- 当前有哪些活动任务和归档任务？
- 某个任务的 PRD、设计、实施计划和研究资料是什么？
- 项目当前使用哪个 Workflow、处于哪个阶段？

它不是 Trellis CLI 的替代品，也不会编辑被查看项目的 `.trellis/` 目录。

## 核心能力

- 递归扫描用户指定的目录，发现其中的 Trellis 项目。
- 手动登记单个项目。
- 浏览项目摘要、monorepo 包、Spec、Task、Workflow 和诊断信息。
- 阅读 Markdown 与任务规划资料，并保留源文件路径追溯能力。
- 使用 `focus`、`history`、`unavailable` 三种状态管理项目。
- 只监听焦点项目，通过 SSE 通知页面刷新失效的数据。
- 历史项目不占用活动监听器，只展示最后一次成功索引的摘要快照。
- 原生文件事件不可用时，允许降级为低频轮询。
- 将项目注册表和可重建快照存放在被查看项目之外。
- 服务只绑定 `127.0.0.1`，并通过项目登记、文件白名单、realpath 和 Markdown 安全边界限制读取范围。

## 工作方式

```text
浏览器界面（React）
  ├─ HTTP：项目、Spec、Task、Workflow、诊断
  └─ SSE：项目级数据失效事件
                  │
                  ▼
本地服务（Fastify，绑定 127.0.0.1）
  ├─ 项目扫描与结构校验
  ├─ Trellis 内容索引
  ├─ 本机注册表与摘要快照
  └─ 焦点项目文件监听器
                  │
                  ▼
       已登记项目的本地 .trellis/ 目录
```

源项目的 `.trellis/` 始终是唯一事实来源。应用只写入自己的 `registry.json` 和 `snapshots.json`。

### 焦点项目与历史项目

- **焦点项目（focus）**：加入焦点时重新索引，持续监听 Trellis 相关文件，并通过 SSE 触发页面局部刷新。
- **历史项目（history）**：没有活动监听器，只展示最后一次成功索引的摘要；显式刷新成功后，可在当前服务进程内临时读取正文。
- **不可用项目（unavailable）**：路径不存在、无权访问或 Trellis 结构失效；保留原登记信息和历史快照用于诊断。

快速扫描只在用户主动操作时执行，不会把扫描根目录变成永久监听范围。

## 环境要求

- Node.js 22.12 或更高版本
- pnpm 10 或更高版本

## 开发运行

```bash
pnpm install
pnpm dev
```

开发模式会启动：

- 本地 API 服务：`http://127.0.0.1:3100`
- Vite 页面：`http://127.0.0.1:5173`

浏览器会自动打开，Vite 开发服务器会将 API 请求代理到本地服务。

## 生产构建与启动

```bash
pnpm build
pnpm start
```

生产模式由 Node.js 服务托管构建后的 Web 静态资源，并自动在浏览器中打开本机地址。默认健康检查地址为：

```text
http://127.0.0.1:3100/api/health
```

可以通过环境变量修改端口：

```bash
PORT=3200 pnpm start
```

## 本机应用数据

应用自己的数据默认存放在：

| 平台 | 目录 |
| --- | --- |
| macOS | `~/Library/Application Support/Trellis Visual Console` |
| Windows | `%APPDATA%/Trellis Visual Console` |
| Linux | `$XDG_CONFIG_HOME/trellis-visual-console` 或 `~/.config/trellis-visual-console` |

开发或隔离验证时可以覆盖数据目录：

```bash
TRELLIS_VISUAL_CONSOLE_DATA_DIR=/tmp/trellis-visual-console pnpm dev
```

删除这些应用数据只会清除控制台的项目注册表和摘要缓存，不会修改任何已登记的 Trellis 项目。

## 只读与安全边界

- HTTP 服务只监听 `127.0.0.1`。
- API 使用已登记的项目 ID，不接受任意绝对路径作为读取目标。
- 正文读取仅允许访问已经索引的 Trellis 文件，并使用 realpath 校验真实路径边界。
- 拒绝路径穿越和符号链接逃逸。
- Markdown 渲染不会执行其中嵌入的 HTML 或脚本。
- 不提供文件编辑、任务状态变更、Agent 启动或命令执行 API。
- “外部打开”只会把已经校验的项目路径交给操作系统处理。

## 项目结构

```text
src/server/   本地 HTTP 服务、存储、扫描、索引与监听
src/shared/   API Schema 与前后端共享合同
src/web/      React 控制台与只读内容视图
docs/         产品规划、技术设计与验证证据
.trellis/     项目工作流、规范、任务与开发记录
```

## 质量检查

```bash
pnpm lint
pnpm typecheck
pnpm build
git diff --check
```

当前 MVP 已完成 macOS 实机系统验证。Windows 和 Linux 已完成平台中立的路径与实现审查，但原生文件事件、权限、系统外部打开和进程信号仍未在真实机器上验证。

具体场景、已知覆盖边界、缺陷修复和性能基线见[阶段六验证与交付报告](docs/validation/phase-6-report.md)。

## 项目文档

- [产品需求](docs/planning/prd.md)
- [技术设计](docs/planning/design.md)
- [实施清单](docs/planning/implement.md)
- [第一性原理分析](docs/planning/fp-analysis.md)
- [新会话交接说明](docs/planning/session-handoff.md)
- [阶段六验证与交付报告](docs/validation/phase-6-report.md)

## 当前范围

首版刻意保持本地、只读，不包括：

- 编辑 Spec、Task 或 Workflow 状态
- 团队账号、远程访问或云端同步
- Channel、Worker、Mem、Workspace Journal 或运行时操作面板
- Electron 或 Tauri 安装包
- 对 `@mindfoldhq/trellis-core` 的强制依赖

如果未来复用 Trellis 官方任务校验或 Workflow 语义的收益高于维护本地轻量适配层的成本，再评估选择性接入 Core SDK。
