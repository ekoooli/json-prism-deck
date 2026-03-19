/**
 * 最近一次成功解析后的原始 JSON 值。
 *
 * worker 持有这份引用是为了让“重新排序预览”“格式化”“复制节点值”都复用同一次解析结果，
 * 避免主线程每次点击工具栏都再次 JSON.parse，放大大对象下的卡顿。
 *
 * @type {unknown}
 */
let currentValue = null;

/**
 * 最近一次成功解析时的原始文本。
 *
 * @type {string}
 */
let currentText = "";

/**
 * 最近一次成功构建的 path -> value 索引。
 *
 * path 是树节点和复制动作之间的稳定协议，排序模式改变时节点展示顺序会重排，
 * 但 path 不变，所以主线程的选中状态、展开状态和搜索命中都可以继续复用。
 *
 * @type {Map<string, unknown>}
 */
let currentValueByPath = new Map();

/**
 * worker 当前预览所使用的排序模式。
 *
 * @type {"source" | "asc" | "desc"}
 */
let currentSortMode = "source";

/**
 * 获取 JSON 值的稳定类型名。
 *
 * @param {unknown} value 待判断的 JSON 值。
 * @return {"object" | "array" | "string" | "number" | "boolean" | "null"} 稳定类型标签。
 */
function getJsonType(value) {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  if (typeof value === "object") {
    return "object";
  }

  return /** @type {"string" | "number" | "boolean"} */ (typeof value);
}

/**
 * 统计文本的字符数、字节数和行数。
 *
 * 这些指标既用于状态栏，也用于错误态；即使 JSON 非法，用户也仍然需要看到原始载荷规模。
 *
 * @param {string} text 原始文本。
 * @return {{ chars: number, bytes: number, lines: number }} 文本规模信息。
 */
function buildTextStats(text) {
  return {
    chars: text.length,
    bytes: new TextEncoder().encode(text).length,
    lines: text.length === 0 ? 0 : text.split("\n").length,
  };
}

/**
 * 计算对象字段在预览区的展示顺序。
 *
 * 默认模式必须严格保持源 JSON 的字段顺序，只有显式切换升序/降序时才重排，
 * 否则格式化工具会悄悄改变业务字段顺序，破坏“输入即真相”的预期。
 *
 * @param {Record<string, unknown>} value 对象值。
 * @param {"source" | "asc" | "desc"} sortMode 排序模式。
 * @return {string[]} 对象键列表。
 */
function getOrderedKeys(value, sortMode) {
  const keys = Object.keys(value);

  if (sortMode === "source") {
    return keys;
  }

  const direction = sortMode === "asc" ? 1 : -1;

  return [...keys].sort((left, right) => {
    return direction * left.localeCompare(right, "zh-Hans-CN", {
      numeric: true,
      sensitivity: "base",
    });
  });
}

/**
 * 将键路径拼成稳定的 JSON Path 风格 id。
 *
 * 这里优先保留易读的点语法；对带空格、特殊字符或中文引号需求的字段退回 bracket 语法，
 * 这样 UI 展示清晰，同时保证 path 可逆且不会与数组下标冲突。
 *
 * @param {string} parentPath 父节点 path。
 * @param {string | number} key 当前键名或下标。
 * @param {"object" | "array"} parentType 父节点类型。
 * @return {string} 稳定 path。
 */
function buildNodePath(parentPath, key, parentType) {
  if (parentType === "array") {
    return `${parentPath}[${key}]`;
  }

  if (/^[A-Za-z_$][A-Za-z0-9_$]*$/u.test(String(key))) {
    return `${parentPath}.${String(key)}`;
  }

  return `${parentPath}[${JSON.stringify(String(key))}]`;
}

/**
 * 生成叶子节点的简短展示文案。
 *
 * 预览区是高密度列表，文案必须足够短，否则虚拟滚动虽然能减 DOM，
 * 但单行渲染仍会因为文本测量过重而拖慢滚动。
 *
 * @param {unknown} value 叶子值。
 * @return {{ preview: string, metaLabel: string }} 预览文案和补充说明。
 */
function buildLeafPreview(value) {
  const type = getJsonType(value);

  if (type === "string") {
    const raw = /** @type {string} */ (value);
    const shortened = raw.length > 88 ? `${raw.slice(0, 88)}…` : raw;

    return {
      preview: JSON.stringify(shortened),
      metaLabel: "",
    };
  }

  if (type === "number") {
    return {
      preview: String(value),
      metaLabel: "",
    };
  }

  if (type === "boolean") {
    return {
      preview: String(value),
      metaLabel: "",
    };
  }

  return {
    preview: "null",
    metaLabel: "",
  };
}

