import { spawnSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  assert,
  compareSemver,
  createReleaseNotes,
  parseSemver,
  readCurrentVersion,
  writeVersionFiles,
} from "./release-common.mjs";

const SCRIPT_DIRECTORY = fileURLToPath(new URL(".", import.meta.url));
const REPOSITORY_ROOT = resolve(SCRIPT_DIRECTORY, "..");

/** 执行发布准备子命令并把输出直接交给当前终端。 */
function run(command, args) {
  console.log(`\n> ${command} ${args.join(" ")}`);
  const result = spawnSync(command, args, {
    cwd: REPOSITORY_ROOT,
    stdio: "inherit",
  });
  if (result.error !== undefined) {
    throw result.error;
  }
  assert(result.status === 0, `${command} 执行失败，退出码：${String(result.status)}`);
}

/** 执行只返回非敏感文本的 Git 命令。 */
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

/** 确认版本准备从已同步且干净的 Gitee main 开始。 */
function assertCleanSynchronizedMain() {
  assert(runCapture("git", ["branch", "--show-current"]) === "main", "版本准备必须从 main 分支执行");
  assert(runCapture("git", ["status", "--porcelain"]) === "", "工作区存在未提交修改，请先提交或处理后再准备版本");
  run("git", ["fetch", "origin", "main"]);
  const head = runCapture("git", ["rev-parse", "HEAD"]);
  const remoteHead = runCapture("git", ["rev-parse", "origin/main"]);
  assert(head === remoteHead, "本地 main 与 Gitee origin/main 不一致，请先拉取或推送");
}

/** 同步版本文件并生成与标签提交绑定的中文更新说明。 */
async function prepareRelease(args) {
  const [version, ...noteItems] = args;
  assert(version !== undefined, "用法：pnpm release:prepare -- <版本> <中文说明...>");
  parseSemver(version);
  const notes = createReleaseNotes(noteItems);
  assertCleanSynchronizedMain();

  const currentVersion = await readCurrentVersion(REPOSITORY_ROOT);
  assert(compareSemver(version, currentVersion) > 0, `目标版本必须高于当前版本 ${currentVersion}`);
  const notesDirectory = join(REPOSITORY_ROOT, "releases", "notes");
  const notesPath = join(notesDirectory, `v${version}.md`);
  await mkdir(notesDirectory, { recursive: true });
  await writeVersionFiles(REPOSITORY_ROOT, version);
  await writeFile(notesPath, `${notes}\n`, { encoding: "utf8", flag: "wx" });
  run("cargo", ["check", "-p", "trellis-core"]);
  run("pnpm", ["check:version"]);

  console.log("\n版本准备完成。请审查版本文件、Cargo.lock 与更新说明后提交并创建同版本标签：");
  console.log(`  ${notesPath}`);
}

prepareRelease(process.argv.slice(2).filter((argument) => argument !== "--")).catch((error) => {
  console.error(`\n版本准备失败：${error instanceof Error ? error.message : "未知错误"}`);
  process.exitCode = 1;
});
