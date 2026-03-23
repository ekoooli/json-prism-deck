/**
 * 判断一个值是否属于“可解包的 JSON 字符串包装 JSON”。
 *
 * 这里只接受根节点为 string，且字符串再次 JSON.parse 后得到 object/array 的场景；
 * 普通字符串、数字、布尔或 null 都不应被这个功能误判成可解包对象。
 *
 * @param {unknown} value 一次解析后的根值。
 * @return {value is string} 是否值得继续尝试第二次解析。
 */
function isEmbeddedJsonCandidate(value) {
  return typeof value === "string";
}

/**
 * 判断解析结果是否属于可直接进入工作台主流程的结构化 JSON。
 *
 * “解包”按钮的目标是把字符串里的对象/数组还原成正常 JSON；
 * 如果二次解析拿到的只是另一个字符串或基础类型，继续回写只会让结果更混乱。
 *
 * @param {unknown} value 二次解析后的值。
 * @return {boolean} 是否为对象或数组。
 */
function isStructuredJson(value) {
  return value !== null && typeof value === "object";
}

/**
 * 从编辑区文本中提取被字符串包装的 JSON 值。
 *
 * @param {string} text 编辑区原始文本。
 * @return {unknown | null} 成功时返回解包后的对象/数组，否则返回 null。
 */
function extractEmbeddedJsonValue(text) {
  const outerValue = JSON.parse(text);

  if (!isEmbeddedJsonCandidate(outerValue)) {
    return null;
  }

  const embeddedText = outerValue.trim();
  const innerValue = JSON.parse(embeddedText);

  return isStructuredJson(innerValue) ? innerValue : null;
}

/**
 * 判断当前文本是否属于可解包的 JSON 字符串。
 *
 * @param {string} text 编辑区原始文本。
 * @return {boolean} 是否可解包。
 */
export function canUnpackEmbeddedJson(text) {
  try {
    return extractEmbeddedJsonValue(text) !== null;
  } catch (error) {
    return false;
  }
}

/**
 * 将“JSON 字符串包装的 JSON”改写成正常 JSON 文本。
 *
 * @param {string} text 编辑区原始文本。
 * @param {{ style: "pretty" | "minify", indent: number }} options 输出选项。
 * @return {string} 解包后的 JSON 文本。
 * @throws {Error} 当前内容不属于可解包 JSON 字符串时抛错。
 */
export function unpackEmbeddedJsonText(text, options) {
  let unpackedValue = null;

  try {
    unpackedValue = extractEmbeddedJsonValue(text);
  } catch (error) {
    throw new Error("当前内容不属于可解包的 JSON 字符串。");
  }

  if (unpackedValue === null) {
    throw new Error("当前内容不属于可解包的 JSON 字符串。");
  }

  return options.style === "pretty"
    ? JSON.stringify(unpackedValue, null, options.indent)
    : JSON.stringify(unpackedValue);
}