/**
 * 递归创建排序后的克隆值。
 *
 * 只在“按字段排序格式化/复制容器值”时使用这份克隆，避免默认格式化破坏源顺序。
 * 这里显式保留数组原顺序，因为数组是业务有序集合，按字母排序会直接改变语义。
 *
 * @param {unknown} value 原始值。
 * @param {"source" | "asc" | "desc"} sortMode 排序模式。
 * @return {unknown} 适合 JSON.stringify 的有序值。
 */
function createOrderedClone(value, sortMode) {
  const type = getJsonType(value);

  if (type === "array") {
    return /** @type {unknown[]} */ (value).map((item) => createOrderedClone(item, sortMode));
  }

  if (type === "object") {
    /** @type {Record<string, unknown>} */
    const source = /** @type {Record<string, unknown>} */ (value);
    /** @type {Record<string, unknown>} */
    const target = {};

    for (const key of getOrderedKeys(source, sortMode)) {
      target[key] = createOrderedClone(source[key], sortMode);
    }

    return target;
  }

  return value;
}

/**
 * 将值格式化为字符串。
 *
 * @param {unknown} value 目标值。
 * @param {"source" | "asc" | "desc"} sortMode 排序模式。
 * @param {number} indent 缩进空格数。
 * @param {boolean} pretty 是否输出格式化文本。
 * @return {string} JSON 文本。
 */
function stringifyValue(value, sortMode, indent, pretty) {
  const serializable = sortMode === "source" ? value : createOrderedClone(value, sortMode);
  return pretty ? JSON.stringify(serializable, null, indent) : JSON.stringify(serializable);
}

/**
 * 从 JSON.parse 的异常里提取位置和人类可读错误信息。
 *
 * 不同 Chromium 版本的错误文本略有差异，所以这里既尝试直接读 line/column，
 * 也会退回到 position 反推行列，保证错误态至少能稳定标出一处具体位置。
 *
 * @param {unknown} error 解析异常。
 * @param {string} text 触发异常的文本。
 * @return {{ message: string, rawMessage: string, position: number | null, line: number | null, column: number | null }} 错误详情。
 */
function extractParseError(error, text) {
  const rawMessage = error instanceof Error ? error.message : String(error);
  const positionMatch = rawMessage.match(/position\s+(\d+)/i);
  const lineColumnMatch = rawMessage.match(/line\s+(\d+)\s+column\s+(\d+)/i);

  let position = positionMatch ? Number(positionMatch[1]) : null;
  let line = lineColumnMatch ? Number(lineColumnMatch[1]) : null;
  let column = lineColumnMatch ? Number(lineColumnMatch[2]) : null;

  if (position !== null && (line === null || column === null)) {
    const before = text.slice(0, position);
    const segments = before.split("\n");
    line = segments.length;
    column = segments[segments.length - 1].length + 1;
  }

  if (position === null && line !== null && column !== null) {
    const lines = text.split("\n");
    let computed = 0;

    for (let index = 0; index < line - 1 && index < lines.length; index += 1) {
      computed += lines[index].length + 1;
    }

    position = computed + column - 1;
  }

  const message = rawMessage
    .replace(/\s+at position\s+\d+.*$/i, "")
    .replace(/\s+\(line\s+\d+\s+column\s+\d+\).*$/i, "")
    .trim();

  return {
    message: message || rawMessage,
    rawMessage,
    position,
    line,
    column,
  };
}

/**
 * 基于当前 JSON 值构建树形节点列表与统计信息。
 *
 * 这里使用显式栈而不是递归，主要是为了避免用户贴入超深层嵌套 JSON 时触发调用栈溢出。
 * 树节点只保留列表渲染需要的摘要字段，主值引用单独存在 valueByPath，减少 message 传输体积。
 *
 * @param {unknown} rootValue 根值。
 * @param {"source" | "asc" | "desc"} sortMode 排序模式。
 * @return {{
 *   nodes: Array<{
 *     id: string,
 *     parentId: string | null,
 *     keyLabel: string,
 *     path: string,
 *     type: "object" | "array" | "string" | "number" | "boolean" | "null",
 *     depth: number,
 *     childIds: string[],
 *     childCount: number,
 *     expandable: boolean,
 *     preview: string,
 *     metaLabel: string,
 *     searchText: string
 *   }>,
 *   expandableIds: string[],
 *   valueByPath: Map<string, unknown>,
 *   stats: {
 *     nodeCount: number,
 *     leafCount: number,
 *     objectCount: number,
 *     arrayCount: number,
 *     stringCount: number,
 *     numberCount: number,
 *     booleanCount: number,
 *     nullCount: number,
 *     maxDepth: number,
 *     keyCount: number
 *   }
 * }} 树结构、索引和值分布。
 */
