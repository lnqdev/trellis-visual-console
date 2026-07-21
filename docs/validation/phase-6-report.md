# 阶段六验证与交付报告

> 本文是迁移前 Node/Fastify Web 版本的历史验收基线；当前桌面验收见 `desktop-client-macos.md`。

## 结论

阶段一至阶段五形成的本地只读产品已在 macOS 实机完成系统验证。扫描、登记、内容隔离、焦点监听、启动恢复、异常状态、SSE、Web 安全、生产构建和退出清理均达到阶段六验收要求。

阶段六初验发现并修复两个生产缺陷：用户可见解析诊断泄露英文解析器消息，以及不可用项目修复后刷新仍无法恢复可用状态。后续验收复核又发现并修复三项缺陷：历史项目正文读取越界、项目详情后台请求竞态，以及归档 Task 标签不同步。修复后已完成 API、真实监听和 Playwright 回归。

Windows 与 Linux 本轮只完成平台中立代码审查和路径断言，没有进行真实系统文件事件、权限模型、外部打开和信号行为的实机验证。因此，本报告不将 Windows/Linux 标记为实机通过。

## 验证环境与边界

| 项目 | 结果 |
| --- | --- |
| 操作系统 | macOS 26.3.1，Apple Silicon（arm64） |
| Node.js | v24.12.0 |
| pnpm | 10.33.0 |
| 生产服务 | `127.0.0.1:3216` |
| 临时验证根目录 | `/tmp/trellis-visual-console-phase6-b4fvqn` |
| 应用数据目录 | `/tmp/trellis-visual-console-phase6-b4fvqn/data` |
| 源项目写入边界 | 产品仅写应用数据目录；故障注入仅修改临时 fixture |
| 仓库测试类 | 未新增；受控 watcher 程序和 fixture 均位于 `/tmp` |

验证 fixture 包含正常焦点项目、正常历史项目、坏内容项目、缺少必需结构项目和 25 个基准项目，共扫描到 28 个有效候选；无效结构项目产生 2 条预期诊断。

## macOS 实机验证结果

### 项目发现、登记与只读边界

- 扫描只返回候选，扫描前后 `registry.json` 与 `snapshots.json` 摘要一致，没有发生持久化。
- 正常单项目、批量项目、重复项目和无效项目登记结果符合合同。
- 重复登记返回 `updated`，复用稳定项目 ID，不新增重复注册项。
- Spec 正文只能读取快照白名单中的 `.trellis/**/*.md`；白名单外路径返回 `404`。
- 外部打开接口拒绝绝对路径，返回 `400`。
- 未知 API 返回中文 `404`，不会回退为 Web 首页。
- 非法 UTF-8 Markdown 返回通用 `500`，响应中不暴露堆栈或底层解码细节。
- Task 详情、Markdown 和 JSONL 文档均可正常读取。
- 产品验证前后源项目只读摘要一致：

```text
before = 65392dc541a4e6b4d4df900b8bf1cdc13657b563
after  = 65392dc541a4e6b4d4df900b8bf1cdc13657b563
```

### 焦点生命周期、监听与恢复

- 焦点项目使用 Chokidar 原生监听，运行时模式为 `native`。
- Spec、Task 和配置文件变化会产生对应失效事件和一次批量重索引。
- 历史项目保持 `stopped`，文件变化不产生实时事件，也不更新快照。
- 删除焦点项目后，项目进入 `unavailable`、监听器停止，最后成功快照保留。
- 权限故障和目录移动后再次变化均能识别原项目失效，并进入相同的不可用清理路径。
- 修复必需文件后执行“重新校验”，项目从 `unavailable` 恢复为 `history`，页面重新允许加入焦点。
- 服务重启只恢复 2 个焦点项目，内部活动监听器数量为 2；其余 26 个历史项目保持零监听。

### 受控 watcher 降级与资源释放

临时程序 `/tmp/trellis-visual-console-phase6-b4fvqn/validation/controlled-watcher.ts` 使用现有 watcher factory 注入边界完成以下验证：

- 原生监听启动失败后关闭失败实例并降级到 `polling`。
- 原生监听运行期错误后重新校验，并切换到 `polling`。
- 轮询监听也启动失败时，活动监听器数量回到 0，项目保持最后历史状态，不伪装为实时成功。
- 3 个快速路径变化被合并为 1 次批量重索引；`pendingChanges` 峰值为 3，完成后回到 0。
- 重复调用 `close()` 只关闭底层 watcher 一次。

