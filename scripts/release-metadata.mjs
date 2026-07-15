/**
 * Chrome Manifest 支持的稳定三段式版本格式。
 *
 * 发布标签、Manifest 和 npm 包必须共享这一格式；拒绝预发布后缀可以避免 tag 可创建、
 * 但 Chrome 无法加载对应 Manifest 的半发布状态。
 *
 * @type {RegExp}
 */
export const STABLE_VERSION_PATTERN = /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)$/u;

/**
 * 转义正则表达式中的字面量文本。
 *
 * 版本号当前只含数字和点，但该函数让更新记录解析不依赖这一偶然约束，避免未来放宽
 * 版本规则时把用户文本误解释成正则语法。
 *
 * @param {string} value 需要作为字面量匹配的文本。
 * @return {string} 可安全嵌入正则表达式的文本。
 */
function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

/**
 * 断言版本可写入 Chrome Manifest。
 *
 * Chrome 将每段版本号限制在 0 到 65535；在本地和 CI 共同提前校验，能避免构建成功后
 * 才在浏览器加载扩展时失败，也保证发布标签的语义始终可复现。
 *
 * @param {string} version 待校验的版本号。
 * @return {string} 已确认合法的原始版本号。
 * @throws {Error} 当版本不是三段数字或任一段超出 Chrome 上限时抛出。
 */
export function assertStableVersion(version) {
  if (!STABLE_VERSION_PATTERN.test(version)) {
    throw new Error(`版本必须是 Chrome 支持的三段数字格式，例如 1.0.5；当前值为：${version}`);
  }

  if (version.split(".").some((part) => Number(part) > 65535)) {
    throw new Error(`版本每一段必须小于等于 65535；当前值为：${version}`);
  }

  return version;
}

/**
 * 将版本转换为正式发布标签。
 *
 * 标签是 Release 工作流的唯一触发凭证，因此统一在这里补上 v 前缀，避免本地命令、
 * CI 变量和 GitHub Release 名称各自拼接造成同一版本生成多个标签。
 *
 * @param {string} version 已发布或待发布的版本号。
 * @return {string} 对应的 Git tag，例如 v1.0.5。
 */
export function buildReleaseTag(version) {
  return `v${assertStableVersion(version)}`;
}

/**
 * 从更新记录中提取一个正式版本的 Release Notes。
 *
 * 只接受 `## X.Y.Z - YYYY-MM-DD` 这一新规范标题；历史“补充”段落不参与匹配，
 * 这样 CI 不会把旧修订说明误发布到新版本。正文取到下一个二级标题前并要求非空。
 *
 * @param {string} changelog 更新记录全文。
 * @param {string} version 需要提取的版本号。
 * @return {string} 可直接交给 GitHub Release 的 Markdown 正文。
 * @throws {Error} 当标题缺失、重复或正文为空时抛出。
 */
export function extractReleaseNotes(changelog, version) {
  assertStableVersion(version);
  const headingPattern = new RegExp(`^## ${escapeRegExp(version)} - \\d{4}-\\d{2}-\\d{2}\\s*$`, "gmu");
  const headings = [...changelog.matchAll(headingPattern)];

  if (headings.length !== 1) {
    throw new Error(`更新记录必须且只能包含一个“## ${version} - YYYY-MM-DD”标题；当前找到 ${headings.length} 个。`);
  }

  const heading = headings[0];
  const contentStart = /** @type {number} */ (heading.index) + heading[0].length;
  const nextHeadingPattern = /^##\s+/gmu;
  nextHeadingPattern.lastIndex = contentStart;
  const nextHeading = nextHeadingPattern.exec(changelog);
  const notes = changelog.slice(contentStart, nextHeading?.index).trim();

  if (!notes) {
    throw new Error(`版本 ${version} 的更新记录正文不能为空。`);
  }

  return notes;
}

/**
 * 从 README 中读取当前版本。
 *
 * README 是用户下载 Release 时最常见的版本确认入口，所以这里要求唯一匹配；多处
 * “当前版本”会让同步脚本悄悄改错文案，必须直接阻断发布。
 *
 * @param {string} readme README 全文。
 * @return {string} README 中声明的版本号。
 * @throws {Error} 当版本行缺失或重复时抛出。
 */
export function readReadmeVersion(readme) {
  const matches = [...readme.matchAll(/^当前版本：`([^`]+)`\s*$/gmu)];

  if (matches.length !== 1) {
    throw new Error(`README 必须且只能包含一行“当前版本”；当前找到 ${matches.length} 行。`);
  }

  return matches[0][1];
}

/**
 * 从默认示例 JSON 中读取展示版本。
 *
 * 示例数据既用于演示也用于回归人工验收，版本必须与扩展本体一致，避免用户打开示例时
 * 误以为安装了旧版本。匹配范围限定在 DEFAULT_SAMPLE_TEXT，避免影响其他业务字段。
 *
 * @param {string} appSource app.js 全文。
 * @return {string} 默认示例声明的版本号。
 * @throws {Error} 当默认示例版本缺失或重复时抛出。
 */
export function readSampleVersion(appSource) {
  const matches = [...appSource.matchAll(/const DEFAULT_SAMPLE_TEXT = `[\s\S]*?"version": "([^"]+)"/gu)];

  if (matches.length !== 1) {
    throw new Error(`app.js 的 DEFAULT_SAMPLE_TEXT 必须且只能包含一个版本字段；当前找到 ${matches.length} 个。`);
  }

  return matches[0][1];
}

/**
 * 将 README 的唯一版本行替换为目标版本。
 *
 * @param {string} readme README 全文。
 * @param {string} version 合法的目标版本。
 * @return {string} 已同步版本的 README 文本。
 */
export function replaceReadmeVersion(readme, version) {
  assertStableVersion(version);
  readReadmeVersion(readme);
  return readme.replace(/^当前版本：`[^`]+`\s*$/mu, `当前版本：\`${version}\``);
}

/**
 * 将默认示例 JSON 的唯一版本字段替换为目标版本。
 *
 * @param {string} appSource app.js 全文。
 * @param {string} version 合法的目标版本。
 * @return {string} 已同步版本的 app.js 文本。
 */
export function replaceSampleVersion(appSource, version) {
  assertStableVersion(version);
  readSampleVersion(appSource);
  return appSource.replace(
    /(const DEFAULT_SAMPLE_TEXT = `[\s\S]*?"version": ")[^"]+("\s*[\s\S]*?`)/u,
    `$1${version}$2`,
  );
}
