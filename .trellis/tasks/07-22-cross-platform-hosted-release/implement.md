# 跨平台托管自动发布实施计划

> **供智能代理执行：** 必须按任务顺序逐项实施并在每项完成后提交。可使用 `superpowers:subagent-driven-development`（推荐）或 `superpowers:executing-plans`。除非用户另行要求，不新建测试类；验证使用现有质量命令、临时 fixture 和真实发布演练。

**目标：** 使用公开 GitHub 镜像和免费标准 GitHub Actions Runner，一次标签触发即可构建 macOS arm64、macOS x64、Windows x64，上传 Gitee Release，并在人工批准后公开三平台更新清单。

**架构：** Gitee `main` 继续作为源码主线，GitHub 只保存同步镜像与工作流。发布逻辑拆为通用合同、平台产物、Gitee 发布和 CI 命令四个边界；GitHub Actions 负责预检、矩阵构建、汇总上传与受保护 Environment 门禁，现有 macOS 本地脚本复用公共模块并保持原命令兼容。

**技术栈：** Node.js 22、pnpm 10、Tauri 2、Rust 1.88、GitHub Actions、Gitee Open API、NSIS、Tauri Updater 签名。

---

## 文件结构

- 新建 `scripts/release-common.mjs`：SemVer、中文说明、版本同步、SHA-256、元数据结构校验等无平台公共能力。
- 新建 `scripts/release-artifacts.mjs`：三平台产物描述、单平台归档、汇总元数据和候选清单输入。
- 新建 `scripts/release-gitee.mjs`：Gitee Release、附件幂等上传、匿名复验、候选清单和 Contents API 公开清单提交。
- 新建 `scripts/release-ci.mjs`：`validate-tag`、`stage-platform`、`aggregate`、`upload`、`publish-manifest` 命令入口。
- 新建 `scripts/prepare-release.mjs`：同步版本并创建 `releases/notes/v<版本>.md`，不构建、不提交、不推送。
- 修改 `scripts/release-macos.mjs`：改为复用公共模块，保留 `prepare/stage/upload/publish-manifest` 的本地回退接口。
- 修改 `scripts/validate-update-manifest.mjs`：导出结构校验函数，同时保持现有 CLI 行为。
- 新建 `.github/actions/setup-project/action.yml`：统一 Node、pnpm、Rust target 和依赖缓存设置。
- 新建 `.github/workflows/quality.yml`：不含发布 Secret 的普通提交质量检查。
- 新建 `.github/workflows/release.yml`：版本标签预检、三目标构建、Gitee 候选发布和人工公开门禁。
- 新建 `releases/notes/README.md`：说明版本化中文更新说明合同。
- 修改 `package.json`：增加准备版本和 CI 发布脚本入口。
- 修改 `README.md`、`docs/release/desktop-online-update.md`：改写日常发布、Secret、镜像、批准和故障恢复流程。
- 修改 `.trellis/spec/backend/desktop-updater-contract.md`：记录三平台托管发布的长期合同。

## 任务 1：提取公共发布合同并保持 macOS 回退兼容

**文件：**

- 新建：`scripts/release-common.mjs`
- 修改：`scripts/release-macos.mjs`
- 修改：`scripts/validate-update-manifest.mjs`

- [x] **步骤 1：定义公共导出接口**

在 `scripts/release-common.mjs` 中实现并导出以下接口，函数错误均使用可操作的中文信息：

```javascript
export const REPOSITORY_OWNER = "wanglinqiao";
export const REPOSITORY_NAME = "trellis-visual-console";
export const PLATFORM_KEYS = [
  "darwin-aarch64",
  "darwin-x86_64",
  "windows-x86_64",
];

export function assert(condition, message) {}
export function parseSemver(version) {}
export function compareSemver(left, right) {}
export function createReleaseNotes(noteItems) {}
export async function readCurrentVersion(repositoryRoot) {}
export async function writeVersionFiles(repositoryRoot, version) {}
export async function calculateFileSha256(filePath) {}
export async function readReleaseMetadata(directory, expectedPlatforms) {}
```

