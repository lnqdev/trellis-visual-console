import { spawnSync } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  CHINESE_PATTERN,
  PLATFORM_KEYS,
  assert,
  calculateFileSha256,
  parseSemver,
} from "./release-common.mjs";

const PLATFORM_CONFIG = {
  "darwin-aarch64": {
    architecture: "aarch64",
    executableArchitecture: "arm64",
    installerDirectory: "dmg",
    updaterDirectory: "macos",
  },
  "darwin-x86_64": {
    architecture: "x64",
    executableArchitecture: "x86_64",
    installerDirectory: "dmg",
    updaterDirectory: "macos",
  },
  "windows-x86_64": {
    architecture: "x64",
    installerDirectory: "nsis",
    updaterDirectory: "nsis",
  },
};

/** 执行平台内容校验命令并返回非敏感标准输出。 */
function runCapture(command, args) {
  const result = spawnSync(command, args, { encoding: "utf8" });
  if (result.error !== undefined) {
    throw result.error;
  }
  assert(result.status === 0, `${command} 执行失败`);
  return result.stdout.trim();
}

/** 返回一个平台的 Tauri 原始产物与唯一发布文件名。 */
export function describePlatformArtifacts(sourceRoot, version, platform) {
  parseSemver(version);
  const config = PLATFORM_CONFIG[platform];
  assert(config !== undefined, `不支持的发布平台：${platform}`);
  if (platform.startsWith("darwin-")) {
    const updaterName = `Trellis.Visual.Console_${version}_${config.architecture}.app.tar.gz`;
    return {
      platform,
      executableArchitecture: config.executableArchitecture,
      installer: {
        source: join(sourceRoot, config.installerDirectory, `Trellis Visual Console_${version}_${config.architecture}.dmg`),
        name: `Trellis.Visual.Console_${version}_${config.architecture}.dmg`,
      },
      updater: {
        source: join(sourceRoot, config.updaterDirectory, "Trellis Visual Console.app.tar.gz"),
        name: updaterName,
      },
      signature: {
        source: join(sourceRoot, config.updaterDirectory, "Trellis Visual Console.app.tar.gz.sig"),
        name: `${updaterName}.sig`,
      },
    };
  }
  const updaterName = `Trellis.Visual.Console_${version}_x64-setup.exe`;
  const updaterSource = join(
    sourceRoot,
    config.updaterDirectory,
    `Trellis Visual Console_${version}_x64-setup.exe`,
  );
  return {
    platform,
    installer: { source: updaterSource, name: updaterName },
    updater: { source: updaterSource, name: updaterName },
    signature: { source: `${updaterSource}.sig`, name: `${updaterName}.sig` },
  };
}

/** 从 macOS 更新压缩包读取版本和 Mach-O 架构，拒绝复用旧包。 */
async function verifyMacosUpdater(version, description) {
  const verificationDirectory = await mkdtemp(join(tmpdir(), "trellis-ci-updater-"));
  const appRoot = "Trellis Visual Console.app/Contents";
  try {
    runCapture("tar", [
      "-xzf",
      description.updater.source,
      "-C",
      verificationDirectory,
      `${appRoot}/Info.plist`,
      `${appRoot}/MacOS/trellis-visual-console`,
    ]);
    const infoPlistPath = join(verificationDirectory, appRoot, "Info.plist");
    const executablePath = join(
      verificationDirectory,
      appRoot,
      "MacOS",
      "trellis-visual-console",
    );
    const bundleVersion = runCapture("plutil", [
      "-extract",
      "CFBundleShortVersionString",
      "raw",
      "-o",
      "-",
      infoPlistPath,
    ]);
    assert(bundleVersion === version, `更新包内部版本错误：期望 ${version}，实际 ${bundleVersion}`);
    const executableType = runCapture("file", [executablePath]);
    assert(
      executableType.includes(description.executableArchitecture),
      `更新包架构错误：期望 ${description.executableArchitecture}，实际 ${executableType}`,
    );
  } finally {
    await rm(verificationDirectory, { recursive: true, force: true });
  }
}