### HTTP、SSE 与 Web

- 生产首页、静态资源、健康接口、项目 API 和内容 API 均正常返回。
- 单次 Spec 变化捕获 2 个业务事件：`spec-changed` 和 `project-reindexed`。
- SSE 断开后服务仍可正常退出，订阅与心跳未阻塞关闭流程。
- Playwright 回归确认：不可用项目显示中文错误和“重新校验”；修复后可恢复为历史项目。
- 失效 Spec URL 会自动回退，不产生预期外 `404`。
- Markdown 中的 `<script>` 不进入 DOM、不执行；检查结果为 `unsafe: null`、`scriptCount: 0`。
- 页面无水平溢出，当前验证页面控制台无错误或警告，相关 API 请求均为 `200`。

### 生产启动与退出

- 生产构建成功，Node 服务可托管 Web 静态资源并自动打开浏览器。
- 自动打开失败路径通过代码审查确认只记录警告，不中断已经启动的服务。
- 发送 `SIGTERM` 后 Fastify、SSE 和 watcher 统一进入关闭链路。
- 进程退出约耗时 18ms，退出后端口立即释放，可重新绑定。

## 指标基线

以下结果用于后续版本纵向比较，不作为 Windows/Linux 或其他硬件的性能结论。

| 指标 | 本轮结果 |
| --- | --- |
| 生产构建耗时 | 约 1.79s |
| 扫描 | 28 个有效候选，42ms，另有 2 条无效结构诊断 |
| 批量登记 | 25 个项目，251ms，全部成功 |
| 重复登记 | 1 个项目返回 `updated`，注册项数量不增加 |
| 应用数据大小 | 28 项目登记完成时 `registry.json` 9558 字节、`snapshots.json` 23600 字节；后续状态回归结束时分别为 9453、23435 字节 |
| 焦点监听器 | 重启恢复 2 个焦点项目，对应 2 个活动监听器 |
| 历史监听器 | 26 个历史项目全部为 `stopped` |
| 待处理变化 | 受控批次峰值 3，批量重索引后为 0 |
| SSE | 2 个业务事件；单条 JSON 负载约 199/206 字节；含连接和心跳共捕获 607 字节 |
| 服务 RSS | 不同启动与空闲采样约 24–71MiB；未增加长期指标接口 |
| 退出耗时 | SIGTERM 到进程退出约 18ms |

## 验收缺陷与修复

### 用户可见解析诊断泄露英文消息

原实现把 YAML/JSON 解析器的原始错误直接写入 `config-yaml-invalid`、`task-json-invalid` 和 `task-jsonl-invalid`。不同解析器、版本和平台可能产生英文文本或内部细节。

现已统一输出稳定中文诊断，例如：

```text
config.yaml 不是合法 YAML
task.json 不是合法 JSON
第 2 行不是合法 JSON
```

文件读取、目录读取、Workflow 和 Zod 结构诊断也同步改为中文稳定消息。源路径和诊断 code 继续保留，便于定位和程序化处理。

### 不可用项目成功刷新后状态未恢复

原实现成功刷新会清除错误和更新快照，但保留原 `unavailable` 状态，导致页面继续禁用“加入焦点”。

现已规定并实现：不可用项目在校验和完整索引成功后恢复为 `history`；普通历史或焦点项目刷新时保持原状态。恢复为历史而不是直接焦点，可避免在没有成功重建监听器时错误标记为焦点。

### 历史项目正文读取越界

原实现的 Spec 正文、Task 详情和 Task 文档服务只校验快照白名单，没有先校验项目正文读取状态，导致历史项目可以通过直接 HTTP 请求访问源文件。

现已在 `ProjectApiService` 增加统一正文读取资格校验，并通过 `ProjectDetailResponse.contentReadable` 让前后端使用同一事实：

