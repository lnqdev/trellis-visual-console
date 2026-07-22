import { readFile } from "node:fs/promises";

const packageJsonUrl = new URL("../package.json", import.meta.url);
const cargoTomlUrl = new URL("../Cargo.toml", import.meta.url);
const tauriConfigUrl = new URL("../src-tauri/tauri.conf.json", import.meta.url);

/** 读取并解析 UTF-8 JSON 文件。 */
async function readJson(url) {
  return JSON.parse(await readFile(url, "utf8"));
}

/** 从工作区 Cargo 配置中读取版本，避免额外引入 TOML 依赖。 */
async function readWorkspaceCargoVersion() {
  const cargoToml = await readFile(cargoTomlUrl, "utf8");
  const workspacePackage = cargoToml.match(
    /\[workspace\.package\]([\s\S]*?)(?:\n\[|$)/u,
  )?.[1];
  const version = workspacePackage?.match(/^version\s*=\s*"([^"]+)"\s*$/mu)?.[1];
  if (version === undefined) {
    throw new Error("无法从 Cargo.toml 的 [workspace.package] 读取版本");
  }
  return version;
}

/** 校验前端、Rust 工作区与 Tauri 打包版本完全一致。 */
async function main() {
  const packageJson = await readJson(packageJsonUrl);
  const tauriConfig = await readJson(tauriConfigUrl);
  const versions = new Map([
    ["package.json", packageJson.version],
    ["Cargo.toml", await readWorkspaceCargoVersion()],
    ["src-tauri/tauri.conf.json", tauriConfig.version],
  ]);
  const distinctVersions = new Set(versions.values());
  if (distinctVersions.size !== 1) {
    const details = [...versions].map(([file, version]) => `${file}: ${String(version)}`).join("\n");
    throw new Error(`发布版本不一致：\n${details}`);
  }
  const [version] = distinctVersions;
  if (typeof version !== "string" || version.trim() === "") {
    throw new Error("发布版本不能为空");
  }
  console.log(`版本一致性检查通过：${version}`);
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "版本一致性检查失败");
  process.exitCode = 1;
});
