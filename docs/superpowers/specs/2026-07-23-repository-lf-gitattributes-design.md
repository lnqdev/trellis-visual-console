# 仓库级 LF 行尾规则设计

## 目标

在仓库根目录新增 `.gitattributes`，让 Git 在所有平台上把自动识别为文本的文件统一检出和提交为 LF，避免 Windows 的全局 `core.autocrlf=true` 再次制造 CRLF 警告或假修改。

## 实现

`.gitattributes` 仅包含以下规则：

```gitattributes
* text=auto eol=lf
```

该规则由 Git 执行，补足现有 `.editorconfig` 只能约束编辑器、不能约束 Git checkout 和暂存转换的缺口。

## 范围

- 新增根目录 `.gitattributes`。
- 不执行 `git add --renormalize .`，避免产生全仓库机械性差异。
- 不修改、恢复或暂存现有 `src-tauri` 工作区改动。
- 不添加 `.bat`、`.cmd` 等 CRLF 例外；当前需求明确要求文本文件统一为 LF。

## 验证

- 读取 `.gitattributes`，确认只有目标规则。
- 使用 `git check-attr text eol` 验证代表性文本文件得到 `text: auto` 和 `eol: lf`。
- 使用 `git ls-files --eol` 确认三个现有 Tauri 文件仍为 LF。
- 检查 `git status --short`，确认除新文件外没有因本次操作新增的工作区变化。