/** 校验并复制一个平台的安装包、更新包和签名。 */
export async function stagePlatformArtifacts(options) {
  const {
    repositoryRoot,
    sourceRoot,
    outputRoot,
    version,
    commit,
    platform,
    verifyPackageContents = true,
  } = options;
  parseSemver(version);
  assert(/^[a-f0-9]{40}$/u.test(commit), `提交 SHA 不正确：${commit}`);
  assert(PLATFORM_KEYS.includes(platform), `不支持的发布平台：${platform}`);
  const notesPath = join(repositoryRoot, "releases", "notes", `v${version}.md`);
  const notes = (await readFile(notesPath, "utf8").catch(() => "")).trim();
  assert(notes !== "" && CHINESE_PATTERN.test(notes), `版本更新说明缺失或不含中文：${notesPath}`);

  const description = describePlatformArtifacts(sourceRoot, version, platform);
  const signature = (await readFile(description.signature.source, "utf8").catch(() => "")).trim();
  assert(signature.length >= 80, `更新签名内容不完整：${description.signature.source}`);
  if (verifyPackageContents && platform.startsWith("darwin-")) {
    await verifyMacosUpdater(version, description);
  }

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  const artifacts = [];
  const copiedNames = new Set();
  for (const artifact of [description.installer, description.updater, description.signature]) {
    if (copiedNames.has(artifact.name)) {
      continue;
    }
    copiedNames.add(artifact.name);
    const sourceStat = await stat(artifact.source).catch(() => null);
    assert(sourceStat?.isFile() === true && sourceStat.size > 0, `缺少构建产物：${artifact.source}`);
    const destination = join(outputRoot, artifact.name);
    await copyFile(artifact.source, destination);
    const destinationStat = await stat(destination);
    artifacts.push({
      name: artifact.name,
      size: destinationStat.size,
      sha256: await calculateFileSha256(destination),
    });
  }
  const metadata = {
    schemaVersion: 2,
    version,
    commit,
    notes,
    platform,
    files: {
      installer: description.installer.name,
      updater: description.updater.name,
      signature: description.signature.name,
    },
    artifacts,
  };
  await writeFile(
    join(outputRoot, "platform-metadata.json"),
    `${JSON.stringify(metadata, null, 2)}\n`,
    "utf8",
  );
  return metadata;
}

/** 递归查找 GitHub 下载后的单平台元数据。 */
async function findMetadataFiles(root) {
  const matches = [];
  for (const entry of await readdir(root, { withFileTypes: true })) {
    const path = join(root, entry.name);
    if (entry.isDirectory()) {
      matches.push(...await findMetadataFiles(path));
    } else if (entry.isFile() && entry.name === "platform-metadata.json") {
      matches.push(path);
    }
  }
  return matches;
}

