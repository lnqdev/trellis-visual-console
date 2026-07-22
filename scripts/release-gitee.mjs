import { createHash } from "node:crypto";
import { openAsBlob } from "node:fs";
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { Readable } from "node:stream";
import {
  REPOSITORY_NAME,
  REPOSITORY_OWNER,
  assert,
  compareSemver,
} from "./release-common.mjs";
import { validateManifest } from "./validate-update-manifest.mjs";

const GITEE_API_BASE_URL = "https://gitee.com/api/v5";
const GITEE_RELEASE_BASE_URL = `https://gitee.com/${REPOSITORY_OWNER}/${REPOSITORY_NAME}/releases/download`;

/** 调用 Gitee JSON API，认证值只进入请求体。 */
async function requestGiteeJson(path, options = {}) {
  const response = await fetch(`${GITEE_API_BASE_URL}${path}`, {
    method: options.method ?? "GET",
    body: options.body,
    signal: AbortSignal.timeout(options.timeoutMs ?? 60_000),
  });
  if (response.status === 404 && options.allowNotFound === true) {
    return null;
  }
  const responseText = await response.text();
  assert(response.ok, `Gitee API 请求失败：HTTP ${response.status} ${responseText.slice(0, 300)}`);
  return responseText === "" ? null : JSON.parse(responseText);
}

/** 创建或复用指向同一源码提交的 Gitee Release。 */
export async function ensureGiteeRelease(metadata, token, targetCommit = metadata.commit) {
  assert(typeof token === "string" && token !== "", "缺少 Gitee 发布令牌");
  assert(/^[a-f0-9]{40}$/u.test(targetCommit), "Gitee Release 缺少合法目标提交");
  const tag = `v${metadata.version}`;
  const encodedTag = encodeURIComponent(tag);
  let release = await requestGiteeJson(
    `/repos/${REPOSITORY_OWNER}/${REPOSITORY_NAME}/releases/tags/${encodedTag}`,
    { allowNotFound: true },
  );
  const fields = new URLSearchParams({
    access_token: token,
    tag_name: tag,
    name: `Trellis Visual Console ${tag}`,
    body: metadata.notes,
    prerelease: String(metadata.version.includes("-")),
  });
  if (release === null) {
    fields.set("target_commitish", targetCommit);
    release = await requestGiteeJson(
      `/repos/${REPOSITORY_OWNER}/${REPOSITORY_NAME}/releases`,
      { method: "POST", body: fields },
    );
    console.log(`已创建 Gitee Release：${tag}`);
  } else {
    assert(
      release.target_commitish === targetCommit,
      `已有 ${tag} Release 未指向目标提交，已拒绝复用`,
    );
    release = await requestGiteeJson(
      `/repos/${REPOSITORY_OWNER}/${REPOSITORY_NAME}/releases/${release.id}`,
      { method: "PATCH", body: fields },
    );
    console.log(`已复用 Gitee Release：${tag}`);
  }
  return release;
}

/** 匿名下载远端附件并校验文件大小与 SHA-256。 */
export async function verifyAnonymousArtifact(url, expected) {
  const response = await fetch(url, {
    redirect: "follow",
    signal: AbortSignal.timeout(300_000),
  });
  assert(response.ok && response.body !== null, `附件无法匿名下载：${expected.name}`);
  const hash = createHash("sha256");
  let size = 0;
  for await (const chunk of Readable.fromWeb(response.body)) {
    hash.update(chunk);
    size += chunk.length;
  }
  assert(size === expected.size, `附件大小不一致：${expected.name}`);
  assert(hash.digest("hex") === expected.sha256, `附件 SHA-256 不一致：${expected.name}`);
}

