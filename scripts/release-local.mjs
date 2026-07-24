/**
 * @author wanglinqiao
 * Date 2026/7/24
 * Time 11:35
 *
 * 本地发布脚本：CI 构建完成后，在本地将 GitHub Release 产物同步到 Gitee。
 * 使用方式：
 *   pnpm release:local -- upload-to-gitee --tag v1.0.0
 *   pnpm release:local -- upload-to-gitee --tag v1.0.0 --proxy https://gh.lnqdev.top
 */

import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { PLATFORM_KEYS, assert, parseSemver } from "./release-common.mjs";
import { pullGithubRelease } from "./release-github.mjs";
import {
  createCandidateManifest,
  ensureGiteeRelease,
  publishManifestWithContentsApi,
  uploadReleaseArtifacts,
  verifyAnonymousArtifact,
  verifyManifestArtifacts,
} from "./release-gitee.mjs";
import { readReleaseMetadata } from "./release-common.mjs";
import { PLATFORM_SETS, validateManifest } from "./validate-update-manifest.mjs";

const SCRIPT_DIRECTORY = fileURLToPath(new URL(".", import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");

/** 把 --key value 参数解析为稳定对象。 */
function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    assert(key?.startsWith("--") === true && value !== undefined, `参数不完整：${key ?? "空"}`);
    options[key.slice(2)] = value;
  }
  return options;
}

/** 读取 Gitee Token，只从环境变量读取，不从命令行参数传入。 */
function readGiteeToken() {
  const token = process.env.GITEE_RELEASE_TOKEN;
  assert(typeof token === "string" && token !== "", "缺少环境变量 GITEE_RELEASE_TOKEN，请先 export GITEE_RELEASE_TOKEN=<your-token>");
  return token;
}

/**
 * 主命令：从 GitHub Release 下载产物，上传到 Gitee Release，并发布 latest.json。
 * --tag     必填，版本标签，如 v1.0.0
 * --proxy   可选，下载代理前缀，如 https://gh.lnqdev.top（国内建议传入）
 */
async function uploadToGitee(options) {
  const tag = options.tag;
  assert(typeof tag === "string" && tag.startsWith("v"), "--tag 必须是 v<SemVer> 格式，如 v1.0.0");
  parseSemver(tag.slice(1));

  const proxy = options.proxy;
  const token = readGiteeToken();

  // 使用系统临时目录存放下载产物，脚本结束后清理
  const workDir = await mkdtemp(resolve(tmpdir(), "trellis-local-release-"));
  try {
    // 第一步：从 GitHub Release 下载全部产物
    console.log("\n[1/4] 从 GitHub Release 下载产物...");
    await pullGithubRelease(tag, workDir, proxy);

    // 读取并验证本地元数据
    const metadata = await readReleaseMetadata(workDir, PLATFORM_KEYS);

    // 第二步：在 Gitee 创建或复用 Release
    console.log("\n[2/4] 创建 Gitee Release...");
    const release = await ensureGiteeRelease(metadata, token);

    // 第三步：上传附件到 Gitee Release
    console.log("\n[3/4] 上传产物到 Gitee Release...");
    const attachments = await uploadReleaseArtifacts(workDir, release, metadata, token);

    // 匿名校验附件可访问性
    for (const artifact of metadata.artifacts) {
      const attachment = attachments.find((a) => a.name === artifact.name);
      assert(attachment !== undefined, `Gitee Release 缺少附件：${artifact.name}`);
      await verifyAnonymousArtifact(attachment.browser_download_url, artifact);
      console.log(`  匿名校验通过：${artifact.name}`);
    }

    // 生成候选 latest.json（含 Gitee 真实下载地址和签名）
    const manifestPath = await createCandidateManifest(
      workDir,
      metadata,
      attachments,
      PLATFORM_SETS.all,
      release.created_at,
    );
    console.log(`  候选清单已生成：${manifestPath}`);

    // 第四步：发布 latest.json 到 Gitee 仓库 main 分支
    console.log("\n[4/4] 发布 latest.json 到 Gitee...");
    const candidate = JSON.parse(
      await import("node:fs/promises").then((m) =>
        m.readFile(manifestPath, "utf8"),
      ),
    );
    validateManifest(candidate, PLATFORM_SETS.all);
    assert(candidate.version === metadata.version, "候选清单版本与发布元数据不一致");
    await verifyManifestArtifacts(candidate, metadata, PLATFORM_SETS.all);
    await publishManifestWithContentsApi(candidate, token);

    console.log(`\n✅ 发布完成：v${metadata.version} 已同步到 Gitee`);
  } finally {
    // 清理临时目录
    await rm(workDir, { recursive: true, force: true });
  }
}

/** 展示本地发布命令帮助。 */
function printHelp() {
  console.log(`本地发布脚本：将 GitHub Release 同步到 Gitee

命令：
  upload-to-gitee --tag <标签> [--proxy <代理地址>]

示例：
  # 直接访问（网络畅通时）
  pnpm release:local -- upload-to-gitee --tag v1.0.0

  # 通过代理下载（国内推荐）
  pnpm release:local -- upload-to-gitee --tag v1.0.0 --proxy https://gh.lnqdev.top

前置条件：
  export GITEE_RELEASE_TOKEN=<your-gitee-token>
`);
}

/** 分派本地发布命令。 */
async function main() {
  const [command, ...args] = process.argv.slice(2).filter((a) => a !== "--");
  if (command === undefined || command === "help" || command === "--help") {
    printHelp();
    return;
  }
  const options = parseOptions(args);
  if (command === "upload-to-gitee") {
    await uploadToGitee(options);
    return;
  }
  throw new Error(`未知命令：${command}，运行 pnpm release:local -- help 查看帮助`);
}

main().catch((error) => {
  console.error(`\n❌ 本地发布失败：${error instanceof Error ? error.message : "未知错误"}`);
  process.exitCode = 1;
});
