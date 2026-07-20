import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertStableVersion, extractReleaseNotes, replaceReadmeVersion, replaceSampleVersion } from "./release-metadata.mjs";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 读取并解析一个仓库内 JSON 文件。
 *
 * @param {string} filePath JSON 文件绝对路径。
 * @return {Record<string, unknown>} JSON 对象。
 * @throws {Error} 当文件不是对象结构时抛出，避免同步脚本覆盖异常文件。
 */
function readJsonObject(filePath) {
  const value = JSON.parse(readFileSync(filePath, "utf8"));

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${filePath} 必须是 JSON 对象。`);
  }

  return value;
}

/**
 * 将 JSON 对象以项目统一缩进写回文件。
 *
 * 版本同步会同时更新多个事实来源；统一格式能保持版本提交可审阅，且不会因压缩 JSON
 * 让后续更新记录与配置变更混淆。
 *
 * @param {string} filePath JSON 文件绝对路径。
 * @param {Record<string, unknown>} value 待写入 JSON 对象。
 * @return {void}
 */
function writeJsonObject(filePath, value) {
  writeFileSync(filePath, `${JSON.stringify(value, null, 2)}\n`);
}

/**
 * 同步项目所有用户可见版本字段。
 *
 * 先完成更新记录验证和所有新文本计算，再开始写文件；这样任一前置条件失败时不会留下
 * 只更新了一半版本号的工作区。package-lock 存在时也同步根包版本，确保 npm ci 可复现。
 *
 * @param {{ rootDir?: string, version: string }} input 同步根目录和目标版本。
 * @return {{ version: string, files: string[] }} 已同步版本与受影响文件列表。
 * @throws {Error} 当更新记录不满足正式发布规则时抛出且不写入任何文件。
 */
export function syncProjectVersion({ rootDir = ROOT_DIR, version }) {
  assertStableVersion(version);

  const packagePath = resolve(rootDir, "package.json");
  const manifestPath = resolve(rootDir, "manifest.json");
  const readmePath = resolve(rootDir, "README.md");
  const mainPath = resolve(rootDir, "src/workbench/main.js");
  const changelogPath = resolve(rootDir, "CHANGELOG.md");
  const packageLockPath = resolve(rootDir, "package-lock.json");
  const changelog = readFileSync(changelogPath, "utf8");
  const readme = readFileSync(readmePath, "utf8");
  const appSource = readFileSync(mainPath, "utf8");
  const packageJson = readJsonObject(packagePath);
  const manifest = readJsonObject(manifestPath);

  // 在所有写入前提取 Release Notes，确保用户没有补齐说明时不会产生不完整的版本提交。
  extractReleaseNotes(changelog, version);
  const nextReadme = replaceReadmeVersion(readme, version);
  const nextAppSource = replaceSampleVersion(appSource, version);
  packageJson.version = version;
  manifest.version = version;

  /** @type {Array<[string, Record<string, unknown>]>} */
  const jsonWrites = [
    [packagePath, packageJson],
    [manifestPath, manifest],
  ];

  if (existsSync(packageLockPath)) {
    const packageLock = readJsonObject(packageLockPath);
    packageLock.version = version;

    if (packageLock.packages && typeof packageLock.packages === "object" && !Array.isArray(packageLock.packages)) {
      const rootPackage = packageLock.packages[""];

      if (rootPackage && typeof rootPackage === "object" && !Array.isArray(rootPackage)) {
        rootPackage.version = version;
      }
    }

    jsonWrites.push([packageLockPath, packageLock]);
  }

  for (const [filePath, value] of jsonWrites) {
    writeJsonObject(filePath, value);
  }

  writeFileSync(readmePath, nextReadme);
  writeFileSync(mainPath, nextAppSource);

  return {
    version,
    files: [...jsonWrites.map(([filePath]) => filePath), readmePath, mainPath],
  };
}

/**
 * 运行本地版本同步命令。
 *
 * @return {void}
 */
function runCli() {
  const version = process.argv[2];

  if (!version) {
    throw new Error("用法：npm run release:prepare -- X.Y.Z");
  }

  const result = syncProjectVersion({ version });
  console.log(`已同步版本 ${result.version}：${result.files.map((filePath) => filePath.replace(`${ROOT_DIR}/`, "")).join("、")}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
