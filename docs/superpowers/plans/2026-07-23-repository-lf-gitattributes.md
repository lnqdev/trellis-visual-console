# 仓库级 LF 行尾规则实施计划

> **面向代理执行者：** REQUIRED SUB-SKILL：使用 `superpowers:executing-plans` 逐项实施本计划。步骤使用复选框跟踪；本任务范围很小，采用当前会话内联执行，不派发子代理。

**目标：** 在仓库根目录新增 `.gitattributes`，强制 Git 将自动识别的文本文件统一处理为 LF。

**架构：** 使用 Git 原生 attributes 规则补足 `.editorconfig` 只能约束编辑器的缺口。只新增一条仓库级规则，不执行全仓库重新归一化，不修改或暂存现有 Tauri 工作区变更。

**技术栈：** Git attributes、PowerShell、Git CLI。

---

## 文件结构

- Create: `.gitattributes`：声明仓库文本文件的 Git 行尾策略。
- Verify only: `.editorconfig`：确认现有编辑器级 LF 规则保持不变。
- Preserve: `src-tauri/Cargo.toml`、`src-tauri/gen/schemas/desktop-schema.json`、`src-tauri/gen/schemas/windows-schema.json`：保留现有未暂存状态，不纳入本任务提交。

### 任务 1：建立 Git 属性基线

**文件：**

- Verify only: `.gitattributes`
- Verify only: `.editorconfig`

- [ ] **步骤 1：确认配置文件基线**

运行：

```powershell
Test-Path -LiteralPath '.gitattributes'
Get-Content -Raw -LiteralPath '.editorconfig'
```

预期：第一条命令输出 `False`；`.editorconfig` 包含 `end_of_line = lf`。

- [ ] **步骤 2：验证仓库级 Git 属性尚未生效**

运行：

```powershell
git check-attr text eol -- package.json src-tauri/Cargo.toml
```

预期：两个文件的 `text` 和 `eol` 均为 `unspecified`，证明当前只有编辑器规则，没有 Git attributes 规则。

- [ ] **步骤 3：记录既有脏文件边界**

运行：

```powershell
git status --short
git diff --cached --name-status
```

预期：三个 `src-tauri` 文件保持未暂存，暂存区为空；不得清理、恢复或暂存它们。

### 任务 2：新增并验证仓库级 LF 规则

**文件：**

- Create: `.gitattributes`

- [ ] **步骤 1：新增最小规则**

创建 `.gitattributes`，完整内容为：

```gitattributes
* text=auto eol=lf
```

文件使用 UTF-8 编码和 LF 行尾，只保留一个文件末尾换行。

- [ ] **步骤 2：验证 Git attributes 解析结果**

运行：

```powershell
Get-Content -Raw -LiteralPath '.gitattributes'
git check-attr text eol -- package.json src-tauri/Cargo.toml src-tauri/gen/schemas/desktop-schema.json src-tauri/gen/schemas/windows-schema.json
```

预期：文件内容只有目标规则；四个代表性文本文件均显示 `text: auto` 和 `eol: lf`。

- [ ] **步骤 3：验证现有 Tauri 文件仍为 LF 且真实差异未被掩盖**

运行：

```powershell
git ls-files --eol -- src-tauri/Cargo.toml src-tauri/gen/schemas/desktop-schema.json src-tauri/gen/schemas/windows-schema.json
git diff --numstat -- src-tauri/Cargo.toml src-tauri/gen/schemas/desktop-schema.json src-tauri/gen/schemas/windows-schema.json
```

预期：三个文件均显示 `i/lf`、`w/lf` 和 `attr/text=auto eol=lf`；`windows-schema.json` 的 updater 权限真实差异继续存在，另外两个文件没有内容 diff。

- [ ] **步骤 4：仅暂存并检查 `.gitattributes`**

运行：

```powershell
git add -- .gitattributes
git diff --cached --check
git diff --cached --name-status
```

预期：差异检查退出码为 `0`；暂存区仅包含新增 `.gitattributes`。禁止运行 `git add .` 或 `git add --renormalize .`。

- [ ] **步骤 5：提交配置并复核工作区**

运行：

```powershell
git commit -m "chore: 统一仓库文本文件为 LF"
git status --short
git log -1 --oneline
```

预期：提交成功；`windows-schema.json` 的 updater 权限真实差异继续保持未暂存。`Cargo.toml` 和 `desktop-schema.json` 的内容哈希与 `HEAD` 相同，新增 Git 属性后其假修改状态允许自然消失；没有本任务新增的其他脏文件。