`readReleaseMetadata` 必须拒绝路径穿越文件名、非正整数大小、非 64 位小写 SHA-256、缺平台和平台文件未登记等情况。元数据 `schemaVersion` 保持兼容本地 macOS 的版本 1，并允许后续 CI 使用版本 2。

- [x] **步骤 2：用临时 Node 断言验证公共接口**

运行：

```powershell
node --input-type=module -e "import { compareSemver, createReleaseNotes } from './scripts/release-common.mjs'; if (compareSemver('0.2.0-beta.5','0.2.0-beta.4') <= 0) process.exit(1); if (!createReleaseNotes(['修复发布流程']).includes('修复发布流程')) process.exit(1)"
```

预期：退出码为 `0`，终端不输出 Secret。

- [x] **步骤 3：让清单校验器同时提供模块与 CLI 接口**

从 `scripts/validate-update-manifest.mjs` 导出：

```javascript
export const PLATFORM_SETS = {
  all: ["darwin-aarch64", "darwin-x86_64", "windows-x86_64"],
  macos: ["darwin-aarch64", "darwin-x86_64"],
};

export function validateManifest(manifest, platformKeys) {}
```

仅当 `import.meta.url` 对应当前入口脚本时运行 CLI `main()`，保证 `pnpm check:update-manifest` 行为不变。

- [x] **步骤 4：改造本地 macOS 脚本复用公共函数**

删除 `scripts/release-macos.mjs` 中重复的常量、SemVer、说明、版本写入、哈希和元数据基础校验，改为从 `release-common.mjs` 导入。macOS 钥匙串、Mach-O/Info.plist 校验和三阶段交互仍留在原文件。

- [x] **步骤 5：执行兼容性检查**

运行：

```powershell
pnpm release:mac -- help
pnpm check:update-manifest -- releases/latest.json --platforms macos
pnpm check:update-manifest -- releases/latest.example.json --platforms all
pnpm lint
pnpm typecheck
```

预期：两个清单校验分别通过，macOS 帮助仍列出四个原命令，lint/typecheck 退出码为 `0`。

- [x] **步骤 6：提交公共合同改造**

```powershell
git add scripts/release-common.mjs scripts/release-macos.mjs scripts/validate-update-manifest.mjs
git commit -m "refactor: 提取桌面发布公共合同"
```

## 任务 2：增加版本准备与版本化更新说明

**文件：**

- 新建：`scripts/prepare-release.mjs`
- 新建：`releases/notes/README.md`
- 修改：`package.json`

- [x] **步骤 1：实现只准备版本的 CLI**

`scripts/prepare-release.mjs` 接收一个 SemVer 和一条或多条中文说明：

```text
node scripts/prepare-release.mjs <版本> <中文说明...>
```

处理顺序固定为：先解析 SemVer 并校验中文说明，再确认当前分支为干净且同步的 `main`、确认目标版本高于当前版本、调用 `writeVersionFiles`、写入 `releases/notes/v<版本>.md`、运行 `cargo check -p trellis-core` 更新 `Cargo.lock`、运行 `pnpm check:version`。脚本不得提交、创建标签、推送或执行平台构建。

- [x] **步骤 2：增加稳定脚本入口**

在 `package.json` 增加：

```json
{
  "release:prepare": "node scripts/prepare-release.mjs",
  "release:ci": "node scripts/release-ci.mjs"
}
```

- [x] **步骤 3：记录说明文件合同**

`releases/notes/README.md` 明确文件必须命名为 `v<SemVer>.md`、必须包含中文、必须与三个版本来源同一提交，Gitee Release 和 `latest.json.notes` 不接受 CI 临时覆盖。

- [x] **步骤 4：用临时副本验证失败路径**

不要在当前版本文件上运行成功准备流程。先运行无效输入：

```powershell
pnpm release:prepare -- invalid-version "中文说明"
```

预期：在任何文件变化前失败并提示版本号不是合法 SemVer。随后运行 `git status --short`，确认只有本任务计划内文件变化。

- [x] **步骤 5：提交版本准备命令**

```powershell
git add package.json scripts/prepare-release.mjs releases/notes/README.md
git commit -m "feat: 增加托管发布版本准备命令"
```

## 任务 3：实现三平台产物归档和汇总

**文件：**

