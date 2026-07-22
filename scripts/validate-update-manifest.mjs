import { readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

export const PLATFORM_SETS = {
  all: ["darwin-aarch64", "darwin-x86_64", "windows-x86_64"],
  macos: ["darwin-aarch64", "darwin-x86_64"],
};
const SEMVER_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?(?:\+[0-9A-Za-z-]+(?:\.[0-9A-Za-z-]+)*)?$/u;
const CHINESE_PATTERN = /[\u3400-\u4dbf\u4e00-\u9fff]/u;
const BASE64_PATTERN = /^[A-Za-z0-9+/]+={0,2}$/u;

/** 断言条件成立，并提供可直接处理的发布错误。 */
function assert(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

/** 断言对象只包含指定键，避免清单拼写错误被静默忽略。 */
function assertExactKeys(value, expectedKeys, field) {
  assert(value !== null && typeof value === "object" && !Array.isArray(value), `${field} 必须是对象`);
  const actualKeys = Object.keys(value).sort();
  const expected = [...expectedKeys].sort();
  assert(JSON.stringify(actualKeys) === JSON.stringify(expected), `${field} 的字段必须恰好为：${expected.join("、")}`);
}

/** 校验单个平台产物地址与 Tauri 签名。 */
function validatePlatform(platform, artifact, version) {
  assertExactKeys(artifact, ["signature", "url"], `platforms.${platform}`);
  assert(typeof artifact.url === "string", `${platform}.url 必须是字符串`);
  const url = new URL(artifact.url);
  assert(url.protocol === "https:", `${platform}.url 必须使用 HTTPS`);
  assert(url.hostname === "gitee.com", `${platform}.url 必须指向批准的 Gitee 域名`);
  assert(url.username === "" && url.password === "", `${platform}.url 禁止包含认证信息`);
  assert(url.search === "" && url.hash === "", `${platform}.url 禁止包含查询参数或片段`);
  assert(
    url.pathname.startsWith("/wanglinqiao/trellis-visual-console/releases/download/"),
    `${platform}.url 必须指向当前仓库的 Gitee Release`,
  );
  assert(decodeURIComponent(url.pathname).includes(version), `${platform}.url 必须包含统一版本号 ${version}`);

  assert(typeof artifact.signature === "string", `${platform}.signature 必须是字符串`);
  const signature = artifact.signature.replace(/\s/gu, "");
  assert(signature.length >= 80 && BASE64_PATTERN.test(signature), `${platform}.signature 必须是完整的 Base64 Tauri 签名`);
}

/** 校验静态更新清单的版本、中文说明和指定平台产物。 */
export function validateManifest(manifest, platformKeys) {
  assertExactKeys(manifest, ["notes", "platforms", "pub_date", "version"], "清单根对象");
  assert(typeof manifest.version === "string" && SEMVER_PATTERN.test(manifest.version), "version 必须是合法 SemVer");
  assert(typeof manifest.notes === "string" && manifest.notes.trim() !== "", "notes 不能为空");
  assert(CHINESE_PATTERN.test(manifest.notes), "notes 必须包含中文更新说明");
  assert(typeof manifest.pub_date === "string" && manifest.pub_date.endsWith("Z"), "pub_date 必须是 UTC RFC 3339 时间");
  assert(!Number.isNaN(Date.parse(manifest.pub_date)), "pub_date 不是有效时间");
  assertExactKeys(manifest.platforms, platformKeys, "platforms");
  for (const platform of platformKeys) {
    validatePlatform(platform, manifest.platforms[platform], manifest.version);
  }
}

/** 解析清单路径与平台集合；默认继续执行三平台正式发布校验。 */
function parseArguments(arguments_) {
  const args = arguments_.filter((argument) => argument !== "--");
  const platformsIndex = args.indexOf("--platforms");
  const platformSetName = platformsIndex === -1 ? "all" : args[platformsIndex + 1];
  const platformKeys = PLATFORM_SETS[platformSetName];
  assert(platformKeys !== undefined, "--platforms 仅支持 all 或 macos");
  if (platformsIndex !== -1) {
    args.splice(platformsIndex, 2);
  }
  assert(args.length === 1, "用法：pnpm check:update-manifest -- <清单路径> [--platforms all|macos]");
  return { manifestPath: args[0], platformKeys };
}

/** 从命令行读取候选清单并执行发布前校验。 */
async function main() {
  const { manifestPath, platformKeys } = parseArguments(process.argv.slice(2));
  const absolutePath = resolve(manifestPath);
  const manifest = JSON.parse(await readFile(absolutePath, "utf8"));
  validateManifest(manifest, platformKeys);
  console.log(`更新清单校验通过：${absolutePath}`);
}

if (process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : "更新清单校验失败");
    process.exitCode = 1;
  });
}