/** 读取一个平台元数据，并核对 Artifact 内容没有在传递中改变。 */
async function readPlatformMetadata(metadataPath) {
  const metadata = JSON.parse(await readFile(metadataPath, "utf8"));
  assert(metadata.schemaVersion === 2, `平台元数据版本不受支持：${metadataPath}`);
  parseSemver(metadata.version);
  assert(/^[a-f0-9]{40}$/u.test(metadata.commit), `平台提交 SHA 不正确：${metadataPath}`);
  assert(PLATFORM_KEYS.includes(metadata.platform), `平台键不正确：${metadataPath}`);
  assert(
    typeof metadata.notes === "string" && CHINESE_PATTERN.test(metadata.notes),
    `平台更新说明不正确：${metadataPath}`,
  );
  assert(Array.isArray(metadata.artifacts) && metadata.artifacts.length > 0, `平台产物为空：${metadataPath}`);
  const directory = dirname(metadataPath);
  const artifactNames = new Set();
  for (const artifact of metadata.artifacts) {
    assert(basename(artifact.name) === artifact.name, `平台产物文件名不安全：${artifact.name}`);
    assert(!artifactNames.has(artifact.name), `平台产物重复：${artifact.name}`);
    artifactNames.add(artifact.name);
    const artifactPath = join(directory, artifact.name);
    const artifactStat = await stat(artifactPath).catch(() => null);
    assert(artifactStat?.isFile() === true, `平台 Artifact 缺少文件：${artifact.name}`);
    assert(artifactStat.size === artifact.size, `平台 Artifact 大小不一致：${artifact.name}`);
    assert(await calculateFileSha256(artifactPath) === artifact.sha256, `平台 Artifact 哈希不一致：${artifact.name}`);
  }
  for (const field of ["installer", "updater", "signature"]) {
    assert(artifactNames.has(metadata.files?.[field]), `平台文件引用不正确：${metadata.platform}.${field}`);
  }
  return { directory, metadata };
}

/** 合并三个平台元数据并生成后续上传使用的稳定候选目录。 */
export async function aggregatePlatformMetadata(inputRoot, outputRoot) {
  const metadataFiles = await findMetadataFiles(inputRoot);
  assert(metadataFiles.length === PLATFORM_KEYS.length, `平台元数据数量必须为 ${PLATFORM_KEYS.length}，实际为 ${metadataFiles.length}`);
  const entries = await Promise.all(metadataFiles.map(readPlatformMetadata));
  const byPlatform = new Map(entries.map((entry) => [entry.metadata.platform, entry]));
  assert(byPlatform.size === PLATFORM_KEYS.length, "平台元数据包含重复平台");
  for (const platform of PLATFORM_KEYS) {
    assert(byPlatform.has(platform), `缺少平台元数据：${platform}`);
  }
  const [first] = entries;
  for (const entry of entries.slice(1)) {
    assert(entry.metadata.version === first.metadata.version, "三平台版本不一致");
    assert(entry.metadata.commit === first.metadata.commit, "三平台源码提交不一致");
    assert(entry.metadata.notes === first.metadata.notes, "三平台更新说明不一致");
  }

  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });
  const platforms = {};
  const artifacts = [];
  const copied = new Map();
  for (const platform of PLATFORM_KEYS) {
    const entry = byPlatform.get(platform);
    platforms[platform] = entry.metadata.files;
    for (const artifact of entry.metadata.artifacts) {
      const previous = copied.get(artifact.name);
      if (previous !== undefined) {
        assert(previous.sha256 === artifact.sha256, `同名跨平台产物内容不一致：${artifact.name}`);
        continue;
      }
      copied.set(artifact.name, artifact);
      await copyFile(join(entry.directory, artifact.name), join(outputRoot, artifact.name));
      artifacts.push(artifact);
    }
  }
  const checksumText = artifacts
    .map((artifact) => `${artifact.sha256}  ${artifact.name}`)
    .join("\n");
  const checksumPath = join(outputRoot, "SHA256SUMS.txt");
  await writeFile(checksumPath, `${checksumText}\n`, "utf8");
  const checksumStat = await stat(checksumPath);
  artifacts.push({
    name: "SHA256SUMS.txt",
    size: checksumStat.size,
    sha256: await calculateFileSha256(checksumPath),
  });
  const metadata = {
    schemaVersion: 2,
    version: first.metadata.version,
    commit: first.metadata.commit,
    notes: first.metadata.notes,
    preparedAt: new Date().toISOString(),
    platforms,
    artifacts,
  };
  await Promise.all([
    writeFile(join(outputRoot, "RELEASE_NOTES.md"), `${metadata.notes}\n`, "utf8"),
    writeFile(
      join(outputRoot, "release-metadata.json"),
      `${JSON.stringify(metadata, null, 2)}\n`,
      "utf8",
    ),
  ]);
  return metadata;
}
