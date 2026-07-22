import { spawnSync } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  CHINESE_PATTERN,
  REPOSITORY_NAME,
  REPOSITORY_OWNER,
  assert,
  parseSemver,
  readCurrentVersion,
} from "./release-common.mjs";
import {
  aggregatePlatformMetadata,
  stagePlatformArtifacts,
} from "./release-artifacts.mjs";

const SCRIPT_DIRECTORY = fileURLToPath(new URL(".", import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");
const GITEE_REPOSITORY_URL = `https://gitee.com/${REPOSITORY_OWNER}/${REPOSITORY_NAME}.git`;

/** 把 --key value 参数解析为稳定对象。 */
function parseOptions(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index];
    const value = args[index + 1];
    assert(key?.startsWith("--") === true && value !== undefined, `发布参数不完整：${key ?? "空"}`);
    const name = key.slice(2);
    assert(options[name] === undefined, `发布参数重复：--${name}`);
    options[name] = value;
  }
  return options;
}

/** 读取一个必填命令参数，阻止底层 API 泄漏英文类型错误。 */
function requiredOption(options, name) {
  const value = options[name];
  assert(typeof value === "string" && value !== "", `缺少必填发布参数：--${name}`);
  return value;
}

/** 执行 Git 校验命令并返回非敏感输出。 */
function runGit(args, options = {}) {
  const result = spawnSync("git", args, {
    cwd: REPOSITORY_ROOT,
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : undefined,
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  assert(result.status === 0, `git ${args[0]} 执行失败`);
  return result.stdout?.trim() ?? "";
}

/** 输出 GitHub job outputs，本地执行时则打印 JSON。 */
async function writeOutputs(values) {
  const outputPath = process.env.GITHUB_OUTPUT;
  if (outputPath === undefined || outputPath === "") {
    console.log(JSON.stringify(values));
    return;
  }
  const content = Object.entries(values)
    .map(([key, value]) => `${key}=${value}`)
    .join("\n");
  await appendFile(outputPath, `${content}\n`, "utf8");
}

/** 校验 GitHub 标签与 Gitee 主线、版本来源和说明文件一致。 */
async function validateTag(options) {
  const tag = requiredOption(options, "tag");
  const sha = requiredOption(options, "sha");
  assert(typeof tag === "string" && tag.startsWith("v"), "标签必须使用 v<SemVer> 格式");
  const version = tag.slice(1);
  parseSemver(version);
  assert(/^[a-f0-9]{40}$/u.test(sha), `提交 SHA 不正确：${String(sha)}`);
  assert(await readCurrentVersion(REPOSITORY_ROOT) === version, "标签版本与源码版本不一致");
  const notesPath = resolve(REPOSITORY_ROOT, "releases", "notes", `${tag}.md`);
  const notes = (await readFile(notesPath, "utf8").catch(() => "")).trim();
  assert(notes !== "" && CHINESE_PATTERN.test(notes), `版本更新说明缺失或不含中文：${notesPath}`);

  const tagRefs = runGit([
    "ls-remote",
    GITEE_REPOSITORY_URL,
    `refs/tags/${tag}`,
    `refs/tags/${tag}^{}`,
  ]).split(/\r?\n/u).filter(Boolean);
  assert(tagRefs.length > 0, `Gitee 缺少版本标签：${tag}`);
  const peeled = tagRefs.find((line) => line.endsWith(`refs/tags/${tag}^{}`)) ?? tagRefs[0];
  assert(peeled.split(/\s+/u)[0] === sha, "GitHub 与 Gitee 同名标签指向不同提交");
  runGit(["fetch", "--no-tags", GITEE_REPOSITORY_URL, "main"]);
  runGit(["merge-base", "--is-ancestor", sha, "FETCH_HEAD"]);
  await writeOutputs({ version, commit: sha, notes_path: `releases/notes/${tag}.md` });
}

/** 展示稳定 CI 发布命令。 */
function printHelp() {
  console.log(`跨平台托管发布脚本

标签预检：
  pnpm release:ci -- validate-tag --tag v<版本> --sha <提交>

单平台归档：
  pnpm release:ci -- stage-platform --platform <平台键> --version <版本> --sha <提交> --source-root <产物根目录> --output <目录>

三平台汇总：
  pnpm release:ci -- aggregate --input <Artifact根目录> --output <候选目录>`);
}

/** 分派托管发布阶段。 */
async function main() {
  const [command, ...args] = process.argv.slice(2).filter((argument) => argument !== "--");
  if (command === undefined || command === "help" || command === "--help") {
    printHelp();
    return;
  }
  const options = parseOptions(args);
  if (command === "validate-tag") {
    await validateTag(options);
    return;
  }
  if (command === "stage-platform") {
    await stagePlatformArtifacts({
      repositoryRoot: REPOSITORY_ROOT,
      sourceRoot: resolve(requiredOption(options, "source-root")),
      outputRoot: resolve(requiredOption(options, "output")),
      version: requiredOption(options, "version"),
      commit: requiredOption(options, "sha"),
      platform: requiredOption(options, "platform"),
    });
    return;
  }
  if (command === "aggregate") {
    await aggregatePlatformMetadata(
      resolve(requiredOption(options, "input")),
      resolve(requiredOption(options, "output")),
    );
    return;
  }
  throw new Error(`未知发布阶段：${command}`);
}

main().catch((error) => {
  console.error(`\n托管发布失败：${error instanceof Error ? error.message : "未知错误"}`);
  process.exitCode = 1;
});