- 服务重启后的历史项目 `contentReadable=false`，三个正文接口均返回 `409 project-content-unavailable`。
- 历史项目显式刷新成功后仍保持 `history` 和 `watchMode=stopped`，但当前服务进程内 `contentReadable=true`，Spec、Task 详情和 Task 正文均返回 `200`。
- 再次重启服务后临时资格清除，正文接口重新返回 `409`；资格不写注册表或快照。
- 焦点项目的合法 Spec、Task 详情和 Task 文档继续返回 `200`，原有白名单、符号链接和 realpath 边界保持不变。

Playwright 记录历史项目刷新前正文请求数为 `0`；页面只显示摘要限制提示。刷新后 Spec 正文与归档 Task 资料恢复可读，归档标签 `aria-selected=true`。

### 项目详情异步竞态

原实现的普通详情请求依赖 Effect 清理取消，但 SSE 后台 `loadDetail` 没有 AbortSignal。用户切换项目后，旧项目后台响应可能晚返回并覆盖当前详情。

现已使用当前项目 ref 和单调请求代次共同保护提交：响应只有在项目 ID、当前选择和最新代次全部一致时才更新详情；项目操作返回也使用相同门禁。

Playwright 将焦点项目 A 的 2 条后台详情请求延迟到切换项目 B 之后返回。延迟释放 1.2 秒后，页面标题仍为 `benchmark-03`，URL 仍为项目 B，旧项目标题不可见。

### 归档 Task 标签不同步

原实现只用 `initialCollection` 初始化活动/归档标签，后续选中 Task 或项目数据变化不会修正集合。

现已让局部集合状态持续服从当前选中 Task，并在当前集合为空时回退到有内容的集合。Playwright 结果：

- 归档 Task URL 恢复后，归档标签 `aria-selected=true`，正文 URL 保留归档 Task 和 `document=prd.md`。
- 跨项目进入同时包含活动/归档 Task 的项目时，活动标签先与默认活动 Task 对齐；选择归档 Task 后归档标签立即变为 `aria-selected=true`。
- 最终浏览器控制台错误和警告均为 0，相关业务 API 均返回 `200`。

## Windows/Linux 平台中立审查

| 审查项 | 结论 |
| --- | --- |
| 应用数据目录 | macOS 使用 Application Support；Windows 使用 `%APPDATA%` 或用户 Roaming 目录；Linux 使用 `$XDG_CONFIG_HOME` 或 `~/.config` |
| 路径拼接 | 使用 `node:path` 的 `join`、`resolve`、`relative` 和当前平台分隔符，没有硬编码 `/Users` 或 shell 路径拼接 |
| 输入绝对路径 | 同时使用 POSIX 与 `win32.isAbsolute` 识别；临时断言覆盖 Windows 盘符、UNC、POSIX 绝对路径和反斜杠归一化 |
| 真实路径边界 | 通过 `realpath`、逐段 `lstat` 和平台原生 `relative` 检查符号链接与目录逃逸 |
| Chokidar | 固定监听四类 Trellis 路径，`followSymlinks=false`；原生失败可切换 `usePolling`，不依赖特定文件事件名称 |
| 外部打开 | 只把校验后的项目 realpath 或 `.trellis` 内 realpath 交给 `open` 包，不构造 `cmd`、`open`、`xdg-open` 等平台命令 |

临时 TypeScript 断言确认：合法反斜杠相对路径会转换为 `.trellis/spec/index.md`；`C:\\...`、`\\\\server\\share\\...`、`/...` 和含 `..` 的路径均被拒绝。

## 未覆盖项与后续建议

- 未在 Windows/Linux 实机验证 Chokidar 原生事件、权限错误、系统外部打开和退出信号差异。
- 未引入多平台 CI runner、安装包、签名、公证或自动更新；这些内容不属于首版范围。
- 当前指标是单次本机基线，没有设置缺少历史数据支撑的硬阈值。后续版本可复用相同字段进行纵向比较。
- 若准备面向多平台正式发布，应在对应系统上复用本报告场景，而不是把本次代码审查当作实机结论。

## 最终质量门禁

阶段六最终交付执行以下命令：

```bash
pnpm lint
pnpm typecheck
pnpm build
git diff --check
```

同时使用 Trellis 全量检查复核规范一致性、跨层数据流、代码复用和文档状态。

2026-07-17 验收复核修复完成后重新执行上述四项命令，全部通过；生产 Web 构建生成 `index-B5Ox4iE8.js`，服务端 TypeScript 构建无错误，`git diff --check` 无输出。
