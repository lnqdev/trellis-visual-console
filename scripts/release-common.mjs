import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { readFile, stat, writeFile } from "node:fs/promises";
import { basename, join } from "node:path";

export const REPOSITORY_OWNER = "wanglinqiao";
export const REPOSITORY_NAME = "trellis-visual-console";
export const PLATFORM_KEYS = [
  "darwin-aarch64",
  "darwin-x86_64",
  "windows-x86_64",
];

export const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-([0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*))?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
export const CHINESE_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff]/u;
const SHA256_PATTERN = /^[a-f0-9]{64}$/u;

/** 断言发布前置条件，并提供可直接处理的中文错误。 */
export function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/** 解析 SemVer 为可比较的核心版本与预发布标识。 */
export function parseSemver(version) {
  const match = SEMVER_PATTERN.exec(version);
  assert(match !== null, `版本号不是合法 SemVer：${version}`);
  return {
    core: [Number(match[1]), Number(match[2]), Number(match[3])],
    prerelease: match[4]?.split(".") ?? [],
  };
}

/** 按 SemVer 规则比较两个版本；大于时返回正数。 */
export function compareSemver(left, right) {
  const parsedLeft = parseSemver(left);
  const parsedRight = parseSemver(right);
  for (let index = 0; index < parsedLeft.core.length; index += 1) {
    if (parsedLeft.core[index] !== parsedRight.core[index]) {
      return parsedLeft.core[index] - parsedRight.core[index];
    }
  }
  if (parsedLeft.prerelease.length === 0 || parsedRight.prerelease.length === 0) {
    return parsedLeft.prerelease.length === parsedRight.prerelease.length
      ? 0
      : parsedLeft.prerelease.length === 0
        ? 1
        : -1;
  }
  const length = Math.max(parsedLeft.prerelease.length, parsedRight.prerelease.length);
  for (let index = 0; index < length; index += 1) {
    const leftPart = parsedLeft.prerelease[index];
    const rightPart = parsedRight.prerelease[index];
    if (leftPart === undefined || rightPart === undefined) {
      return leftPart === rightPart ? 0 : leftPart === undefined ? -1 : 1;
    }
    if (leftPart === rightPart) {
      continue;
    }
    const leftNumeric = /^\d+$/u.test(leftPart);
    const rightNumeric = /^\d+$/u.test(rightPart);
    if (leftNumeric && rightNumeric) {
      return Number(leftPart) - Number(rightPart);
    }
    if (leftNumeric !== rightNumeric) {
      return leftNumeric ? -1 : 1;
    }
    return leftPart.localeCompare(rightPart, "en");
  }
  return 0;
}

/** 生成固定格式的中文 Release 和应用内更新说明。 */
export function createReleaseNotes(noteItems) {
  assert(noteItems.length > 0, "至少需要一条中文更新说明");
  for (const note of noteItems) {
    assert(note.trim() !== "" && CHINESE_PATTERN.test(note), `更新说明必须包含中文：${note}`);
  }
  const bullets = noteItems.map((note) => `- ${note.trim()}`).join("\n");
  return `## 更新内容\n\n${bullets}\n\n## 内测安装提示\n\nmacOS 首次打开如被 Gatekeeper 拦截，请在“系统设置 > 隐私与安全性”中确认打开；Windows 未签名内测包可能显示 SmartScreen 提示。本版本不包含 Apple Developer ID、公证或 Windows 商业代码签名。`;
}

/** 归一化版本说明换行，避免不同 Runner 的 checkout 策略改变发布元数据。 */
export function normalizeReleaseNotes(notes) {
  return notes.replace(/\r\n?/gu, "\n").trim();
}

/** 读取当前 package.json 版本。 */
export async function readCurrentVersion(repositoryRoot) {
  const packageJson = JSON.parse(
    await readFile(join(repositoryRoot, "package.json"), "utf8"),
  );
  assert(typeof packageJson.version === "string", "package.json 缺少版本号");
  return packageJson.version;
}