/** 上传缺失附件；已存在且哈希一致时安全跳过。 */
export async function uploadReleaseArtifacts(releaseDirectory, release, metadata, token) {
  assert(typeof token === "string" && token !== "", "缺少 Gitee 发布令牌");
  const attachmentsPath = `/repos/${REPOSITORY_OWNER}/${REPOSITORY_NAME}/releases/${release.id}/attach_files`;
  let attachments = await requestGiteeJson(`${attachmentsPath}?per_page=100`);
  for (const artifact of metadata.artifacts) {
    const existing = attachments.find((attachment) => attachment.name === artifact.name);
    if (existing !== undefined) {
      await verifyAnonymousArtifact(existing.browser_download_url, artifact);
      console.log(`附件已存在且校验通过，跳过：${artifact.name}`);
      continue;
    }
    const form = new FormData();
    form.set("access_token", token);
    form.set("file", await openAsBlob(join(releaseDirectory, artifact.name)), artifact.name);
    await requestGiteeJson(attachmentsPath, {
      method: "POST",
      body: form,
      timeoutMs: 600_000,
    });
    console.log(`已上传：${artifact.name}`);
    attachments = await requestGiteeJson(`${attachmentsPath}?per_page=100`);
  }
  return attachments;
}

/** 根据真实 Gitee 附件生成指定平台集合的 Tauri 候选清单。 */
export async function createCandidateManifest(
  releaseDirectory,
  metadata,
  attachments,
  platformKeys,
  publishedAt = metadata.preparedAt,
) {
  const platforms = {};
  for (const platform of platformKeys) {
    const files = metadata.platforms[platform];
    assert(files !== undefined, `发布元数据缺少平台：${platform}`);
    const updater = attachments.find((attachment) => attachment.name === files.updater);
    assert(updater !== undefined, `Gitee Release 缺少更新包：${files.updater}`);
    const signature = (await readFile(join(releaseDirectory, files.signature), "utf8")).trim();
    platforms[platform] = {
      signature,
      url: updater.browser_download_url
        ?? `${GITEE_RELEASE_BASE_URL}/v${metadata.version}/${encodeURIComponent(files.updater)}`,
    };
  }
  const manifest = {
    version: metadata.version,
    notes: metadata.notes,
    pub_date: new Date(publishedAt ?? Date.now()).toISOString(),
    platforms,
  };
  validateManifest(manifest, platformKeys);
  const manifestPath = join(releaseDirectory, "latest.json");
  await writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, "utf8");
  return manifestPath;
}

/** 在公开清单前重新匿名校验清单实际引用的更新包。 */
export async function verifyManifestArtifacts(manifest, metadata, platformKeys) {
  for (const platform of platformKeys) {
    const files = metadata.platforms[platform];
    const expected = metadata.artifacts.find((artifact) => artifact.name === files.updater);
    assert(expected !== undefined, `发布元数据缺少更新包：${files.updater}`);
    const manifestArtifact = manifest.platforms[platform];
    assert(manifestArtifact !== undefined, `候选清单缺少平台：${platform}`);
    await verifyAnonymousArtifact(manifestArtifact.url, expected);
    console.log(`公开前匿名校验通过：${files.updater}`);
  }
}

/** 通过 Gitee Contents API 幂等提交唯一公开清单文件。 */
export async function publishManifestWithContentsApi(candidate, token) {
  assert(typeof token === "string" && token !== "", "缺少 Gitee 发布令牌");
  const contentsPath = `/repos/${REPOSITORY_OWNER}/${REPOSITORY_NAME}/contents/releases/latest.json`;
  const currentFile = await requestGiteeJson(`${contentsPath}?ref=main`);
  assert(typeof currentFile?.sha === "string", "无法读取 Gitee 公开清单文件 SHA");
  const currentText = Buffer.from(currentFile.content.replace(/\s/gu, ""), "base64").toString("utf8");
  const currentManifest = JSON.parse(currentText);
  const candidateText = `${JSON.stringify(candidate, null, 2)}\n`;
  if (candidate.version === currentManifest.version) {
    assert(candidateText === currentText, `公开版本 ${candidate.version} 已存在但内容不一致`);
    console.log(`公开清单已经是 ${candidate.version}，无需重复提交`);
    return { unchanged: true };
  }
  assert(
    compareSemver(candidate.version, currentManifest.version) > 0,
    `候选版本必须高于当前公开版本 ${currentManifest.version}`,
  );
  const fields = new URLSearchParams({
    access_token: token,
    content: Buffer.from(candidateText, "utf8").toString("base64"),
    sha: currentFile.sha,
    message: `chore(release): 发布 v${candidate.version} 三平台更新清单`,
    branch: "main",
  });
  const result = await requestGiteeJson(contentsPath, { method: "PUT", body: fields });
  console.log(`公开清单已提交到 Gitee main：v${candidate.version}`);
  return result;
}