- 新建：`scripts/release-artifacts.mjs`
- 新建：`scripts/release-ci.mjs`

- [x] **步骤 1：定义单平台元数据合同**

`stage-platform` 生成 `platform-metadata.json`：

```json
{
  "schemaVersion": 2,
  "version": "0.2.0-beta.5",
  "commit": "40位Git提交SHA",
  "notes": "非空中文说明",
  "platform": "windows-x86_64",
  "files": {
    "installer": "Trellis.Visual.Console_0.2.0-beta.5_x64-setup.exe",
    "updater": "Trellis.Visual.Console_0.2.0-beta.5_x64-setup.exe",
    "signature": "Trellis.Visual.Console_0.2.0-beta.5_x64-setup.exe.sig"
  },
  "artifacts": [
    { "name": "文件名", "size": 1, "sha256": "64位小写十六进制" }
  ]
}
```

macOS 的 `installer` 为带架构后缀的 DMG，`updater` 为 `.app.tar.gz`；Windows 的 installer/updater 指向同一个 NSIS `setup.exe`，汇总时按文件名去重。

- [x] **步骤 2：实现确定性产物发现与归档**

在 `release-artifacts.mjs` 中提供：

```javascript
export function describePlatformArtifacts(repositoryRoot, version, platform) {}
export async function stagePlatformArtifacts(options) {}
export async function aggregatePlatformMetadata(inputRoot, outputRoot) {}
```

每个平台只允许恰好一个符合当前版本的原始安装包、更新包和签名。发现旧版本、多候选、缺签名或空签名时失败；禁止按修改时间猜测最新文件。

- [x] **步骤 3：实现 CI 命令分派**

`scripts/release-ci.mjs` 首批支持：

```text
release-ci.mjs validate-tag --tag v<版本> --sha <提交>
release-ci.mjs stage-platform --platform <平台键> --version <版本> --sha <提交> --source-root <产物根目录> --output <目录>
release-ci.mjs aggregate --input <Artifact根目录> --output <候选目录>
```

未知命令、未知平台和缺参数必须打印中文用法并返回非零退出码。

- [x] **步骤 4：用临时 fixture 验证三平台汇总**

在 `$env:TEMP` 创建三个最小非空假产物及 `.sig`，通过 `--source-root` 指向各自 fixture 目录，分别运行 `stage-platform` 和 `aggregate`。预期生成 schema 2 汇总元数据、去重的 `SHA256SUMS.txt`，且平台键恰好为三个目标。删除 Windows `.sig` 后重跑，预期在汇总前失败。生产工作流的 `--source-root` 固定指向对应 Tauri target 的 `release/bundle`，不得扫描其他目录。

- [x] **步骤 5：提交平台归档能力**

```powershell
git add scripts/release-artifacts.mjs scripts/release-ci.mjs
git commit -m "feat: 增加三平台发布产物汇总"
```

## 任务 4：实现 Gitee 候选发布与公开清单提交

**文件：**

- 新建：`scripts/release-gitee.mjs`
- 修改：`scripts/release-ci.mjs`
- 修改：`scripts/release-macos.mjs`

- [x] **步骤 1：提取 Gitee API 能力**

`scripts/release-gitee.mjs` 导出：

```javascript
export async function ensureGiteeRelease(metadata, token) {}
export async function uploadReleaseArtifacts(directory, release, metadata, token) {}
export async function verifyAnonymousArtifact(url, expected) {}
export async function createCandidateManifest(directory, metadata, attachments) {}
export async function verifyManifestArtifacts(manifest, metadata) {}
export async function publishManifestWithContentsApi(candidate, token) {}
```

所有 token 只进入请求体或认证配置，不进入 URL、异常文本和日志。远端同名附件只允许同大小、同 SHA-256 复用；异内容必须失败。

- [x] **步骤 2：实现三平台候选清单**

`createCandidateManifest` 必须生成：

```json
{
  "version": "统一SemVer",
  "notes": "releases/notes/v<版本>.md 的原文",
  "pub_date": "UTC RFC3339",
  "platforms": {
    "darwin-aarch64": { "signature": "...", "url": "https://gitee.com/..." },
    "darwin-x86_64": { "signature": "...", "url": "https://gitee.com/..." },
    "windows-x86_64": { "signature": "...", "url": "https://gitee.com/..." }
  }
}
```