function buildTree(rootValue, sortMode) {
  /** @type {ReturnType<typeof buildTree>["nodes"]} */
  const nodes = [];
  /** @type {string[]} */
  const expandableIds = [];
  /** @type {Map<string, unknown>} */
  const valueByPath = new Map();

  const stats = {
    nodeCount: 0,
    leafCount: 0,
    objectCount: 0,
    arrayCount: 0,
    stringCount: 0,
    numberCount: 0,
    booleanCount: 0,
    nullCount: 0,
    maxDepth: 0,
    keyCount: 0,
  };

  /** @type {Array<{ value: unknown, id: string, parentId: string | null, keyLabel: string, depth: number }>} */
  const stack = [
    {
      value: rootValue,
      id: "$",
      parentId: null,
      // 根节点本身只承担整棵树的容器职责，路径 `$` 已足够表达语义；
      // 这里不再额外塞 `root` 文案，避免树形首行重复占位并干扰用户阅读与复制。
      keyLabel: "",
      depth: 0,
    },
  ];

  while (stack.length > 0) {
    const item = stack.pop();

    if (!item) {
      break;
    }

    const type = getJsonType(item.value);
    const node = {
      id: item.id,
      parentId: item.parentId,
      keyLabel: item.keyLabel,
      path: item.id,
      type,
      depth: item.depth,
      childIds: /** @type {string[]} */ ([]),
      childCount: 0,
      expandable: type === "object" || type === "array",
      preview: "",
      metaLabel: "",
      searchText: "",
    };

    valueByPath.set(item.id, item.value);
    stats.nodeCount += 1;
    stats.maxDepth = Math.max(stats.maxDepth, item.depth);

    if (type === "object") {
      const source = /** @type {Record<string, unknown>} */ (item.value);
      const keys = getOrderedKeys(source, sortMode);

      stats.objectCount += 1;
      stats.keyCount += keys.length;
      node.childCount = keys.length;
      node.preview = `{${keys.length}}`;
      node.metaLabel = `${keys.length} 个字段`;
      expandableIds.push(item.id);

      for (const key of keys) {
        node.childIds.push(buildNodePath(item.id, key, "object"));
      }

      for (let index = keys.length - 1; index >= 0; index -= 1) {
        const key = keys[index];
        stack.push({
          value: source[key],
          id: buildNodePath(item.id, key, "object"),
          parentId: item.id,
          keyLabel: key,
          depth: item.depth + 1,
        });
      }
    } else if (type === "array") {
      const source = /** @type {unknown[]} */ (item.value);

      stats.arrayCount += 1;
      node.childCount = source.length;
      node.preview = `[${source.length}]`;
      node.metaLabel = `${source.length} 项`;
      expandableIds.push(item.id);

      for (let index = 0; index < source.length; index += 1) {
        node.childIds.push(buildNodePath(item.id, index, "array"));
      }

      for (let index = source.length - 1; index >= 0; index -= 1) {
        stack.push({
          value: source[index],
          id: buildNodePath(item.id, index, "array"),
          parentId: item.id,
          keyLabel: `[${index}]`,
          depth: item.depth + 1,
        });
      }
    } else {
      const { preview, metaLabel } = buildLeafPreview(item.value);

      stats.leafCount += 1;
      node.preview = preview;
      node.metaLabel = metaLabel;

      if (type === "string") {
        stats.stringCount += 1;
      } else if (type === "number") {
        stats.numberCount += 1;
      } else if (type === "boolean") {
        stats.booleanCount += 1;
      } else {
        stats.nullCount += 1;
      }
    }

    // 搜索大小写敏感与否由主线程的搜索计划决定，这里必须保留原始大小写语料；
    // 否则一旦在 worker 侧先做 toLowerCase，`Aa` 开关就会失去实现空间。
    node.searchText = [node.keyLabel, node.path, node.preview, node.metaLabel, node.type].join(" ");
    nodes.push(node);
  }

  return {
    nodes,
    expandableIds,
    valueByPath,
    stats,
  };
}

/**
 * 用当前成功解析的 JSON 生成给主线程使用的完整成功载荷。
 *
 * @param {"source" | "asc" | "desc"} sortMode 排序模式。
 * @param {number} indent 缩进空格数。
 * @return {{
 *   ok: true,
 *   rootId: string,
 *   nodes: ReturnType<typeof buildTree>["nodes"],
 *   expandableIds: string[],
 *   metadata: {
 *     rootType: ReturnType<typeof getJsonType>,
 *     chars: number,
 *     bytes: number,
 *     lines: number,
 *     formattedLines: number,
 *     formattedBytes: number,
 *     nodeCount: number,
 *     leafCount: number,
 *     objectCount: number,
 *     arrayCount: number,
 *     stringCount: number,
 *     numberCount: number,
 *     booleanCount: number,
 *     nullCount: number,
 *     keyCount: number,
 *     maxDepth: number
 *   },
 *   formattedText: string
 * }} 主线程所需的完整成功结果。
 */