/** 使用结构化 JSON 和受限 TOML 区块同步三个版本来源。 */
export async function writeVersionFiles(repositoryRoot, version) {
  parseSemver(version);
  const packageJsonPath = join(repositoryRoot, "package.json");
  const tauriConfigPath = join(repositoryRoot, "src-tauri", "tauri.conf.json");
  const cargoTomlPath = join(repositoryRoot, "Cargo.toml");
  const packageJson = JSON.parse(await readFile(packageJsonPath, "utf8"));
  const tauriConfig = JSON.parse(await readFile(tauriConfigPath, "utf8"));
  const cargoToml = await readFile(cargoTomlPath, "utf8");
  const workspacePackagePattern = /(\[workspace\.package\][\s\S]*?^version\s*=\s*")[^"]+("\s*$)/mu;
  assert(workspacePackagePattern.test(cargoToml), "Cargo.toml 缺少 workspace.package.version");
  packageJson.version = version;
  tauriConfig.version = version;
  await Promise.all([
    writeFile(packageJsonPath, `${JSON.stringify(packageJson, null, 2)}\n`, "utf8"),
    writeFile(tauriConfigPath, `${JSON.stringify(tauriConfig, null, 2)}\n`, "utf8"),
    writeFile(cargoTomlPath, cargoToml.replace(workspacePackagePattern, `$1${version}$2`), "utf8"),
  ]);
}

/** 流式计算文件 SHA-256，避免把安装包整体读入内存。 */
export async function calculateFileSha256(filePath) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) {
    hash.update(chunk);
  }
  return hash.digest("hex");
}

/** 校验发布元数据中的单个纯文件名引用。 */
function assertArtifactName(name, artifactNames, field) {
  assert(
    typeof name === "string" && basename(name) === name && artifactNames.has(name),
    `发布元数据的平台文件不正确：${field}`,
  );
}

/** 读取并验证本地或 CI 生成的发布元数据。 */
export async function readReleaseMetadata(releaseDirectory, expectedPlatforms) {
  const metadataPath = join(releaseDirectory, "release-metadata.json");
  const metadataText = await readFile(metadataPath, "utf8").catch(() => null);
  assert(metadataText !== null, `发布目录缺少 release-metadata.json：${releaseDirectory}`);
  let metadata;
  try {
    metadata = JSON.parse(metadataText);
  } catch {
    throw new Error(`发布元数据不是合法 JSON：${metadataPath}`);
  }
  assert([1, 2].includes(metadata.schemaVersion), "发布元数据版本不受支持");
  parseSemver(metadata.version);
  assert(
    typeof metadata.notes === "string" && CHINESE_PATTERN.test(metadata.notes),
    "发布元数据缺少中文说明",
  );
  assert(Array.isArray(metadata.artifacts) && metadata.artifacts.length > 0, "发布元数据缺少产物");
  for (const artifact of metadata.artifacts) {
    assert(
      typeof artifact.name === "string" && basename(artifact.name) === artifact.name,
      "发布元数据包含不安全的产物文件名",
    );
    assert(Number.isSafeInteger(artifact.size) && artifact.size > 0, `产物大小不正确：${artifact.name}`);
    assert(SHA256_PATTERN.test(artifact.sha256), `产物 SHA-256 不正确：${artifact.name}`);
    const artifactStat = await stat(join(releaseDirectory, artifact.name)).catch(() => null);
    assert(artifactStat?.isFile() === true, `发布目录缺少元数据登记的产物：${artifact.name}`);
  }
  const artifactNames = new Set(metadata.artifacts.map((artifact) => artifact.name));
  for (const platform of expectedPlatforms) {
    const files = metadata.platforms?.[platform];
    assert(files !== undefined, `发布元数据缺少平台：${platform}`);
    for (const field of ["installer", "updater", "signature"]) {
      assertArtifactName(files[field], artifactNames, `${platform}.${field}`);
    }
  }
  return metadata;
}
