# 添加项目支持本机目录选择 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 Windows 和 macOS 上从添加项目页面打开系统目录选择器，并把选择结果回填到快速扫描或手动添加路径输入框。

**Architecture:** 共享 Zod Schema 定义目录选择结果，本地 Fastify 路由调用独立的操作系统目录选择模块，Web API 客户端在边界校验响应，`useProjectConsole` 管理操作状态，`ProjectDiscovery` 管理具体回填目标。Linux 返回稳定的不支持错误，现有手工输入、扫描和登记流程保持不变。

**Tech Stack:** TypeScript 6、Node.js 22、Fastify 5、Zod 4、React 19、Lucide React、PowerShell、AppleScript、Vite。

---

## 文件结构

- Create: `src/server/system/directory-picker.ts`：Windows/macOS 原生目录选择和单实例并发保护。
- Create: `src/server/api/api-errors.ts`：复用统一 API 错误响应与安全错误类型提取。
- Create: `src/server/api/directory-picker-route.ts`：目录选择 HTTP 路由和稳定错误码映射。
- Modify: `src/shared/api.ts`：目录选择响应 Schema 与推导类型。
- Modify: `src/server/api/project-routes.ts`：复用抽取后的 API 错误工具。
- Modify: `src/server/index.ts`：创建目录选择器并注册系统路由。
- Modify: `src/web/api-client.ts`：新增经共享 Schema 校验的目录选择请求。
- Modify: `src/web/hooks/useProjectConsole.ts`：暴露目录选择操作并纳入 `busyAction`。
- Modify: `src/web/App.tsx`：向项目发现组件传递目录选择动作。
- Modify: `src/web/components/ProjectDiscovery.tsx`：两个选择入口、回填目标、取消和失败处理。
- Modify: `src/web/styles.css`：路径输入与图标按钮布局及窄屏约束。
- Modify: `.trellis/spec/backend/readonly-api-contract.md`：记录本地系统目录选择接口合同。
- Modify: `.trellis/spec/frontend/readonly-console-contract.md`：记录添加项目页目录选择交互合同。

### Task 1: 定义共享合同与原生目录选择模块

- [x] **Step 1: 在 `src/shared/api.ts` 定义正常结果合同**

新增严格空对象请求 Schema 与可判别联合响应 Schema：

```typescript
export const DirectoryPickerRequestSchema = z.object({}).strict();

export const DirectoryPickerResponseSchema = z.discriminatedUnion("status", [
  z.object({ status: z.literal("selected"), path: NonEmptyStringSchema }).strict(),
  z.object({ status: z.literal("cancelled") }).strict(),
]);

export type DirectoryPickerResponse = z.infer<typeof DirectoryPickerResponseSchema>;
```

- [x] **Step 2: 创建 `src/server/system/directory-picker.ts`**

导出 `DirectoryPicker`、`DirectoryPickerBusyError`、`DirectoryPickerUnsupportedError` 和 `DirectoryPickerUnavailableError`。`selectDirectory()` 使用 `active` 布尔值保证同一服务进程只存在一个活动对话框，并在 `finally` 中释放状态。

Windows 使用参数化调用：

```typescript
await execFileAsync("powershell.exe", [
  "-NoProfile",
  "-NonInteractive",
  "-STA",
  "-Command",
  WINDOWS_PICKER_SCRIPT,
], { encoding: "utf8", windowsHide: true });
```

PowerShell 脚本设置 UTF-8 输出编码，加载 `System.Windows.Forms`，打开 `FolderBrowserDialog`；确认时只输出 `SelectedPath`，取消时输出空字符串。

macOS 使用：

```typescript
await execFileAsync("osascript", ["-e", MACOS_PICKER_SCRIPT], { encoding: "utf8" });
```

AppleScript 捕获错误号 `-128` 并返回空字符串，确认时返回所选目录的 POSIX 路径。`process.platform` 不是 `win32` 或 `darwin` 时抛出 `DirectoryPickerUnsupportedError`。

- [x] **Step 3: 运行类型检查确认合同和原生模块可编译**

Run: `pnpm typecheck`

Expected: 命令退出码为 `0`，无 TypeScript 错误。

### Task 2: 注册目录选择 API 与稳定错误映射

- [x] **Step 1: 创建 `src/server/api/api-errors.ts`**

从 `project-routes.ts` 抽取并导出：

```typescript
export function sendApiError(
  reply: FastifyReply,
  statusCode: number,
  code: string,
  message: string,
  details?: string[],
): FastifyReply;

export function getErrorName(error: unknown): string;
```

`sendApiError` 继续通过 `ApiErrorResponseSchema.parse` 构造响应，`getErrorName` 只返回错误类型，不返回错误消息或路径。

- [x] **Step 2: 修改 `src/server/api/project-routes.ts` 复用错误工具**

删除文件内重复的 `sendApiError` 和 `getErrorName`，从 `./api-errors.js` 导入；保留项目资源错误分类、Zod 字段格式化和 Node 错误码判断不变。

- [x] **Step 3: 创建 `src/server/api/directory-picker-route.ts`**

导出：

```typescript
export function registerDirectoryPickerRoute(
  server: FastifyInstance,
  picker: DirectoryPicker,
): void;
```

注册 `POST /api/system/directories/select`，成功时使用 `DirectoryPickerResponseSchema.parse` 校验；错误映射如下：

- `DirectoryPickerBusyError` -> `409 directory-picker-busy`
- `DirectoryPickerUnsupportedError` -> `501 directory-picker-unsupported`
- `DirectoryPickerUnavailableError` -> `500 directory-picker-unavailable`
- 未知错误 -> 记录 `errorName` 后返回 `500 internal-error`

