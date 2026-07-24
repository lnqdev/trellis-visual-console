/**
 * @author wanglinqiao
 * Date 2026/7/24
 * Time 11:35
 *
 * 从 GitHub Release 下载产物，重建本地 candidate 目录，供本地发布脚本使用。
 */

import { createWriteStream } from "node:fs";
import { mkdir, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { pipeline } from "node:stream/promises";
import { Readable } from "node:stream";
import {
  REPOSITORY_NAME,
  REPOSITORY_OWNER,
  assert,
  calculateFileSha256,
} from "./release-common.mjs";

const GITHUB_API_BASE = "https://api.github.com";

/**
 * 通过代理前缀包装 URL；代理为空时原样返回。
 * 代理格式如 https://gh.lnqdev.top，最终 URL 为 https://gh.lnqdev.top/https://github.com/...
 */
function proxyUrl(url, proxy) {
  if (!proxy) {
    return url;
  }
  return `${proxy.replace(/\/+$/u, "")}/${url}`;
}

/** 通过 GitHub REST API 读取 Release 信息（直接访问，不经过代理）。 */
async function fetchReleaseInfo(tag) {
  const url = `${GITHUB_API_BASE}/repos/${REPOSITORY_OWNER}/${REPOSITORY_NAME}/releases/tags/${encodeURIComponent(tag)}`;
  const response = await fetch(url, {
    headers: {
      "Accept": "application/vnd.github+json",
      "User-Agent": "trellis-release-local/1.0",
    },
    signal: AbortSignal.timeout(30_000),
  });
  assert(response.ok, `GitHub Release 查询失败（HTTP ${response.status}）：${tag}`);
  return response.json();
}

/** 下载单个文件到本地路径，支持代理转发大文件。 */
async function downloadFile(url, destPath, proxy) {
  const finalUrl = proxyUrl(url, proxy);
  const response = await fetch(finalUrl, {
    headers: { "User-Agent": "trellis-release-local/1.0" },
    redirect: "follow",
    signal: AbortSignal.timeout(600_000),
  });
  assert(response.ok && response.body !== null, `文件下载失败（HTTP ${response.status}）：${url}`);
  await pipeline(Readable.fromWeb(response.body), createWriteStream(destPath));
}

/**
 * 从 GitHub Release 下载全部产物，重建 candidate 目录结构。
 * @param {string} tag - 版本标签，如 v1.0.0
 * @param {string} outputRoot - 本地输出目录
 * @param {string|undefined} proxy - 下载代理前缀，如 https://gh.lnqdev.top
 * @returns {Promise<object>} release-metadata.json 解析结果
 */
export async function pullGithubRelease(tag, outputRoot, proxy) {
  console.log(`读取 GitHub Release 信息：${tag}`);
  const release = await fetchReleaseInfo(tag);
  assert(Array.isArray(release.assets) && release.assets.length > 0, `GitHub Release 无附件，构建可能尚未完成：${tag}`);

  // release-metadata.json 是必须存在的，用来校验完整性
  const metadataAsset = release.assets.find((asset) => asset.name === "release-metadata.json");
  assert(metadataAsset !== undefined, `GitHub Release 缺少 release-metadata.json，请确认 CI 已成功完成：${tag}`);

  // 清空并重建输出目录
  await rm(outputRoot, { recursive: true, force: true });
  await mkdir(outputRoot, { recursive: true });

  // 逐个下载附件
  console.log(`共 ${release.assets.length} 个附件，开始下载...`);
  for (const asset of release.assets) {
    const sizeMb = (asset.size / 1024 / 1024).toFixed(1);
    console.log(`  下载 ${asset.name}（${sizeMb} MB）`);
    await downloadFile(asset.browser_download_url, join(outputRoot, asset.name), proxy);
  }

  // 读取元数据并逐一校验 SHA-256，防止下载中断或篡改
  const metadataText = await readFile(join(outputRoot, "release-metadata.json"), "utf8");
  const metadata = JSON.parse(metadataText);
  console.log("校验文件完整性...");
  for (const artifact of metadata.artifacts) {
    const actualHash = await calculateFileSha256(join(outputRoot, artifact.name));
    assert(actualHash === artifact.sha256, `SHA-256 校验失败：${artifact.name}`);
    console.log(`  ✓ ${artifact.name}`);
  }

  console.log(`下载完成，产物目录：${outputRoot}`);
  return metadata;
}
