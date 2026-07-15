import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertStableVersion } from "./release-metadata.mjs";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 断言构建产物中的一个相对文件存在。
 *
 * @param {string} distDir dist 目录绝对路径。
 * @param {string} relativePath Manifest 中引用的相对路径。
 * @param {string} label 用于错误信息的资源说明。
 * @return {void}
 * @throws {Error} 当 Manifest 引用了缺失资源时抛出。
 */
function assertDistFile(distDir, relativePath, label) {
  if (!relativePath || !existsSync(resolve(distDir, relativePath))) {
    throw new Error(`构建产物缺少 ${label}：${relativePath}`);
  }
}

/**
 * 校验 dist 是否为可直接加载的 Chrome 扩展目录。
 *
 * 该检查在压缩前执行，重点验证 zip 根目录必需的 Manifest、页面和 Manifest 引用资源；
 * 这样 Release 不会上传一个构建成功但 Chrome 无法加载的目录。
 *
 * @param {{ rootDir?: string }} [input] 仓库根目录。
 * @return {{ version: string, distDir: string }} 构建版本和 dist 路径。
 * @throws {Error} 当产物根目录或 Manifest 引用不完整时抛出。
 */
export function verifyDistribution({ rootDir = ROOT_DIR } = {}) {
  const distDir = resolve(rootDir, "dist");
  const manifestPath = resolve(distDir, "manifest.json");
  const packageJson = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8"));

  if (!existsSync(manifestPath)) {
    throw new Error("dist 根目录缺少 manifest.json。请先执行 npm run build。");
  }

  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const version = String(packageJson.version ?? "");
  assertStableVersion(version);

  if (manifest.version !== version) {
    throw new Error(`dist/manifest.json 版本为 ${manifest.version}，必须与 package.json 的 ${version} 一致。`);
  }

  assertDistFile(distDir, "index.html", "扩展页面");
  assertDistFile(distDir, manifest.background?.service_worker, "后台脚本");

  for (const [size, iconPath] of Object.entries(manifest.icons ?? {})) {
    assertDistFile(distDir, String(iconPath), `${size}px 图标`);
  }

  return { version, distDir };
}

/**
 * 运行构建产物校验命令。
 *
 * @return {void}
 */
function runCli() {
  const result = verifyDistribution();
  console.log(`构建产物校验通过：${result.distDir}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
