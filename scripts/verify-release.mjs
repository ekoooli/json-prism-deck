import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertStableVersion, buildReleaseTag, extractReleaseNotes, readReadmeVersion, readSampleVersion } from "./release-metadata.mjs";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 读取发布校验所需的 JSON 对象。
 *
 * @param {string} filePath JSON 文件绝对路径。
 * @return {Record<string, unknown>} 已解析 JSON 对象。
 * @throws {Error} 当 JSON 根节点不是对象时抛出。
 */
function readJsonObject(filePath) {
  const value = JSON.parse(readFileSync(filePath, "utf8"));

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${filePath} 必须是 JSON 对象。`);
  }

  return value;
}

/**
 * 校验提交是否具备创建正式 Release 的全部元数据。
 *
 * 本地与 CI 都走这里，避免本地显示可发布但 tag 工作流因版本、更新记录或 lockfile 漂移
 * 失败。tag 可选是为了让 release:prepare 在打 tag 前完成同样的内容校验。
 *
 * @param {{ rootDir?: string, tag?: string }} input 校验根目录和可选 Git tag。
 * @return {{ version: string, tag: string, releaseNotes: string }} 已验证的发布元数据。
 * @throws {Error} 当任一版本来源、更新记录或 tag 不一致时抛出。
 */
export function verifyReleaseMetadata({ rootDir = ROOT_DIR, tag } = {}) {
  const packageJson = readJsonObject(resolve(rootDir, "package.json"));
  const manifest = readJsonObject(resolve(rootDir, "manifest.json"));
  const readme = readFileSync(resolve(rootDir, "README.md"), "utf8");
  const appSource = readFileSync(resolve(rootDir, "app.js"), "utf8");
  const changelog = readFileSync(resolve(rootDir, "更新记录.md"), "utf8");
  const version = String(packageJson.version ?? "");

  assertStableVersion(version);

  const comparedVersions = {
    "manifest.json": String(manifest.version ?? ""),
    "README.md": readReadmeVersion(readme),
    "app.js 示例": readSampleVersion(appSource),
  };

  for (const [source, sourceVersion] of Object.entries(comparedVersions)) {
    if (sourceVersion !== version) {
      throw new Error(`${source} 版本为 ${sourceVersion}，必须与 package.json 的 ${version} 一致。`);
    }
  }

  const packageLockPath = resolve(rootDir, "package-lock.json");

  if (existsSync(packageLockPath)) {
    const packageLock = readJsonObject(packageLockPath);
    const lockVersion = String(packageLock.version ?? "");
    const rootPackage = packageLock.packages && typeof packageLock.packages === "object" && !Array.isArray(packageLock.packages)
      ? packageLock.packages[""]
      : null;
    const rootLockVersion = rootPackage && typeof rootPackage === "object" && !Array.isArray(rootPackage)
      ? String(rootPackage.version ?? "")
      : "";

    if (lockVersion !== version || rootLockVersion !== version) {
      throw new Error(`package-lock.json 版本必须与 package.json 的 ${version} 一致。`);
    }
  }

  const expectedTag = buildReleaseTag(version);

  if (tag !== undefined && tag !== expectedTag) {
    throw new Error(`发布 tag 必须是 ${expectedTag}，当前为 ${tag}。`);
  }

  return {
    version,
    tag: expectedTag,
    releaseNotes: extractReleaseNotes(changelog, version),
  };
}

/**
 * 运行发布元数据校验命令。
 *
 * @return {void}
 */
function runCli() {
  const tag = process.argv[2];

  if (!tag) {
    throw new Error("用法：npm run release:verify -- vX.Y.Z");
  }

  const result = verifyReleaseMetadata({ tag });
  console.log(`发布元数据校验通过：${result.tag}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