- [x] **Step 4: 修改 `src/server/index.ts` 注册路由**

创建单例 `DirectoryPicker`，调用 `registerDirectoryPickerRoute(server, directoryPicker)`；不改变 `127.0.0.1`、端口、静态托管、项目存储或实时管理生命周期。

- [x] **Step 5: 执行后端静态验证**

Run: `pnpm lint && pnpm typecheck`

Expected: 两条命令均退出码为 `0`。

### Task 3: 接入 Web 数据流和添加项目交互

- [x] **Step 1: 修改 `src/web/api-client.ts`**

导入 `DirectoryPickerResponseSchema` 和 `DirectoryPickerResponse`，新增：

```typescript
export function selectDirectory(): Promise<DirectoryPickerResponse> {
  return requestJson("/api/system/directories/select", DirectoryPickerResponseSchema, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
}
```

- [x] **Step 2: 修改 `src/web/hooks/useProjectConsole.ts`**

导入目录选择类型和 API 函数，新增动作：

```typescript
const chooseDirectory = useCallback(async (): Promise<DirectoryPickerResponse> => {
  return runActionWithResult("directory-picker", selectDirectory);
}, []);
```

在 Hook 返回值中暴露 `chooseDirectory`，继续由 `busyAction` 和全局通知管理网络失败。

- [x] **Step 3: 修改 `src/web/App.tsx`**

向 `ProjectDiscovery` 传入：

```tsx
onSelectDirectory={consoleState.chooseDirectory}
```

- [x] **Step 4: 修改 `src/web/components/ProjectDiscovery.tsx`**

新增 `FolderOpen`、`LoaderCircle` 图标和 `DirectoryPickerResponse` Props 合同：

```typescript
onSelectDirectory: () => Promise<DirectoryPickerResponse>;
```

新增局部状态：

```typescript
const [pickingField, setPickingField] = useState<"scan" | "manual" | null>(null);
```

新增 `handleSelectDirectory(target)`：请求开始设置目标；扫描目标在 `selected` 时只回填并等待主动扫描；手动添加目标在回填后立即复用单项目登记函数；`cancelled` 时不修改输入框和提示；失败时保留原值并显示中文消息；`finally` 清除目标。

抽取 `registerManualProject(path)`，让文本表单提交和目录选择共用同一套登记结果、无效诊断和输入清理逻辑。

两个输入框右侧使用带 `title` 和 `aria-label` 的文件夹图标按钮。按钮在 `pickingField !== null` 或其他业务操作进行中时禁用；当前目标显示旋转的 `LoaderCircle`。页头说明改为“可直接输入本机绝对路径，也可使用目录选择按钮”。

- [x] **Step 5: 修改 `src/web/styles.css`**

新增稳定的输入按钮布局：

```css
.path-picker-field {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 40px;
  gap: 8px;
}

.path-picker-button {
  width: 40px;
  min-height: 40px;
  padding: 0;
}
```

保留 `.input-action-row` 的“路径控件 + 命令按钮”布局；窄屏下只让外层行换为单列，路径输入和图标按钮仍保持同一行，避免文本和控件溢出。

- [x] **Step 6: 执行前端静态验证**

Run: `pnpm lint && pnpm typecheck && pnpm build`

Expected: 三条命令均退出码为 `0`，Vite 和服务端构建成功。

### Task 4: 更新合同并完成实机验收

- [x] **Step 1: 更新后端合同**

在 `.trellis/spec/backend/readonly-api-contract.md` 增加 `POST /api/system/directories/select` 的成功结果、取消语义、Windows/macOS 支持范围、Linux 501、不记录绝对路径和选择不触发读取的约束。

- [x] **Step 2: 更新前端合同**

在 `.trellis/spec/frontend/readonly-console-contract.md` 增加两个目录选择入口、回填但不自动提交、取消保留原值、失败继续手工输入和窄屏无水平滚动的验收要求。

- [x] **Step 3: 启动开发服务并验证 HTTP 基础状态**

Run: `pnpm dev`

Expected: 后端监听 `http://127.0.0.1:3100`，Vite 监听 `http://127.0.0.1:5173`，经 Vite 代理访问 `/api/health` 返回 `200`。

- [x] **Step 4: 使用 Playwright 验证 Web 交互**

在 headed 浏览器中打开 `http://127.0.0.1:5173`，确认两个输入框旁都存在可访问的“选择目录”按钮；确认 375、768、1024、1440 宽度无页面级水平滚动，控制台无错误和未知 API 失败。

- [x] **Step 5: 使用 Windows 实机与浏览器模拟验证系统对话框流程**

依次验证快速扫描和手动添加入口：扫描入口选择后只回填；手动添加入口选择有效 Trellis 项目后自动发起登记、刷新列表并进入项目工作区；再次打开并取消，确认原值不变；快速重复点击只出现一个对话框。

- [x] **Step 6: 执行最终质量门禁**

Run: `pnpm lint && pnpm typecheck && pnpm build && git diff --check`

Expected: 所有命令退出码为 `0`，无 lint、类型、构建或空白错误。

- [x] **Step 7: 审查验收标准并提交实现**

逐项核对 `prd.md` 的验收标准；仅暂存本任务相关源码、Spec 和任务文档，不包含 `.trellis/tasks/07-19-cross-project-task-center/` 等用户现有未跟踪内容。

Run:

```bash
git add src/shared/api.ts src/server src/web .trellis/spec/backend/readonly-api-contract.md .trellis/spec/frontend/readonly-console-contract.md .trellis/tasks/07-19-project-directory-picker
git commit -m "feat: 添加本机目录选择功能"
```

Expected: 提交只包含本功能相关文件。
