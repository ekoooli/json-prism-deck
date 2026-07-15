import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { extractReleaseNotes } from "./release-metadata.mjs";

const ROOT_DIR = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/**
 * 输出指定版本的 GitHub Release 正文。
 *
 * 这个命令只写标准输出，工作流会重定向到临时 Markdown 文件再交给 GitHub CLI；不修改
 * 更新记录，确保 Release 内容永远能由 tag 对应提交中的文档重新生成。
 *
 * @param {{ rootDir?: string, version: string }} input 仓库根目录和版本号。
 * @return {string} 版本对应的 Markdown 正文。
 */
export function getReleaseNotes({ rootDir = ROOT_DIR, version }) {
  return extractReleaseNotes(readFileSync(resolve(rootDir, "更新记录.md"), "utf8"), version);
}

/**
 * 运行版本说明提取命令。
 *
 * @return {void}
 */
function runCli() {
  const version = process.argv[2];

  if (!version) {
    throw new Error("用法：npm run release:notes -- X.Y.Z");
  }

  process.stdout.write(`${getReleaseNotes({ version })}\n`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  try {
    runCli();
  } catch (error) {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  }
}