生成后直接调用导出的 `validateManifest(manifest, PLATFORM_SETS.all)`，不得写出缺平台候选文件。

- [x] **步骤 3：实现公开清单 Contents API 更新**

`publishManifestWithContentsApi` 先读取 Gitee `main` 的当前 `releases/latest.json` 与文件 SHA，确认候选版本更高，再重新匿名校验候选引用的三个更新包，最后通过 Gitee Contents API 只提交该文件。提交消息固定为：

```text
chore(release): 发布 v<版本> 三平台更新清单
```

API 返回主线已变化、SHA 冲突或版本未递增时失败，不重试强制覆盖。

- [x] **步骤 4：补齐 CI 命令并保持本地脚本兼容**

新增：

```text
release-ci.mjs upload --directory <候选目录>
release-ci.mjs publish-manifest --directory <候选目录>
```

token 仅从 `GITEE_RELEASE_TOKEN` 环境变量读取。`release-macos.mjs` 改为复用 `release-gitee.mjs`，本地仍从钥匙串读取 token 并传入函数。

- [x] **步骤 5：使用无 token fixture 验证前置失败**

运行：

```powershell
Remove-Item Env:GITEE_RELEASE_TOKEN -ErrorAction SilentlyContinue
node scripts/release-ci.mjs upload --directory "$env:TEMP\trellis-release-fixture"
```

预期：在发出网络请求前失败并提示缺少 `GITEE_RELEASE_TOKEN`，日志不包含任何 Secret。

- [x] **步骤 6：提交 Gitee 发布模块**

```powershell
git add scripts/release-gitee.mjs scripts/release-ci.mjs scripts/release-macos.mjs
git commit -m "feat: 增加三平台 Gitee 候选发布"
```

## 任务 5：增加 GitHub Actions 质量与发布工作流

**文件：**

- 新建：`.github/actions/setup-project/action.yml`
- 新建：`.github/workflows/quality.yml`
- 新建：`.github/workflows/release.yml`

- [x] **步骤 1：实现复合环境准备 Action**

`setup-project/action.yml` 使用 `actions/setup-node@v4`、`pnpm/action-setup@v4`、`dtolnay/rust-toolchain` 和 `Swatinem/rust-cache@v2`，统一安装 Node 22、pnpm 10、Rust 1.88 与 `rustfmt/clippy`；当 `rust-target` 非空时安装该唯一目标，然后执行 `pnpm install --frozen-lockfile`。输入只包含 `rust-target`，不得接收 Secret。

- [x] **步骤 2：实现无 Secret 质量工作流**

`quality.yml` 仅授予 `contents: read`，在公开镜像 `main` 推送和 Pull Request 上使用 `ubuntu-24.04`，依次运行：

```text
pnpm check:version
pnpm lint
pnpm typecheck
pnpm build:web
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo check --workspace --all-targets --all-features
```

- [x] **步骤 3：实现标签预检任务**

`release.yml` 只响应 `v*` 标签，配置：

```yaml
permissions:
  contents: read
concurrency:
  group: release-${{ github.ref }}
  cancel-in-progress: false
```

`validate` 使用 `ubuntu-24.04`，调用 `release-ci.mjs validate-tag`，验证 Gitee 同名标签、Gitee `main` 可达关系、三个版本来源和说明文件，并输出 `version`、`commit`。

- [x] **步骤 4：实现三目标标准 Runner 构建**

两个 macOS matrix 项使用 `macos-14`，目标分别为 `aarch64-apple-darwin`、`x86_64-apple-darwin`；Windows 使用 `windows-2022` 与 `x86_64-pc-windows-msvc`。构建环境只注入：

```yaml
TAURI_SIGNING_PRIVATE_KEY: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY }}
TAURI_SIGNING_PRIVATE_KEY_PASSWORD: ${{ secrets.TAURI_SIGNING_PRIVATE_KEY_PASSWORD }}
CI: "true"
```