function buildSuccessPayload(sortMode, indent) {
  const tree = buildTree(currentValue, sortMode);
  const formattedText = stringifyValue(currentValue, sortMode, indent, true);
  const textStats = buildTextStats(currentText);
  const formattedStats = buildTextStats(formattedText);

  currentSortMode = sortMode;
  currentValueByPath = tree.valueByPath;

  return {
    ok: true,
    rootId: "$",
    nodes: tree.nodes,
    expandableIds: tree.expandableIds,
    metadata: {
      rootType: getJsonType(currentValue),
      chars: textStats.chars,
      bytes: textStats.bytes,
      lines: textStats.lines,
      formattedLines: formattedStats.lines,
      formattedBytes: formattedStats.bytes,
      nodeCount: tree.stats.nodeCount,
      leafCount: tree.stats.leafCount,
      objectCount: tree.stats.objectCount,
      arrayCount: tree.stats.arrayCount,
      stringCount: tree.stats.stringCount,
      numberCount: tree.stats.numberCount,
      booleanCount: tree.stats.booleanCount,
      nullCount: tree.stats.nullCount,
      keyCount: tree.stats.keyCount,
      maxDepth: tree.stats.maxDepth,
    },
    formattedText,
  };
}

/**
 * 处理解析请求。
 *
 * @param {{ text: string, sortMode: "source" | "asc" | "desc", indent: number }} payload 解析参数。
 * @return {ReturnType<typeof buildSuccessPayload> | {
 *   ok: false,
 *   metadata: ReturnType<typeof buildTextStats>,
 *   error: ReturnType<typeof extractParseError>
 * }} 成功或失败结果。
 */
function handleParse(payload) {
  try {
    currentText = payload.text;
    currentValue = JSON.parse(payload.text);
    return buildSuccessPayload(payload.sortMode, payload.indent);
  } catch (error) {
    currentValue = null;
    currentValueByPath = new Map();
    currentSortMode = "source";

    return {
      ok: false,
      metadata: buildTextStats(payload.text),
      error: extractParseError(error, payload.text),
    };
  }
}

/**
 * 在不重新解析文本的前提下重建预览树。
 *
 * 这条路径专门服务排序模式、缩进变化等派生视图切换，避免重复 parse 大文本。
 *
 * @param {{ sortMode: "source" | "asc" | "desc", indent: number }} payload 重建参数。
 * @return {ReturnType<typeof buildSuccessPayload>} 重建后的成功结果。
 * @throws {Error} 当前没有可复用的解析结果时抛错。
 */
function handleRebuild(payload) {
  if (currentValue === null) {
    throw new Error("没有可重建的 JSON 数据");
  }

  return buildSuccessPayload(payload.sortMode, payload.indent);
}

/**
 * 输出当前根值或子树的 JSON 文本。
 *
 * @param {{ path?: string, sortMode: "source" | "asc" | "desc", indent: number, style: "pretty" | "minify" }} payload 输出参数。
 * @return {{ ok: true, text: string }} 结果文本。
 * @throws {Error} 当前值不存在或 path 无效时抛错。
 */
function handleStringify(payload) {
  if (currentValue === null) {
    throw new Error("当前没有可导出的 JSON");
  }

  const target = payload.path ? currentValueByPath.get(payload.path) : currentValue;

  if (typeof target === "undefined") {
    throw new Error("目标节点不存在");
  }

  return {
    ok: true,
    text: stringifyValue(target, payload.sortMode, payload.indent, payload.style === "pretty"),
  };
}

/**
 * worker RPC 入口。
 *
 * @param {MessageEvent<{ id: string, type: string, payload: any }>} event 主线程请求。
 * @return {void}
 */
self.onmessage = (event) => {
  const { id, type, payload } = event.data;

  try {
    /** @type {unknown} */
    let result;

    if (type === "parse") {
      result = handleParse(payload);
    } else if (type === "rebuild") {
      result = handleRebuild(payload);
    } else if (type === "stringify") {
      result = handleStringify(payload);
    } else {
      throw new Error(`未知指令：${type}`);
    }

    self.postMessage({
      id,
      result,
    });
  } catch (error) {
    self.postMessage({
      id,
      error: error instanceof Error ? error.message : String(error),
    });
  }
};
