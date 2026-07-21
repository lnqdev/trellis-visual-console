# 项目发现与内容解析可执行合同

## 核心合同

- 有效项目必须包含普通目录 `.trellis/spec`、`.trellis/tasks` 和普通文件 `.trellis/config.yaml`。
- 项目根、`.trellis` 和必需入口不能是符号链接。
- 扫描忽略 `.git`、`node_modules`、构建产物和缓存，不跟随符号链接。
- 稳定项目 ID 来自真实路径哈希；重复真实路径更新原登记，不新增副本。
- 路径规范化稳定性：凡用路径字符串做哈希、比较或持久化键，必须先剥离 Windows verbatim 前缀（`\\?\` 和 `\\?\UNC\`），保证同一项目在任何 canonicalize 状态下路径形式一致。
- Spec 快照只保存树和源路径，不保存正文。
- 活动/归档 Task 全部读取后统一解析父子关系；双向一致优先，冲突和循环只隔离坏边。
- 父任务合法子项保留原 `children` 顺序；关系输出使用已解析 `sourcePath`。
- 单个坏 YAML、JSON、JSONL 或 Workflow 生成稳定中文诊断，不中断其他索引。
- 扫描只返回候选，登记和刷新才持久化；保存顺序为快照优先、注册表随后。

## 正文读取

读取顺序固定为：

```text
进程内读取资格 -> 快照/实时白名单 -> 原始输入检查
-> 普通文件与符号链接检查 -> canonical .trellis 边界
```

- 拒绝绝对路径、Windows 绝对路径、原始 `..`、非允许扩展名和链接。
- 历史项目初始没有正文资格；显式刷新成功后仅当前进程获得资格。
- Task 详情只接受快照内 Task；Task 文档只接受实时清单内普通 Markdown/JSONL。
- 受控打开复用同一原始路径和 canonical 边界，项目根必须是真实普通目录。

## 验证

临时 fixture 必须覆盖忽略目录、链接、坏编码/格式、关系冲突/循环、白名单外文件和路径逃逸。当前项目与 Trellis 主仓库的规范化 Rust 索引应与迁移基线一致。

## 路径规范化稳定性契约

### 1. Scope / Trigger

修改 `create_stable_project_id`、`resolve_safe_project_path`、validator 的 canonicalize 调用、或任何把项目路径字符串用作哈希输入/持久化键/比较基准的代码时，必须遵守本契约。触发场景：跨平台构建、版本迁移保留项目 ID、快照键与 `projectId` 一致性校验。

### 2. Signatures

```rust
// crates/trellis-core/src/projects/paths.rs
pub fn create_stable_project_id(real_project_path: &Path) -> Result<String, UnsafeProjectPathError>;
fn strip_verbatim_prefix(path: &str) -> String;
```

- `create_stable_project_id` 返回 SHA-256 前 24 位 hex，输入必须先经 `strip_verbatim_prefix` 规范化。
- `strip_verbatim_prefix` 是纯字符串函数，返回新 `String`，不触碰文件系统。

### 3. Contracts

| 输入路径形式 | `strip_verbatim_prefix` 输出 | 说明 |
| --- | --- | --- |
| `D:\develop\llm\project` | `D:\develop\llm\project` | 非 verbatim，原样返回 |
| `\\?\D:\develop\llm\project` | `D:\develop\llm\project` | 剥离盘符 verbatim 前缀 |
| `\\server\share\path` | `\\server\share\path` | 普通 UNC，原样返回 |
| `\\?\UNC\server\share\path` | `\\server\share\path` | 剥离 UNC verbatim 前缀并补回 `\\` |
| `/Users/foo/project` | `/Users/foo/project` | macOS/Linux，原样返回 |

- `fs::canonicalize` 仍可用于文件系统访问、`is_path_inside_or_equal` 边界比较、符号链接解析；带 verbatim 前缀的路径在 Windows 上可正常打开。
- **禁止**直接用 `canonicalize` 后的路径字符串算 id 或作为持久化键。

### 4. Validation & Error Matrix

| 条件 | 后果 | 防护 |
| --- | --- | --- |
| 未剥离 `\\?\` 直接算 id | 同一项目在 canonicalize 前后产生两个 id，快照键与 `projectId` 校验失败，refresh 持续报 `Storage(InvalidStructure)` | `create_stable_project_id` 内部强制剥离 |
| v1 数据 id 基于无前缀路径，v2 validator 用带前缀路径 | 迁移后 refresh 失败，项目数据无法读取 | 剥离后新旧 id 一致，无需数据迁移 |
| UNC 路径剥离后未补回 `\\` | UNC 项目 id 与原始形式不一致 | `strip_verbatim_prefix` 的 UNC 分支用 `format!("\\\\{rest}")` 补回 |
| 改 id 算法（如改用后 24 位或换 hash） | 旧数据 id 全部失效，迁移保留 ID 失败 | 改算法必须同时写数据迁移；优先保持算法不变 |

### 5. Good/Base/Bad Cases

- **Good**：validator 调 `canonicalize` 拿到 `\\?\D:\proj`，传入 `create_stable_project_id`，内部剥离后用 `D:\proj` 算 id。与 v1 数据（基于 `D:\proj`）一致。
- **Base**：macOS/Linux 上 `canonicalize` 不加前缀，`strip_verbatim_prefix` 原样返回，行为不变。
- **Bad**：在 `create_stable_project_id` 外部先 `canonicalize` 并直接 `to_string_lossy()` 喂给哈希，绕过剥离 —— 同一项目在 Windows 上会因前缀漂移产生不同 id。

### 6. Tests Required

- 单元测试 `strip_verbatim_prefix`：覆盖上表 5 种输入形式，断言输出与预期完全相等。
- 单元测试 `create_stable_project_id`：同一项目的"原始路径"和"`canonicalize` 后路径"两个输入，断言生成相同 id（Windows 上用 `\\?\D:\...`，其他平台用绝对路径）。
- 迁移回归测试：构造 v1 数据（id 基于无前缀路径），调用 v2 初始化 + `rebuild_migrated_projects`，断言快照键与 `snapshot.projectId` 一致，refresh 不报 `InvalidStructure`。
- UNC 路径测试（Windows）：`\\?\UNC\server\share\proj` 与 `\\server\share\proj` 产生相同 id。

### 7. Wrong vs Correct

#### Wrong

```rust
// 直接用 canonicalize 后的路径字符串算 id，Windows 上会带 \\?\ 前缀
let canon = fs::canonicalize(project_path)?;
let id = sha256(canon.to_string_lossy().as_bytes()); // 漂移！
```

```rust
// 在外部剥离，依赖每个调用点都记得做
let canon = fs::canonicalize(project_path)?;
let clean = canon.to_string_lossy().strip_prefix(r"\\?\").unwrap_or(&canon.to_string_lossy());
let id = sha256(clean.as_bytes()); // 调用点散落，容易遗漏 UNC 变体
```

#### Correct

```rust
// crates/trellis-core/src/projects/paths.rs
pub fn create_stable_project_id(real_project_path: &Path) -> Result<String, UnsafeProjectPathError> {
    let raw = real_project_path.to_str().ok_or(...)?;
    let normalized = strip_verbatim_prefix(raw); // 剥离集中在唯一入口
    Ok(format!("{:x}", Sha256::digest(normalized.as_bytes()))[..24].to_owned())
}

fn strip_verbatim_prefix(path: &str) -> String {
    if let Some(rest) = path.strip_prefix(r"\\?\UNC\") {
        format!(r"\\{rest}")
    } else if let Some(rest) = path.strip_prefix(r"\\?\") {
        rest.to_owned()
    } else {
        path.to_owned()
    }
}
```

剥离逻辑集中在 `create_stable_project_id` 唯一入口，所有调用者自动受益，无需各自处理。