每项构建后调用 `stage-platform`，再使用 `actions/upload-artifact@v4` 上传，配置 `retention-days: 1` 和 `if-no-files-found: error`。禁止使用 `*-xlarge`、`larger-runner` 或自托管标签。

- [x] **步骤 5：实现汇总上传与人工门禁**

`aggregate` 依赖三个构建任务，使用 `ubuntu-24.04` 下载 Artifact、执行 `aggregate` 与 `upload`，只在该任务注入 `GITEE_RELEASE_TOKEN`。候选目录再次作为保留一天的 Artifact 上传。

`publish` 依赖 `aggregate`，配置：

```yaml
environment: release-production
```

下载候选 Artifact 后运行 `publish-manifest`。GitHub 仓库必须把 `release-production` 配置为需要人工审核；未批准时该 job 不会启动，也不会修改 Gitee 清单。

- [x] **步骤 6：检查工作流结构和 Secret 边界**

运行：

```powershell
rg -n "runs-on:|retention-days:|GITEE_RELEASE_TOKEN|TAURI_SIGNING_PRIVATE_KEY|environment:" .github
rg -n "xlarge|self-hosted" .github
```

预期：仅出现标准 Runner；Artifact 保留期均为 `1`；签名 Secret 只在构建任务，Gitee Token 只在汇总/公开任务，`release-production` 只在公开任务；第二条命令无匹配。

- [x] **步骤 7：提交工作流**

```powershell
git add .github
git commit -m "ci: 增加跨平台托管发布工作流"
```

## 任务 6：更新发布文档与长期合同

**文件：**

- 修改：`README.md`
- 修改：`docs/release/desktop-online-update.md`
- 修改：`.trellis/spec/backend/desktop-updater-contract.md`

- [x] **步骤 1：改写日常发布流程**

文档中的主流程固定为：

```powershell
pnpm release:prepare -- 0.2.0-beta.5 "中文更新说明"
git add package.json Cargo.toml Cargo.lock src-tauri/tauri.conf.json releases/notes/v0.2.0-beta.5.md
git commit -m "chore(release): 升级到 v0.2.0-beta.5"
git tag v0.2.0-beta.5
git push release main
git push release v0.2.0-beta.5
```

随后说明 GitHub 自动构建、候选 Gitee Release、匿名校验和 `release-production` 一次人工批准。删除“日常发布需要分别登录 macOS/Windows 构建机”的表述。

- [x] **步骤 2：记录 GitHub/Gitee 配置**

列出公开 GitHub 镜像、Gitee 推送镜像优先方案、双远端单命令回退方案、三个 Secret 名称、`release-production` 审核者、标准 Runner 与 Artifact 一天保留期。不得在文档中记录 Secret 值。

- [x] **步骤 3：保留故障恢复边界**

保留本地 macOS 三阶段脚本说明，但明确仅为故障恢复；三平台正式清单不能在缺少 Windows 产物时公开。冻结和向前修复规则保持不变。

- [x] **步骤 4：更新 Trellis 长期合同**

在 `.trellis/spec/backend/desktop-updater-contract.md` 记录：Gitee 主线、GitHub 镜像、标签提交合同、三平台齐套、Secret 边界、匿名复验、人工清单门禁、幂等重试和禁止付费 Runner 静默降级。

- [x] **步骤 5：运行文档一致性搜索**

```powershell
rg -n "Windows x64 在线更新发布延后|无人值守托管 CI.*范围外|只发布 macOS|两台构建机" README.md docs/release .trellis/spec
```

预期：不再存在与新合同冲突的旧描述；故障恢复章节可以保留“本地 macOS”字样。

- [x] **步骤 6：提交文档**

```powershell
git add README.md docs/release/desktop-online-update.md .trellis/spec/backend/desktop-updater-contract.md
git commit -m "docs: 记录三平台托管发布流程"
```

## 任务 7：配置公开镜像、Secret 与发布环境

**外部配置：**

- 新建公开 GitHub 仓库 `lnqdev/trellis-visual-console`。
- 配置 Gitee 到 GitHub 的 `main` 与标签同步；若账号不支持，配置仓库级双远端单命令推送。
- 配置 Repository Secrets：`TAURI_SIGNING_PRIVATE_KEY`、`TAURI_SIGNING_PRIVATE_KEY_PASSWORD`、`GITEE_RELEASE_TOKEN`。
- 配置受保护 Environment `release-production`，要求发布者人工审核；发布 job 通过审核后才会启动并读取仓库级 `GITEE_RELEASE_TOKEN`。

