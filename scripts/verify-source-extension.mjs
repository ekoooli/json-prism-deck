import { existsSync, readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { assertStableVersion } from "./release-metadata.mjs";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 断言根目录 Manifest 引用的源码文件存在。
 *
 * 这个校验服务于“直接加载项目根目录”的开发模式：Chrome 不会解析 Vite 配置，
 * 因此任何路径漂移都会在点击扩展刷新时才暴露。提前检查可以把问题留在本地和 CI。
 *
 * @param {string} rootDir 项目根目录。
 * @param {string} relativePath Manifest 中声明的相对路径。
 * @param {string} label 用于错误信息的资源说明。
 * @return {void}
 * @throws {Error} 当路径为空或对应源码文件不存在时抛出。
 */
function assertSourceFile(rootDir, relativePath, label) {
  if (!relativePath || !existsSync(resolve(rootDir, relativePath))) {
    throw new Error(`根目录 Manifest 缺少 ${label}：${relativePath}`);
  }
}

/**
 * 校验项目根目录是否仍可作为未打包 Chrome 扩展加载。
 *
 * 发布构建会重写后台脚本和资源路径，但开发时 Chrome 直接读取根目录 manifest.json；
 * 所以必须独立确认版本、工作台、后台脚本和图标都指向真实 src 文件，不能只依赖 dist 校验。
 *
 * @param {{ rootDir?: string }} [input] 项目根目录。
 * @return {{ version: string, manifestPath: string }} 已验证的版本和 Manifest 路径。
 * @throws {Error} 当根目录 Manifest 无法作为开发扩展入口时抛出。
 */
export function verifySourceExtension({ rootDir = ROOT_DIR } = {}) {
  const manifestPath = resolve(rootDir, "manifest.json");
  const packageJson = JSON.parse(readFileSync(resolve(rootDir, "package.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(manifestPath, "utf8"));
  const version = String(packageJson.version ?? "");

  assertStableVersion(version);

  if (manifest.version !== version) {
    throw new Error(`manifest.json 版本为 ${manifest.version}，必须与 package.json 的 ${version} 一致。`);
  }

  assertSourceFile(rootDir, manifest.options_ui?.page, "工作台页面");
  assertSourceFile(rootDir, manifest.background?.service_worker, "后台脚本");

  for (const [size, iconPath] of Object.entries(manifest.icons ?? {})) {
    assertSourceFile(rootDir, String(iconPath), `${size}px 图标`);
  }

  return { version, manifestPath };
}

/**
 * 运行根目录开发扩展校验命令。
 *
 * @return {void}
 */
function runCli() {
  const result = verifySourceExtension();
  console.log(`根目录开发扩展校验通过：${result.manifestPath}`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
