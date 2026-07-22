import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdtemp,
  mkdir,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  REPOSITORY_OWNER,
  assert,
  calculateFileSha256,
  compareSemver,
  createReleaseNotes,
  parseSemver,
  readCurrentVersion,
  readReleaseMetadata,
  writeVersionFiles,
} from "./release-common.mjs";
import {
  createCandidateManifest,
  ensureGiteeRelease,
  uploadReleaseArtifacts,
  verifyAnonymousArtifact,
  verifyManifestArtifacts,
} from "./release-gitee.mjs";
import { PLATFORM_SETS } from "./validate-update-manifest.mjs";

const GITEE_TOKEN_SERVICE = "com.wanglinqiao.trellis-visual-console.gitee-release";
const SIGNING_PASSWORD_SERVICE = "com.wanglinqiao.trellis-visual-console.updater-signing";
const SCRIPT_DIRECTORY = fileURLToPath(new URL(".", import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const RELEASE_ROOT = join(homedir(), "Desktop", "Trellis Visual Console Releases");
const SIGNING_KEY_PATH = join(
  homedir(),
  ".config",
  "trellis-visual-console",
  "updater-signing.key",
);

const PLATFORM_ARTIFACTS = [
  {
    platform: "darwin-aarch64",
    architecture: "aarch64",
    target: "aarch64-apple-darwin",
  },
  {
    platform: "darwin-x86_64",
    architecture: "x64",
    target: "x86_64-apple-darwin",
  },
];

/** 执行发布子命令并把输出直接交给当前终端。 */
function run(command, args, options = {}) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: REPOSITORY_ROOT,
    env: options.env ?? process.env,
    stdio: "inherit",
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  assert(result.status === 0, `${command} 执行失败，退出码：${String(result.status)}`);
}

/** 执行只返回非敏感文本的本地命令。 */
function runCapture(command, args) {
  const result = spawnSync(command, args, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  assert(result.status === 0, `${command} 执行失败`);
  return result.stdout.trim();
}

/** 从 macOS 钥匙串读取敏感值，不把内容写入参数日志。 */
function readKeychainSecret(service) {
  const account = process.env.USER ?? REPOSITORY_OWNER;
  const result = spawnSync(
    "security",
    ["find-generic-password", "-a", account, "-s", service, "-w"],
    { encoding: "utf8" },
  );
  assert(
    result.status === 0 && result.stdout.trim() !== "",
    `macOS 钥匙串中缺少 ${service}，请先按发布指南完成配置`,
  );
  return result.stdout.trim();
}

/** 校验准备阶段从干净且已同步的 main 分支开始。 */
function assertCleanSynchronizedMain() {
  assert(process.platform === "darwin", "macOS 发布脚本只能在 macOS 上运行");
  assert(runCapture("git", ["branch", "--show-current"]) === "main", "发布必须从 main 分支执行");
  assert(runCapture("git", ["status", "--porcelain"]) === "", "工作区存在未提交修改，请先提交或处理后再发布");
  run("git", ["fetch", "origin", "main"]);
  const head = runCapture("git", ["rev-parse", "HEAD"]);
  const remoteHead = runCapture("git", ["rev-parse", "origin/main"]);
  assert(head === remoteHead, "本地 main 与 origin/main 不一致，请先拉取或推送");
}

/** 为 Tauri 构建注入仓库外更新私钥和钥匙串密码。 */
async function loadSigningEnvironment() {
  const privateKey = process.env.TAURI_SIGNING_PRIVATE_KEY
    ?? (await readFile(SIGNING_KEY_PATH, "utf8").catch(() => "")).trim();
  const password = process.env.TAURI_SIGNING_PRIVATE_KEY_PASSWORD
    ?? readKeychainSecret(SIGNING_PASSWORD_SERVICE);
  assert(privateKey !== "", `更新签名私钥为空：${SIGNING_KEY_PATH}`);
  return {
    ...process.env,
    CI: "true",
    TAURI_SIGNING_PRIVATE_KEY: privateKey,
    TAURI_SIGNING_PRIVATE_KEY_PASSWORD: password,
  };
}

/** 返回一个架构的 Tauri 原始产物与唯一发布文件名。 */
function describePlatformArtifacts(version, platform) {
  const bundleRoot = join(
    REPOSITORY_ROOT,
    "target",
    platform.target,
    "release",
    "bundle",
  );
  const updaterName = `Trellis.Visual.Console_${version}_${platform.architecture}.app.tar.gz`;
  return {
    platform: platform.platform,
    installer: {
      source: join(bundleRoot, "dmg", `Trellis Visual Console_${version}_${platform.architecture}.dmg`),
      name: `Trellis.Visual.Console_${version}_${platform.architecture}.dmg`,
    },
    updater: {
      source: join(bundleRoot, "macos", "Trellis Visual Console.app.tar.gz"),
      name: updaterName,
    },
    signature: {
      source: join(bundleRoot, "macos", "Trellis Visual Console.app.tar.gz.sig"),
      name: `${updaterName}.sig`,
    },
  };
}

/** 删除本次构建会重新生成的精确 macOS bundle 产物，禁止复用旧更新包。 */
async function clearGeneratedMacosBundles(version) {
  for (const platform of PLATFORM_ARTIFACTS) {
    const description = describePlatformArtifacts(version, platform);
    const macosBundleDirectory = resolve(description.updater.source, "..");
    await Promise.all([
      rm(join(macosBundleDirectory, "Trellis Visual Console.app"), {
        recursive: true,
        force: true,
      }),
      rm(description.updater.source, { force: true }),
      rm(description.signature.source, { force: true }),
    ]);
  }
}

/** 读取 plist 字段，断言更新压缩包内容与目标版本、架构完全一致。 */
async function verifyUpdaterArchive(version, platform, description) {
  const archiveStat = await stat(description.updater.source).catch(() => null);
  const signatureStat = await stat(description.signature.source).catch(() => null);
  assert(archiveStat?.isFile() === true, `本次构建未生成更新包：${description.updater.source}`);
  assert(signatureStat?.isFile() === true, `本次构建未生成更新签名：${description.signature.source}`);

  const appRoot = "Trellis Visual Console.app/Contents";
  const plistRelativePath = `${appRoot}/Info.plist`;
  const executableRelativePath = `${appRoot}/MacOS/trellis-visual-console`;
  const verificationDirectory = await mkdtemp(join(tmpdir(), "trellis-updater-"));
  try {
    runCapture("tar", [
      "-xzf",
      description.updater.source,
      "-C",
      verificationDirectory,
      plistRelativePath,
      executableRelativePath,
    ]);
    const archiveVersion = runCapture("plutil", [
      "-extract",
      "CFBundleShortVersionString",
      "raw",
      join(verificationDirectory, plistRelativePath),
    ]);
    assert(
      archiveVersion === version,
      `更新包内部版本错误：期望 ${version}，实际 ${archiveVersion}`,
    );

    const executableType = runCapture("file", [
      join(verificationDirectory, executableRelativePath),
    ]);
    const expectedArchitecture = platform.architecture === "aarch64" ? "arm64" : "x86_64";
    assert(
      executableType.includes(expectedArchitecture),
      `更新包架构错误：期望 ${expectedArchitecture}，实际 ${executableType}`,
    );
  } finally {
    await rm(verificationDirectory, { recursive: true, force: true });
  }

  const signature = (await readFile(description.signature.source, "utf8")).trim();
  assert(signature.length >= 80, `更新签名内容不完整：${description.signature.source}`);
}

/** 把双架构产物复制到桌面稳定目录并写入可恢复的发布元数据。 */
async function stageArtifacts(version, notes) {
  const releaseDirectory = join(RELEASE_ROOT, `v${version}`);
  await mkdir(releaseDirectory, { recursive: true });
  const platforms = {};
  const artifacts = [];
  for (const platform of PLATFORM_ARTIFACTS) {
    const description = describePlatformArtifacts(version, platform);
    await verifyUpdaterArchive(version, platform, description);
    platforms[description.platform] = {
      installer: description.installer.name,
      updater: description.updater.name,
      signature: description.signature.name,
    };
    for (const artifact of [description.installer, description.updater, description.signature]) {
      const sourceStat = await stat(artifact.source).catch(() => null);
      assert(sourceStat?.isFile() === true, `缺少构建产物：${artifact.source}`);
      const destination = join(releaseDirectory, artifact.name);
      await copyFile(artifact.source, destination);
      const destinationStat = await stat(destination);
      artifacts.push({
        name: artifact.name,
        size: destinationStat.size,
        sha256: await calculateFileSha256(destination),
      });
    }
  }
  const checksumText = artifacts
    .map((artifact) => `${artifact.sha256}  ${artifact.name}`)
    .join("\n");
  await writeFile(join(releaseDirectory, "SHA256SUMS.txt"), `${checksumText}\n`, "utf8");
  const checksumStat = await stat(join(releaseDirectory, "SHA256SUMS.txt"));
  artifacts.push({
    name: "SHA256SUMS.txt",
    size: checksumStat.size,
    sha256: await calculateFileSha256(join(releaseDirectory, "SHA256SUMS.txt")),
  });
  const metadata = {
    schemaVersion: 1,
    version,
    notes,
    preparedAt: new Date().toISOString(),
    platforms,
    artifacts,
  };
  await Promise.all([
    writeFile(join(releaseDirectory, "RELEASE_NOTES.md"), `${notes}\n`, "utf8"),
    writeFile(
      join(releaseDirectory, "release-metadata.json"),
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8",
    ),
  ]);
  return releaseDirectory;
}

/** 执行版本同步、质量门禁、双架构签名构建与产物整理。 */
async function prepareRelease(args) {
  const [version, ...noteItems] = args;
  assert(version !== undefined, "用法：pnpm release:mac:prepare -- <版本> <中文说明...>");
  parseSemver(version);
  const currentVersion = await readCurrentVersion(REPOSITORY_ROOT);
  assert(compareSemver(version, currentVersion) > 0, `目标版本必须高于当前版本 ${currentVersion}`);
  const notes = createReleaseNotes(noteItems);
  assertCleanSynchronizedMain();
  await writeVersionFiles(REPOSITORY_ROOT, version);
  run("cargo", ["check", "-p", "trellis-core"]);
  run("pnpm", ["install", "--frozen-lockfile"]);
  run("pnpm", ["check:version"]);
  run("pnpm", ["lint"]);
  run("pnpm", ["typecheck"]);
  run("pnpm", ["build:web"]);
  run("cargo", ["fmt", "--all", "--", "--check"]);
  run("cargo", ["clippy", "--workspace", "--all-targets", "--all-features", "--", "-D", "warnings"]);
  run("cargo", ["check", "--workspace", "--all-targets", "--all-features"]);
  const signingEnvironment = await loadSigningEnvironment();
  await clearGeneratedMacosBundles(version);
  run("pnpm", ["build:mac:arm64"], { env: signingEnvironment });
  run("pnpm", ["build:mac:x64"], { env: signingEnvironment });
  const releaseDirectory = await stageArtifacts(version, notes);
  console.log(`\n发布产物已准备：${releaseDirectory}`);
  console.log("请检查版本改动并提交、推送 main，然后执行：");
  console.log(`pnpm release:mac:upload -- ${JSON.stringify(releaseDirectory)}`);
}

/** 从已完成的双架构构建恢复产物校验与归档，不重复执行耗时构建。 */
async function stagePreparedRelease(args) {
  const [version, ...noteItems] = args;
  assert(version !== undefined, "用法：pnpm release:mac:stage -- <版本> <中文说明...>");
  parseSemver(version);
  const currentVersion = await readCurrentVersion(REPOSITORY_ROOT);
  assert(currentVersion === version, `当前代码版本 ${currentVersion} 与待恢复版本 ${version} 不一致`);
  const notes = createReleaseNotes(noteItems);
  assert(process.platform === "darwin", "macOS 发布脚本只能在 macOS 上运行");
  assert(runCapture("git", ["branch", "--show-current"]) === "main", "发布必须从 main 分支执行");
  run("pnpm", ["check:version"]);
  const releaseDirectory = await stageArtifacts(version, notes);
  console.log(`\n发布产物已恢复并完成校验：${releaseDirectory}`);
  console.log("请检查版本改动并提交、推送 main，然后执行：");
  console.log(`pnpm release:mac:upload -- ${JSON.stringify(releaseDirectory)}`);
}

/** 校验上传阶段使用的版本已经提交并推送到 origin/main。 */
async function assertVersionCommittedAndPushed(version) {
  assertCleanSynchronizedMain();
  const currentVersion = await readCurrentVersion(REPOSITORY_ROOT);
  assert(currentVersion === version, `当前代码版本 ${currentVersion} 与发布目录版本 ${version} 不一致`);
  run("pnpm", ["check:version"]);
}

/** 上传产物、执行匿名校验并生成候选清单。 */
async function uploadRelease(args) {
  assert(args.length === 1, "用法：pnpm release:mac:upload -- <发布目录>");
  const releaseDirectory = resolve(args[0]);
  const metadata = await readReleaseMetadata(
    releaseDirectory,
    PLATFORM_ARTIFACTS.map((platform) => platform.platform),
  );
  await assertVersionCommittedAndPushed(metadata.version);
  const token = readKeychainSecret(GITEE_TOKEN_SERVICE);
  const release = await ensureGiteeRelease(
    metadata,
    token,
    runCapture("git", ["rev-parse", "HEAD"]),
  );
  const attachments = await uploadReleaseArtifacts(
    releaseDirectory,
    release,
    metadata,
    token,
  );
  for (const artifact of metadata.artifacts) {
    const attachment = attachments.find((candidate) => candidate.name === artifact.name);
    assert(attachment !== undefined, `Gitee Release 缺少附件：${artifact.name}`);
    await verifyAnonymousArtifact(attachment.browser_download_url, artifact);
    console.log(`匿名校验通过：${artifact.name}`);
  }
  const manifestPath = await createCandidateManifest(
    releaseDirectory,
    metadata,
    attachments,
    PLATFORM_SETS.macos,
    release.created_at,
  );
  console.log(`\n候选更新清单已生成：${manifestPath}`);
  console.log("确认 Release 页面和候选清单后，执行：");
  console.log(`pnpm release:mac:publish -- ${JSON.stringify(releaseDirectory)}`);
}

/** 校验候选版本单调递增后，将其写入仓库公开清单位置。 */
async function publishManifest(args) {
  assert(args.length === 1, "用法：pnpm release:mac:publish -- <发布目录>");
  const releaseDirectory = resolve(args[0]);
  const metadata = await readReleaseMetadata(
    releaseDirectory,
    PLATFORM_ARTIFACTS.map((platform) => platform.platform),
  );
  await assertVersionCommittedAndPushed(metadata.version);
  const candidatePath = join(releaseDirectory, "latest.json");
  const candidateText = await readFile(candidatePath, "utf8").catch(() => null);
  assert(candidateText !== null, `发布目录缺少候选 latest.json：${releaseDirectory}`);
  let candidate;
  try {
    candidate = JSON.parse(candidateText);
  } catch {
    throw new Error(`候选清单不是合法 JSON：${candidatePath}`);
  }
  assert(candidate.version === metadata.version, "候选清单与发布元数据版本不一致");
  run("node", ["scripts/validate-update-manifest.mjs", candidatePath, "--platforms", "macos"]);
  await verifyManifestArtifacts(candidate, metadata, PLATFORM_SETS.macos);
  const publicManifestPath = join(REPOSITORY_ROOT, "releases", "latest.json");
  const currentManifest = await readFile(publicManifestPath, "utf8")
    .then((content) => JSON.parse(content))
    .catch(() => null);
  if (currentManifest !== null) {
    assert(
      compareSemver(candidate.version, currentManifest.version) > 0,
      `候选版本必须高于当前公开版本 ${currentManifest.version}`,
    );
  }
  await copyFile(candidatePath, publicManifestPath);
  run("node", ["scripts/validate-update-manifest.mjs", publicManifestPath, "--platforms", "macos"]);
  console.log(`\n公开清单已写入：${publicManifestPath}`);
  console.log("脚本没有提交或推送。请检查 git diff，确认后再提交并推送 main。");
}

/** 打印安全的三阶段 macOS 发布用法。 */
function printHelp() {
  console.log(`macOS 在线更新发布脚本

准备版本并构建：
  pnpm release:mac:prepare -- <版本> <中文说明...>

构建完成但归档失败时，从现有产物恢复：
  pnpm release:mac:stage -- <版本> <中文说明...>

创建 Gitee Release、上传并匿名校验：
  pnpm release:mac:upload -- <发布目录>

确认后写入公开 latest.json：
  pnpm release:mac:publish -- <发布目录>

默认发布目录：
  ${RELEASE_ROOT}/v<版本>`);
}

/** 分派发布阶段，未知命令只展示帮助且返回失败。 */
async function main() {
  const [command, ...args] = process.argv.slice(2).filter((argument) => argument !== "--");
  if (command === undefined || command === "help" || command === "--help") {
    printHelp();
    return;
  }
  if (command === "prepare") {
    await prepareRelease(args);
    return;
  }
  if (command === "stage") {
    await stagePreparedRelease(args);
    return;
  }
  if (command === "upload") {
    await uploadRelease(args);
    return;
  }
  if (command === "publish-manifest") {
    await publishManifest(args);
    return;
  }
  throw new Error(`未知发布阶段：${command}`);
}

main().catch((error) => {
  console.error(`\n发布失败：${error instanceof Error ? error.message : "未知错误"}`);
  process.exitCode = 1;
});
