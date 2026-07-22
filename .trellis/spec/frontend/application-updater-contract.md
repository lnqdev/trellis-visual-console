# 前端应用更新可执行合同

## 场景：应用更新状态与交互

### 1. 范围与触发条件

- 修改更新共享 Schema、`api-client.ts`、`useApplicationUpdater`、更新提示、诊断面板或弹窗时必须遵守本合同。
- 项目浏览状态与应用更新状态相互独立；检查或下载不得占用项目 `busyAction`。

### 2. 签名

```typescript
checkForApplicationUpdate(mode: "automatic" | "manual"): Promise<UpdateCheckResponse>
installApplicationUpdate(onProgress): Promise<UpdateInstallResponse>
restartApplication(): Promise<void>

interface ApplicationUpdaterController {
  state: ApplicationUpdaterState;
  check(mode?: "automatic" | "manual"): Promise<void>;
  install(): Promise<void>;
  restart(): Promise<void>;
  openDialog(): void;
  closeDialog(): void;
}
```

### 3. 合同

- 组件和 Hook 不直接导入 Tauri updater；所有 Command 与 Channel 只经过 `api-client.ts`。
- Command 成功值、结构化错误和每条 Channel 进度都从 `unknown` 经 Zod 校验；任一进度 payload 非法时整次安装返回 `invalid-command-response`。
- Command/Channel 合同不能只核对 TypeScript 和 Rust 类型名；必须对 Rust 实际序列化的 JSON 做回归断言，特别检查结构化枚举变体中的 `currentVersion`、`contentLength` 等字段。
- 状态机固定为 `idle -> checking -> skipped | upToDate | available | error`，以及 `available -> downloading -> installed | error`。
- 应用挂载后只触发一次 `automatic` 检查；StrictMode 重放不得产生第二次请求。检查与安装使用前端操作标记防止双击竞态，Rust 仍是最终互斥边界。
- 构建时从 `package.json` 注入当前版本，全局侧边栏与诊断页同时展示；网络失败、未选中项目或处于任务中心时仍能核对当前版本。
- 自动发现更新只显示非阻断顶部提示；手动检查发现更新时直接打开弹窗。确认前必须展示目标版本、中文说明和发布时间。
- macOS 安装后同时提供立即重启与稍后重启；稍后关闭弹窗但保留 `installed` 状态。Windows 确认下载前必须提示安装阶段会退出应用。
- 弹窗初始焦点位于关闭按钮，非下载阶段支持 Escape；下载阶段禁止关闭并把焦点放在对话框状态区域。
- 更新说明使用 `react-markdown + remark-gfm`，不启用原始 HTML；HTTP(S) 链接使用 `_blank` 和 `noreferrer`。

### 4. 校验与错误矩阵

| 输入或状态 | 界面结果 |
| --- | --- |
| `skipped` | 显示 24 小时限频，可手动检查 |
| `upToDate` | 显示当前为最新内测版本 |
| `available` | 顶部提示和诊断入口可打开说明弹窗 |
| 未知成功 payload / Channel payload | `invalid-command-response` |
| 稳定 Command 错误 | 显示中文 `message`，允许重新检查 |
| 下载总大小未知 | 显示不定进度和累计字节，不伪造百分比 |
| macOS `restartRequired=true` | 显示立即/稍后重启 |
| 非 Tauri 页面 | `desktop-runtime-unavailable`，不回退 HTTP |

### 5. Good / Base / Bad Cases

- Good：自动检查发现更新后不阻断项目浏览，用户打开弹窗阅读说明、确认安装，并选择立即或稍后重启。
- Base：无更新、限频或断网时诊断页仍显示本地版本和可恢复操作，项目界面不受影响。
- Bad：组件直接使用 updater 插件、自动下载、用 `window.confirm` 展示长说明，或关闭弹窗后丢失已安装待重启状态。

### 6. 必需验证与断言点

- `pnpm lint`、`pnpm typecheck`、`pnpm build:web` 全部通过。
- IPC mock 分别提供合法和非法检查/进度 payload，断言只消费 Schema 输出且错误稳定。
- 与 IPC mock 配对的 Rust 序列化测试必须断言 `current_version`、`content_length` 在线上一定是 `currentVersion`、`contentLength`，避免检查或安装已成功但前端因响应字段命名错误显示失败。
- Playwright 在 375/768/1024/1440 断言 `documentElement.scrollWidth === innerWidth`，提示、诊断面板和弹窗无裁切或重叠。
- 断言弹窗打开后关闭按钮获得焦点；Escape 在可关闭阶段生效，下载阶段无效。
- 断言 macOS 稍后重启只关闭弹窗，下一次启动由已替换应用包直接进入新版本。

### 7. Wrong vs Correct

#### Wrong

```typescript
import { check } from "@tauri-apps/plugin-updater";
await check();
```

#### Correct

```typescript
const response = await checkForApplicationUpdate("manual");
// api-client 已经完成 unknown -> Zod 合同校验
```