- [ ] **步骤 1：验证公开镜像提交一致**

```powershell
git ls-remote https://gitee.com/wanglinqiao/trellis-visual-console.git refs/heads/main
git ls-remote https://github.com/lnqdev/trellis-visual-console.git refs/heads/main
```

预期：两个远端 `main` 返回相同提交 SHA。

- [ ] **步骤 2：验证工作流和 Environment 可见**

在 GitHub Actions 页面确认 `质量检查`、`跨平台发布` 两个工作流已被解析；在 Settings 中确认仓库公开、`release-production` 有必需审核者，Secret 只显示名称且无法回读内容。

- [ ] **步骤 3：运行无 Secret 普通质量工作流**

同步当前 `main` 后确认 `quality.yml` 全部通过，日志中不存在 Secret 名称对应的值，也未创建 Gitee Release。

## 任务 8：执行候选发版与真实三平台验收

**涉及：**

- `releases/notes/v<测试版本>.md`
- 三个版本来源及 `Cargo.lock`
- GitHub Actions 发布运行记录
- Gitee Release 与 `releases/latest.json`
- macOS arm64、macOS x64、Windows x64 已安装客户端

- [ ] **步骤 1：准备测试版本提交与标签**

使用高于当前公开版本的 beta 版本运行 `pnpm release:prepare`，审查版本文件和中文说明，提交并推送 Gitee `main` 与版本标签，等待 GitHub 镜像同步。

- [ ] **步骤 2：验证三目标构建与候选发布**

确认三个构建 job 均使用标准 Runner，产物版本、架构和签名正确；确认 Gitee Release 附件全部可匿名下载，候选清单恰好包含三个平台。

- [ ] **步骤 3：验证人工门禁**

先保持 `release-production` 待批准，匿名读取公开 `latest.json`，确认仍为旧版本；批准后等待 Contents API 提交，确认公开清单变为候选版本。

- [ ] **步骤 4：执行真实升级矩阵**

分别在 macOS arm64、macOS x64、Windows x64 从较低版本执行应用内更新，记录发现版本、中文说明、下载、签名校验、安装/重启、应用数据与已登记项目保留结果。Windows 必须验证确认安装后应用退出并由 NSIS 完成替换。

- [ ] **步骤 5：验证幂等重试与冻结**

重跑同一标签，确认附件未被异内容覆盖、公开清单未产生重复提交。随后演练冻结清单并确认客户端不再发现候选版本，再恢复安全清单或发布更高修复版本。

- [ ] **步骤 6：执行最终质量门禁**

```powershell
pnpm check:version
pnpm lint
pnpm typecheck
pnpm build:web
cargo fmt --all -- --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo check --workspace --all-targets --all-features
pnpm check:update-manifest -- releases/latest.json --platforms all
git status --short
```

预期：所有命令退出码为 `0`，公开清单三平台校验通过，除任务验收记录外工作区干净。

- [ ] **步骤 7：回写任务验收并提交**

逐项勾选 `prd.md` 与本文件中有真实证据的条目，记录 GitHub Actions 运行地址、Gitee Release 地址和三平台升级结果；不得把 Secret 写入任务文档。

```powershell
git add .trellis/tasks/07-22-cross-platform-hosted-release
git commit -m "docs: 记录跨平台托管发布验收"
```

## 回滚点

- 公共模块改造导致本地脚本回归：回退任务 1 提交，不影响现有客户端和公开清单。
- GitHub 工作流失败：不批准 `release-production`，公开清单保持旧版本；修复后重跑同一标签。
- Gitee 候选附件不一致：保留失败记录，不覆盖附件；使用更高版本重新发布。
- 错误清单已公开：立即冻结或撤下 `releases/latest.json`，再发布更高修复版本；不执行客户端降级。
- 标准 Runner 无法构建目标：停止任务并回到设计评审，禁止自动切换付费 Larger Runner 或长期自托管机器。
