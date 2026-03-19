const STORAGE_KEY = "json-prism-deck-state";

const DEFAULT_SAMPLE_TEXT = `{
  "workspace": {
    "name": "JSON Prism Deck",
    "version": "1.0.0",
    "features": [
      "tree-preview",
      "virtual-scroll",
      "metadata",
      "download",
      "search"
    ],
    "theme": {
      "mode": "dawn",
      "palette": ["teal", "amber", "sand"]
    }
  },
  "metrics": {
    "requests": 1280,
    "successRate": 0.998,
    "latencyMs": [15, 19, 21, 17],
    "healthy": true
  },
  "records": [
    {
      "id": 46014,
      "name": "Aurora",
      "published": true,
      "deleted": false,
      "tags": ["json", "chrome-extension", "preview"]
    },
    {
      "id": 46015,
      "name": "Boreal",
      "published": false,
      "deleted": false,
      "tags": ["editor", "virtual-list"]
    }
  ]
}`;

const DEFAULT_SETTINGS = {
  // 初始化默认留空，避免新开页面时把示例数据误当成用户真实载荷。
  text: "",
  indent: 2,
  layout: "horizontal",
  theme: "dawn",
  previewMode: "tree",
  sortMode: "source",
  workspaceRatio: 0.48,
  searchQuery: "",
  searchTarget: "preview",
  editorFontSize: 15,
  previewFontSize: 14,
};

const FONT_LIMITS = {
  editor: {
    min: 13,
    max: 22,
    default: DEFAULT_SETTINGS.editorFontSize,
  },
  preview: {
    min: 13,
    max: 20,
    default: DEFAULT_SETTINGS.previewFontSize,
  },
};

/**
 * 获取页面中的必需元素。
 *
 * @param {string} id DOM id。
 * @return {HTMLElement} 对应元素。
 * @throws {Error} 缺失时立即抛错，避免后续交互静默失效。
 */
function getRequiredElement(id) {
  const element = document.getElementById(id);

  if (!element) {
    throw new Error(`缺少必需元素：#${id}`);
  }

  return element;
}

/**
 * 将数值限制到安全区间。
 *
 * @param {number} value 原始值。
 * @param {number} min 最小值。
 * @param {number} max 最大值。
 * @return {number} 裁剪后的值。
 */
function clamp(value, min, max) {
  return Math.min(Math.max(value, min), max);
}

/**
 * 以更易读的方式输出字节数。
 *
 * @param {number} bytes 字节数。
 * @return {string} 人类可读的尺寸字符串。
 */
function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes <= 0) {
    return "0 B";
  }

  const units = ["B", "KB", "MB", "GB"];
  let index = 0;
  let size = bytes;

  while (size >= 1024 && index < units.length - 1) {
    size /= 1024;
    index += 1;
  }

  return `${size >= 10 || index === 0 ? size.toFixed(index === 0 ? 0 : 1) : size.toFixed(2)} ${units[index]}`;
}

/**
 * 对数字做千分位格式化。
 *
 * @param {number} value 原始数字。
 * @return {string} 已格式化文本。
 */
function formatCount(value) {
  return new Intl.NumberFormat("zh-CN").format(value);
}

/**
 * 生成防抖函数。
 *
 * 实时校验既要及时，又不能让每次按键都触发 parse；这里统一通过防抖让编辑体验和性能平衡。
 *
 * @template {(...args: any[]) => void} T
 * @param {T} callback 原始函数。
 * @param {number} wait 等待毫秒数。
 * @return {T} 防抖后的函数。
 */
function debounce(callback, wait) {
  /** @type {number | null} */
  let timer = null;

  return /** @type {T} */ ((...args) => {
    if (timer !== null) {
      window.clearTimeout(timer);
    }

    timer = window.setTimeout(() => {
      callback(...args);
    }, wait);
  });
}

/**
 * 构建带高亮的文本片段。
 *
 * @param {string} text 原始文本。
 * @param {string} query 搜索关键字。
 * @return {DocumentFragment} 可直接挂到 DOM 的片段。
 */
function buildHighlightedFragment(text, query) {
  const fragment = document.createDocumentFragment();

  if (!query) {
    fragment.append(document.createTextNode(text));
    return fragment;
  }

  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let cursor = 0;

  while (cursor < text.length) {
    const index = lowerText.indexOf(lowerQuery, cursor);

    if (index === -1) {
      fragment.append(document.createTextNode(text.slice(cursor)));
      break;
    }

    if (index > cursor) {
      fragment.append(document.createTextNode(text.slice(cursor, index)));
    }

    const mark = document.createElement("mark");
    mark.className = "tree-highlight";
    mark.textContent = text.slice(index, index + query.length);
    fragment.append(mark);
    cursor = index + query.length;
  }

  return fragment;
}

/**
 * 计算一段文本里所有大小写不敏感的匹配区间。
 *
 * 这里统一返回稳定的 start/end 区间，供编辑区高亮、文本预览高亮和命中计数复用；
 * 这样不同视图看到的是同一份搜索结果，不会因为每个视图各算一遍而把计数翻倍。
 *
 * @param {string} text 原始文本。
 * @param {string} query 搜索词。
 * @return {Array<{ start: number, end: number }>} 匹配区间列表。
 */
function buildSearchRanges(text, query) {
  if (!query) {
    return [];
  }

  const ranges = [];
  const lowerText = text.toLowerCase();
  const lowerQuery = query.toLowerCase();
  let cursor = 0;

  while (cursor < text.length) {
    const index = lowerText.indexOf(lowerQuery, cursor);

    if (index === -1) {
      break;
    }

    ranges.push({
      start: index,
      end: index + query.length,
    });
    cursor = index + Math.max(1, query.length);
  }

  return ranges;
}

/**
 * 获取格式化后的本地时间戳，作为下载文件名的一部分。
 *
 * @return {string} 文件名安全的时间戳。
 */
function buildTimestamp() {
  const date = new Date();
  const parts = [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
    "-",
    String(date.getHours()).padStart(2, "0"),
    String(date.getMinutes()).padStart(2, "0"),
    String(date.getSeconds()).padStart(2, "0"),
  ];

  return parts.join("");
}

/**
 * 判断当前平台是否更偏向 Mac 快捷键提示。
 *
 * @return {boolean} 是否为 Mac。
 */
function isMacLikePlatform() {
  return /Mac|iPhone|iPad/i.test(navigator.platform);
}

/**
 * 计算对象字段在排序视图里的稳定顺序。
 *
 * 复制节点值时也必须和预览区保持同一套排序语义，
 * 否则用户在树形中看到的是升序/降序，复制出来却又变回源顺序，会造成强烈割裂感。
 *
 * @param {Record<string, unknown>} value 对象值。
 * @param {"source" | "asc" | "desc"} sortMode 排序模式。
 * @return {string[]} 排序后的字段列表。
 */
function getOrderedJsonKeys(value, sortMode) {
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
 * 生成带排序语义的 JSON 克隆值。
 *
 * 这里只对对象键做重排，数组严格保留原顺序；
 * 这样“复制值”和“按预览排序格式化”共享同一套语义，不会误改数组这种有序集合。
 *
 * @param {unknown} value 原始值。
 * @param {"source" | "asc" | "desc"} sortMode 排序模式。
 * @return {unknown} 可直接交给 JSON.stringify 的克隆值。
 */
function createOrderedJsonClone(value, sortMode) {
  if (Array.isArray(value)) {
    return value.map((item) => createOrderedJsonClone(item, sortMode));
  }

  if (value && typeof value === "object") {
    /** @type {Record<string, unknown>} */
    const source = /** @type {Record<string, unknown>} */ (value);
    /** @type {Record<string, unknown>} */
    const target = {};

    for (const key of getOrderedJsonKeys(source, sortMode)) {
      target[key] = createOrderedJsonClone(source[key], sortMode);
    }

    return target;
  }

  return value;
}

/**
 * 将任意 JSON 值转成字符串。
 *
 * @param {unknown} value 目标值。
 * @param {"source" | "asc" | "desc"} sortMode 排序模式。
 * @param {number} indent 缩进空格数。
 * @param {boolean} pretty 是否格式化输出。
 * @return {string} JSON 文本。
 */
function stringifyJsonValue(value, sortMode, indent, pretty) {
  const serializable = sortMode === "source" ? value : createOrderedJsonClone(value, sortMode);
  return pretty ? JSON.stringify(serializable, null, indent) : JSON.stringify(serializable);
}

/**
 * 从稳定节点路径里读取下一个片段。
 *
 * 路径格式和 worker 端 `buildNodePath()` 一一对应：
 * 点语法只承载安全标识符，复杂键名统一走 bracket + JSON string，
 * 这样主线程可以在不依赖 `eval` 的情况下安全解析选中节点。
 *
 * @param {string} path 完整节点路径。
 * @param {number} startIndex 当前读取起点。
 * @return {{ segment: string | number, nextIndex: number }} 当前片段和值后续游标。
 * @throws {Error} 路径格式非法时抛错。
 */
function readNodePathSegment(path, startIndex) {
  if (path[startIndex] === ".") {
    let cursor = startIndex + 1;

    while (cursor < path.length && /[A-Za-z0-9_$]/u.test(path[cursor])) {
      cursor += 1;
    }

    if (cursor === startIndex + 1) {
      throw new Error("节点路径缺少字段名。");
    }

    return {
      segment: path.slice(startIndex + 1, cursor),
      nextIndex: cursor,
    };
  }

  if (path[startIndex] !== "[") {
    throw new Error("节点路径格式不受支持。");
  }

  const tokenStart = startIndex + 1;

  if (path[tokenStart] === "\"") {
    let cursor = tokenStart + 1;
    let escaped = false;

    while (cursor < path.length) {
      const char = path[cursor];

      if (escaped) {
        escaped = false;
      } else if (char === "\\") {
        escaped = true;
      } else if (char === "\"") {
        break;
      }

      cursor += 1;
    }

    if (cursor >= path.length || path[cursor + 1] !== "]") {
      throw new Error("节点路径中的字符串键未正确闭合。");
    }

    return {
      segment: JSON.parse(path.slice(tokenStart, cursor + 1)),
      nextIndex: cursor + 2,
    };
  }

  const bracketEnd = path.indexOf("]", tokenStart);

  if (bracketEnd === -1) {
    throw new Error("节点路径中的数组下标未闭合。");
  }

  const rawIndex = path.slice(tokenStart, bracketEnd);

  if (!/^\d+$/u.test(rawIndex)) {
    throw new Error("节点路径中的数组下标非法。");
  }

  return {
    segment: Number(rawIndex),
    nextIndex: bracketEnd + 1,
  };
}

/**
 * 将节点路径拆成可遍历的字段片段。
 *
 * @param {string} path 稳定节点路径。
 * @return {Array<string | number>} 路径片段数组。
 * @throws {Error} 路径格式非法时抛错。
 */
function parseNodePath(path) {
  if (path === "$") {
    return [];
  }

  if (!path.startsWith("$")) {
    throw new Error("节点路径必须以 $ 开头。");
  }

  /** @type {Array<string | number>} */
  const segments = [];
  let cursor = 1;

  while (cursor < path.length) {
    const token = readNodePathSegment(path, cursor);
    segments.push(token.segment);
    cursor = token.nextIndex;
  }

  return segments;
}

/**
 * 按稳定节点路径从根值里解析出目标子树。
 *
 * 复制节点值走这条本地主线程路径，是为了避免等待 worker 异步返回后丢失用户手势，
 * 从而被浏览器判定为“非用户触发复制”。
 *
 * @param {unknown} rootValue 根 JSON 值。
 * @param {string} path 稳定节点路径。
 * @return {unknown} 目标子树值。
 * @throws {Error} 路径不存在或结构类型不匹配时抛错。
 */
function resolveNodeValueByPath(rootValue, path) {
  let current = rootValue;

  for (const segment of parseNodePath(path)) {
    if (typeof segment === "number") {
      if (!Array.isArray(current) || segment < 0 || segment >= current.length) {
        throw new Error("数组节点不存在。");
      }

      current = current[segment];
      continue;
    }

    if (!current || typeof current !== "object" || !Object.prototype.hasOwnProperty.call(current, segment)) {
      throw new Error("对象节点不存在。");
    }

    current = /** @type {Record<string, unknown>} */ (current)[segment];
  }

  return current;
}

/**
 * 根据错误信息构建逐行文本预览模型。
 *
 * 错误态也必须保留“完整数据 + 错误位置”能力，所以这里不截断任何行，
 * 再由虚拟滚动只绘制可见区域，兼顾诊断完整性和大文本性能。
 *
 * @param {string} text 原始文本。
 * @param {{ line: number | null, column: number | null, message: string } | null} error 解析错误。
 * @return {Array<{ lineNumber: number, text: string, isError: boolean, errorColumn: number | null, meta: string }>} 行模型。
 */
function buildRawRows(text, error) {
  const lines = text.length === 0 ? [""] : text.split("\n");

  return lines.map((line, index) => {
    const lineNumber = index + 1;
    const isError = Boolean(error && error.line === lineNumber);

    return {
      lineNumber,
      text: line,
      isError,
      errorColumn: isError ? error?.column ?? null : null,
      meta: isError && error ? `列 ${error.column ?? "?"} · ${error.message}` : "",
    };
  });
}

/**
 * 构建元数据卡片 DOM。
 *
 * @param {Array<{ label: string, value: string }>} cards 展示项。
 * @return {HTMLElement} 元数据网格节点。
 */
function buildMetaGrid(cards) {
  const grid = document.createElement("div");
  grid.className = "meta-grid";

  for (const card of cards) {
    const element = document.createElement("article");
    element.className = "meta-card";

    const label = document.createElement("span");
    label.className = "meta-card-label";
    label.textContent = card.label;

    const value = document.createElement("strong");
    value.className = "meta-card-value";
    value.textContent = card.value;

    element.append(label, value);
    grid.append(element);
  }

  return grid;
}

/**
 * 识别一行 JSON 文本中的语法片段。
 *
 * 这里不依赖完整 JSON.parse，而是用容错正则做轻量标记：
 * 即使输入尚未闭合、当前处于非法状态，也能给编辑区和文本预览提供尽量稳定的颜色提示，
 * 避免“一出错就整块失去高亮”，影响排查体验。
 *
 * @param {string} line 单行 JSON 文本。
 * @return {Array<{ start: number, end: number, text: string, className: string }>} 语法 token 列表。
 */
function tokenizeJsonLine(line) {
  const tokenPattern = /"(?:\\.|[^"\\])*"|true|false|null|-?(?:0|[1-9]\d*)(?:\.\d+)?(?:[eE][+-]?\d+)?|[{}\[\]]|[:,]/g;
  /** @type {Array<{ start: number, end: number, text: string, className: string }>} */
  const tokens = [];
  let cursor = 0;

  for (const match of line.matchAll(tokenPattern)) {
    const text = match[0];
    const start = match.index ?? 0;
    const end = start + text.length;

    if (start > cursor) {
      tokens.push({
        start: cursor,
        end: start,
        text: line.slice(cursor, start),
        className: "syntax-plain",
      });
    }

    let className = "syntax-plain";

    if (text === "{" || text === "}" || text === "[" || text === "]") {
      className = "syntax-brace";
    } else if (text === ":" || text === ",") {
      className = "syntax-punct";
    } else if (text.startsWith("\"")) {
      className = /^\s*:/.test(line.slice(end)) ? "syntax-key" : "syntax-value-string";
    } else if (text === "true" || text === "false") {
      className = "syntax-value-boolean";
    } else if (text === "null") {
      className = "syntax-value-null";
    } else {
      className = "syntax-value-number";
    }

    tokens.push({
      start,
      end,
      text,
      className,
    });

    cursor = end;
  }

  if (cursor < line.length) {
    tokens.push({
      start: cursor,
      end: line.length,
      text: line.slice(cursor),
      className: "syntax-plain",
    });
  }

  return tokens;
}

/**
 * 基于 token 构建带错误定位能力的高亮片段。
 *
 * 错误字符需要和语法高亮共存，所以这里不能简单用 innerHTML；
 * 统一走 DOM 片段拼装，才能在同一 token 内精确拆出“正常文本 / 错误字符 / 正常文本”三段。
 *
 * @param {string} line 单行 JSON 文本。
 * @param {number | null} errorColumn 1-based 错误列；null 表示当前行无错误。
 * @param {Array<{ start: number, end: number, isCurrent?: boolean }>} searchRanges 当前行命中的搜索区间。
 * @return {DocumentFragment} 可直接挂到 DOM 的片段。
 */
function buildJsonSyntaxFragment(line, errorColumn = null, searchRanges = []) {
  const fragment = document.createDocumentFragment();
  const errorIndex = typeof errorColumn === "number" ? Math.max(0, errorColumn - 1) : null;
  const tokens = tokenizeJsonLine(line);

  /**
   * 将一段文本按搜索命中和错误字符共同拆分后挂到片段上。
   *
   * @param {string} text 当前文本。
   * @param {string} className 语法 class。
   * @param {number} startOffset 该文本在原行中的起始列。
   * @return {void}
   */
  const appendToken = (text, className, startOffset) => {
    if (!text) {
      return;
    }

    const endOffset = startOffset + text.length;
    const boundaries = new Set([startOffset, endOffset]);

    if (errorIndex !== null && errorIndex >= startOffset && errorIndex < endOffset) {
      boundaries.add(errorIndex);
      boundaries.add(errorIndex + 1);
    }

    for (const range of searchRanges) {
      if (range.end <= startOffset || range.start >= endOffset) {
        continue;
      }

      boundaries.add(Math.max(startOffset, range.start));
      boundaries.add(Math.min(endOffset, range.end));
    }

    const sortedBoundaries = [...boundaries].sort((left, right) => left - right);

    for (let index = 0; index < sortedBoundaries.length - 1; index += 1) {
      const segmentStart = sortedBoundaries[index];
      const segmentEnd = sortedBoundaries[index + 1];

      if (segmentStart === segmentEnd) {
        continue;
      }

      const segment = text.slice(segmentStart - startOffset, segmentEnd - startOffset);
      const span = document.createElement("span");
      span.className = className;

      const currentRange = searchRanges.find((range) => range.start < segmentEnd && range.end > segmentStart);

      if (currentRange) {
        span.classList.add("syntax-search-hit");

        if (currentRange.isCurrent) {
          span.classList.add("syntax-search-current");
        }
      }

      if (errorIndex !== null && errorIndex >= segmentStart && errorIndex < segmentEnd) {
        span.classList.add("error-char");
      }

      span.textContent = segment;
      fragment.append(span);
    }
  };

  if (tokens.length === 0) {
    if (line.length > 0) {
      appendToken(line, "syntax-plain", 0);
    } else if (errorIndex !== null) {
      const errorSpan = document.createElement("span");
      errorSpan.className = "error-char";
      errorSpan.textContent = "▯";
      fragment.append(errorSpan);
    } else {
      fragment.append(document.createTextNode(" "));
    }

    return fragment;
  }

  for (const token of tokens) {
    appendToken(token.text, token.className, token.start);
  }

  if (errorIndex !== null && errorIndex >= line.length) {
    const errorSpan = document.createElement("span");
    errorSpan.className = "error-char";
    errorSpan.textContent = "▯";
    fragment.append(errorSpan);
  }

  return fragment;
}

/**
 * 存储桥接层。
 *
 * 这里故意改用 `sessionStorage` 而不是扩展级共享存储，
 * 这样每个插件 tab 都拥有自己的独立会话，不会把上一页的 JSON、搜索词或预览模式串到新开的页面里。
 */
class StorageBridge {
  /**
   * @param {string} storageKey 持久化 key。
   */
  constructor(storageKey) {
    /** @type {string} */
    this.storageKey = storageKey;
  }

  /**
   * 读取持久化状态。
   *
   * @return {Promise<Partial<typeof DEFAULT_SETTINGS>>} 已保存状态。
   */
  async load() {
    try {
      const raw = sessionStorage.getItem(this.storageKey);
      return raw ? JSON.parse(raw) : {};
    } catch (error) {
      console.warn("无法读取会话存储，已回退到默认状态。", error);
      return {};
    }
  }

  /**
   * 写入持久化状态。
   *
   * @param {typeof DEFAULT_SETTINGS} snapshot 需要保存的快照。
   * @return {Promise<void>}
   */
  async save(snapshot) {
    sessionStorage.setItem(this.storageKey, JSON.stringify(snapshot));
  }
}

/**
 * 与 worker 通信的轻量 RPC 封装。
 *
 * worker 负责 parse / rebuild / stringify，这里把消息 id 和 Promise 映射封装起来，
 * 保持主线程业务逻辑只关心“请求什么”和“拿到什么”。
 */
class WorkerBridge {
  /**
   * @param {string} workerUrl worker 文件 URL。
   */
  constructor(workerUrl) {
    /** @type {Worker} */
    this.worker = new Worker(workerUrl);
    /** @type {Map<string, { resolve: (value: any) => void, reject: (error: Error) => void }>} */
    this.pending = new Map();
    /** @type {number} */
    this.sequence = 0;

    this.worker.onmessage = (event) => {
      const { id, result, error } = event.data;
      const job = this.pending.get(id);

      if (!job) {
        return;
      }

      this.pending.delete(id);

      if (error) {
        job.reject(new Error(String(error)));
        return;
      }

      job.resolve(result);
    };

    this.worker.onerror = (event) => {
      const message = event.message || "worker 执行失败";

      for (const [, job] of this.pending) {
        job.reject(new Error(message));
      }

      this.pending.clear();
    };
  }

  /**
   * 发送一条 RPC 请求。
   *
   * @param {string} type 请求类型。
   * @param {Record<string, any>} payload 请求载荷。
   * @return {Promise<any>} worker 结果。
   */
  request(type, payload) {
    const id = `job-${this.sequence += 1}`;

    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve, reject });
      this.worker.postMessage({ id, type, payload });
    });
  }
}

/**
 * 固定行高的虚拟滚动容器。
 *
 * 预览区树节点和文本行都采用固定高度，这是虚拟滚动可以极简实现的前提；
 * 一旦切到元数据卡片视图，就退回静态内容模式，避免为低密度场景引入额外复杂度。
 */
class VirtualList {
  /**
   * @param {HTMLElement} container 承载容器。
   */
  constructor(container) {
    /** @type {HTMLElement} */
    this.container = container;
    /** @type {HTMLElement} */
    this.itemsHost = document.createElement("div");
    /** @type {HTMLElement} */
    this.spacer = document.createElement("div");
    /** @type {number} */
    this.rowHeight = 32;
    /** @type {number} */
    this.overscan = 8;
    /** @type {Array<any>} */
    this.items = [];
    /** @type {(item: any, index: number) => HTMLElement} */
    this.renderRow = () => document.createElement("div");
    /** @type {boolean} */
    this.staticMode = false;
    /** @type {string} */
    this.emptyMessage = "暂无可展示内容";
    /** @type {number | null} */
    this.rafId = null;

    this.container.style.position = "relative";
    this.spacer.className = "virtual-list-spacer";
    this.itemsHost.className = "virtual-list-items";
    this.container.append(this.spacer, this.itemsHost);

    this.container.addEventListener("scroll", () => this.scheduleRender());
    this.resizeObserver = new ResizeObserver(() => this.scheduleRender());
    this.resizeObserver.observe(this.container);
  }

  /**
   * 更新渲染配置。
   *
   * @param {{ rowHeight: number, renderRow: (item: any, index: number) => HTMLElement, emptyMessage?: string }} config 配置项。
   * @return {void}
   */
  setConfig(config) {
    this.rowHeight = config.rowHeight;
    this.renderRow = config.renderRow;
    this.emptyMessage = config.emptyMessage || this.emptyMessage;
    this.staticMode = false;
    this.ensureMounted();
  }

  /**
   * 设置虚拟列表数据。
   *
   * @param {Array<any>} items 行数据。
   * @return {void}
   */
  setItems(items) {
    this.staticMode = false;
    this.ensureMounted();
    this.items = items;
    this.scheduleRender();
  }

  /**
   * 切换到静态内容模式。
   *
   * @param {HTMLElement} node 需要直接挂载的内容节点。
   * @return {void}
   */
  setStaticContent(node) {
    this.staticMode = true;
    this.items = [];
    this.cancelScheduledRender();
    this.container.replaceChildren(node);
  }

  /**
   * 滚动到指定索引附近。
   *
   * @param {number} index 行索引。
   * @return {void}
   */
  scrollToIndex(index) {
    if (this.staticMode || index < 0 || index >= this.items.length) {
      return;
    }

    const top = Math.max(0, index * this.rowHeight - this.container.clientHeight / 2 + this.rowHeight * 2);
    this.container.scrollTop = top;
    this.scheduleRender();
  }

  /**
   * 确保虚拟滚动结构仍挂在容器中。
   *
   * @return {void}
   */
  ensureMounted() {
    const firstChild = this.container.firstChild;

    if (firstChild !== this.spacer || this.container.childNodes.length !== 2) {
      this.container.replaceChildren(this.spacer, this.itemsHost);
    }
  }

  /**
   * 用 requestAnimationFrame 合并频繁的 scroll / resize，避免每一个原生滚动事件都同步改 DOM。
   *
   * @return {void}
   */
  scheduleRender() {
    if (this.staticMode || this.rafId !== null) {
      return;
    }

    this.rafId = window.requestAnimationFrame(() => {
      this.rafId = null;
      this.render();
    });
  }

  /**
   * 取消已排队但尚未执行的渲染。
   *
   * @return {void}
   */
  cancelScheduledRender() {
    if (this.rafId === null) {
      return;
    }

    window.cancelAnimationFrame(this.rafId);
    this.rafId = null;
  }

  /**
   * 按当前滚动窗口渲染可见行。
   *
   * @return {void}
   */
  render() {
    if (this.staticMode) {
      return;
    }

    this.ensureMounted();

    if (this.items.length === 0) {
      this.spacer.style.height = "0px";
      this.itemsHost.style.height = "0px";

      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = this.emptyMessage;
      this.itemsHost.replaceChildren(empty);
      return;
    }

    const viewportHeight = Math.max(this.container.clientHeight, this.rowHeight);
    const start = Math.max(0, Math.floor(this.container.scrollTop / this.rowHeight) - this.overscan);
    const visibleCount = Math.ceil(viewportHeight / this.rowHeight) + this.overscan * 2;
    const end = Math.min(this.items.length, start + visibleCount);
    const totalHeight = this.items.length * this.rowHeight;

    this.spacer.style.height = `${totalHeight}px`;
    this.itemsHost.style.height = `${totalHeight}px`;

    const fragment = document.createDocumentFragment();

    for (let index = start; index < end; index += 1) {
      const row = this.renderRow(this.items[index], index);
      row.style.position = "absolute";
      row.style.top = `${index * this.rowHeight}px`;
      row.style.left = "0";
      row.style.right = "0";
      row.style.height = `${this.rowHeight}px`;
      fragment.append(row);
    }

    this.itemsHost.replaceChildren(fragment);
  }
}

/**
 * JSON 工作台主控制器。
 */
class JsonPrismDeckApp {
  /**
   * @param {{
   *   storage: StorageBridge,
   *   worker: WorkerBridge,
   *   previewList: VirtualList
   * }} deps 依赖项。
   */
  constructor(deps) {
    /** @type {StorageBridge} */
    this.storage = deps.storage;
    /** @type {WorkerBridge} */
    this.worker = deps.worker;
    /** @type {VirtualList} */
    this.previewList = deps.previewList;
    /** @type {number} */
    this.parseVersion = 0;
    /** @type {number | null} */
    this.noticeTimer = null;
    /** @type {string | null} */
    this.noticeText = null;
    /** @type {"default" | "success" | "warning"} */
    this.noticeTone = "default";
    /** @type {{ mode: "error" | "selection", index: number } | null} */
    this.pendingScroll = null;
    /** @type {boolean} */
    this.isDraggingSplitter = false;
    /** @type {Map<string, any>} */
    this.nodeMap = new Map();

    this.state = {
      ...DEFAULT_SETTINGS,
      valid: false,
      empty: false,
      metadata: null,
      error: null,
      nodes: [],
      rootId: "$",
      expandableIds: new Set(),
      expandedIds: new Set(["$"]),
      hasCustomExpansion: false,
      autoExpandedIds: new Set(),
      formattedText: "",
      selectedNodeId: "$",
      searchMatches: [],
      currentMatchIndex: 0,
      editorSearchMatches: [],
      editorCurrentMatchIndex: 0,
    };

    this.schedulePersist = debounce(() => {
      void this.persistState();
    }, 180);

    this.scheduleParse = debounce(() => {
      void this.refreshJsonState();
    }, 220);

    this.refs = {
      body: document.body,
      workspace: /** @type {HTMLElement} */ (getRequiredElement("workspace")),
      splitter: /** @type {HTMLElement} */ (getRequiredElement("splitter")),
      jsonEditor: /** @type {HTMLTextAreaElement} */ (getRequiredElement("jsonEditor")),
      editorSyntax: /** @type {HTMLElement} */ (getRequiredElement("editorSyntax")),
      lineNumbers: /** @type {HTMLElement} */ (getRequiredElement("lineNumbers")),
      editorDropzone: /** @type {HTMLElement} */ (getRequiredElement("editorDropzone")),
      fileInput: /** @type {HTMLInputElement} */ (getRequiredElement("fileInput")),
      previewContent: /** @type {HTMLElement} */ (getRequiredElement("previewContent")),
      previewState: /** @type {HTMLElement} */ (getRequiredElement("previewState")),
      summaryChips: /** @type {HTMLElement} */ (getRequiredElement("summaryChips")),
      searchTargetSelect: /** @type {HTMLSelectElement} */ (getRequiredElement("searchTargetSelect")),
      searchInput: /** @type {HTMLInputElement} */ (getRequiredElement("searchInput")),
      searchCount: /** @type {HTMLElement} */ (getRequiredElement("searchCount")),
      selectionPath: /** @type {HTMLElement} */ (getRequiredElement("selectionPath")),
      selectionMeta: /** @type {HTMLElement} */ (getRequiredElement("selectionMeta")),
      editorLineStats: /** @type {HTMLElement} */ (getRequiredElement("editorLineStats")),
      editorByteStats: /** @type {HTMLElement} */ (getRequiredElement("editorByteStats")),
      heroValidity: /** @type {HTMLElement} */ (getRequiredElement("heroValidity")),
      noticeToast: /** @type {HTMLElement} */ (getRequiredElement("noticeToast")),
      editorHint: /** @type {HTMLElement} */ (getRequiredElement("editorHint")),
      sortSelect: /** @type {HTMLSelectElement} */ (getRequiredElement("sortSelect")),
      indentSelect: /** @type {HTMLSelectElement} */ (getRequiredElement("indentSelect")),
      editorFontDownBtn: /** @type {HTMLButtonElement} */ (getRequiredElement("editorFontDownBtn")),
      editorFontResetBtn: /** @type {HTMLButtonElement} */ (getRequiredElement("editorFontResetBtn")),
      editorFontUpBtn: /** @type {HTMLButtonElement} */ (getRequiredElement("editorFontUpBtn")),
      previewFontDownBtn: /** @type {HTMLButtonElement} */ (getRequiredElement("previewFontDownBtn")),
      previewFontResetBtn: /** @type {HTMLButtonElement} */ (getRequiredElement("previewFontResetBtn")),
      previewFontUpBtn: /** @type {HTMLButtonElement} */ (getRequiredElement("previewFontUpBtn")),
      formatBtn: /** @type {HTMLButtonElement} */ (getRequiredElement("formatBtn")),
      minifyBtn: /** @type {HTMLButtonElement} */ (getRequiredElement("minifyBtn")),
      sortFormatBtn: /** @type {HTMLButtonElement} */ (getRequiredElement("sortFormatBtn")),
      copyBtn: /** @type {HTMLButtonElement} */ (getRequiredElement("copyBtn")),
      downloadBtn: /** @type {HTMLButtonElement} */ (getRequiredElement("downloadBtn")),
      importBtn: /** @type {HTMLButtonElement} */ (getRequiredElement("importBtn")),
      clearBtn: /** @type {HTMLButtonElement} */ (getRequiredElement("clearBtn")),
      sampleBtn: /** @type {HTMLButtonElement} */ (getRequiredElement("sampleBtn")),
      expandAllBtn: /** @type {HTMLButtonElement} */ (getRequiredElement("expandAllBtn")),
      collapseAllBtn: /** @type {HTMLButtonElement} */ (getRequiredElement("collapseAllBtn")),
      searchPrevBtn: /** @type {HTMLButtonElement} */ (getRequiredElement("searchPrevBtn")),
      searchNextBtn: /** @type {HTMLButtonElement} */ (getRequiredElement("searchNextBtn")),
      copyPathBtn: /** @type {HTMLButtonElement} */ (getRequiredElement("copyPathBtn")),
      copyValueBtn: /** @type {HTMLButtonElement} */ (getRequiredElement("copyValueBtn")),
    };
  }

  /**
   * 初始化应用。
   *
   * @return {Promise<void>}
   */
  async init() {
    await this.restoreState();
    this.bindEvents();

    this.refs.jsonEditor.value = this.state.text;
    this.refs.searchTargetSelect.value = this.state.searchTarget;
    this.refs.searchInput.value = this.state.searchQuery;
    this.refs.sortSelect.value = this.state.sortMode;
    this.refs.indentSelect.value = String(this.state.indent);
    this.refs.editorHint.textContent = isMacLikePlatform()
      ? "快捷键：⌘ + Shift + F 格式化，⌘ + Shift + M 压缩，⌘ + S 下载。"
      : "快捷键：Ctrl + Shift + F 格式化，Ctrl + Shift + M 压缩，Ctrl + S 下载。";

    this.applyLayout(this.state.layout);
    this.applyTheme(this.state.theme);
    this.applyPreviewModeButtons();
    this.renderSearchTargetControl();
    this.renderSearchInputPlaceholder();
    this.applyTypographySettings();
    this.renderFontControls();
    this.renderNotice();
    this.renderEditorSyntax();
    this.renderLineNumbers();
    this.refreshEditorMetrics();
    await this.refreshJsonState();
  }

  /**
   * 绑定界面事件。
   *
   * @return {void}
   */
  bindEvents() {
    this.refs.jsonEditor.addEventListener("input", () => this.handleEditorInput());
    this.refs.jsonEditor.addEventListener("scroll", () => {
      this.refs.lineNumbers.scrollTop = this.refs.jsonEditor.scrollTop;
      this.syncEditorSyntaxScroll();
    });
    this.refs.jsonEditor.addEventListener("keydown", (event) => this.handleEditorKeydown(event));

    this.refs.formatBtn.addEventListener("click", () => void this.applyStringify("pretty", "source"));
    this.refs.minifyBtn.addEventListener("click", () => void this.applyStringify("minify", "source"));
    this.refs.sortFormatBtn.addEventListener("click", () => void this.applyStringify("pretty", this.state.sortMode));
    this.refs.copyBtn.addEventListener("click", () => void this.copyText(this.refs.jsonEditor.value, "已复制编辑区 JSON。"));
    this.refs.downloadBtn.addEventListener("click", () => this.downloadEditorText());
    this.refs.importBtn.addEventListener("click", () => this.refs.fileInput.click());
    this.refs.clearBtn.addEventListener("click", () => this.replaceEditorText(""));
    this.refs.sampleBtn.addEventListener("click", () => this.replaceEditorText(DEFAULT_SAMPLE_TEXT));

    this.refs.indentSelect.addEventListener("change", () => {
      this.state.indent = Number(this.refs.indentSelect.value);
      this.schedulePersist();
      void this.rebuildIfPossible();
    });

    this.refs.editorFontDownBtn.addEventListener("click", () => this.adjustFontSize("editor", -1));
    this.refs.editorFontUpBtn.addEventListener("click", () => this.adjustFontSize("editor", 1));
    this.refs.editorFontResetBtn.addEventListener("click", () => this.resetFontSize("editor"));
    this.refs.previewFontDownBtn.addEventListener("click", () => this.adjustFontSize("preview", -1));
    this.refs.previewFontUpBtn.addEventListener("click", () => this.adjustFontSize("preview", 1));
    this.refs.previewFontResetBtn.addEventListener("click", () => this.resetFontSize("preview"));

    this.refs.searchTargetSelect.addEventListener("change", () => {
      const searchTarget = /** @type {"preview" | "editor"} */ (this.refs.searchTargetSelect.value === "editor" ? "editor" : "preview");

      if (searchTarget === this.state.searchTarget) {
        return;
      }

      this.state.searchTarget = searchTarget;
      this.renderSearchTargetControl();
      this.renderSearchInputPlaceholder();

      if (searchTarget === "preview") {
        this.updateSearchResults();
      } else {
        this.updateEditorSearchResults();
      }

      this.renderSummary();
      this.renderEditorSyntax();
      this.renderLineNumbers();
      this.renderPreview();
      this.updateActionAvailability();
      this.schedulePersist();
    });

    this.refs.sortSelect.addEventListener("change", () => {
      this.state.sortMode = /** @type {"source" | "asc" | "desc"} */ (this.refs.sortSelect.value);
      this.schedulePersist();
      void this.rebuildIfPossible();
    });

    document.querySelectorAll("[data-layout]").forEach((button) => {
      button.addEventListener("click", () => {
        const layout = /** @type {"horizontal" | "vertical"} */ (button.getAttribute("data-layout"));
        this.state.layout = layout;
        this.applyLayout(layout);
        this.schedulePersist();
      });
    });

    document.querySelectorAll("[data-theme-choice]").forEach((button) => {
      button.addEventListener("click", () => {
        const theme = /** @type {"dawn" | "night"} */ (button.getAttribute("data-theme-choice"));
        this.state.theme = theme;
        this.applyTheme(theme);
        this.schedulePersist();
      });
    });

    document.querySelectorAll("[data-preview-mode]").forEach((button) => {
      button.addEventListener("click", () => {
        this.state.previewMode = /** @type {"tree" | "text" | "meta"} */ (button.getAttribute("data-preview-mode"));
        this.applyPreviewModeButtons();
        this.renderPreview();
        this.renderSummary();
        this.updateActionAvailability();
        this.schedulePersist();
      });
    });

    this.refs.expandAllBtn.addEventListener("click", () => {
      this.state.expandedIds = new Set(this.state.expandableIds);
      this.state.hasCustomExpansion = true;
      this.renderPreview();
    });

    this.refs.collapseAllBtn.addEventListener("click", () => {
      this.state.expandedIds = new Set();
      this.state.hasCustomExpansion = true;
      this.renderPreview();
    });

    this.refs.searchInput.addEventListener("input", () => {
      this.state.searchQuery = this.refs.searchInput.value.trim();
      if (this.state.searchTarget === "preview") {
        this.updateSearchResults();
      } else {
        this.updateEditorSearchResults();
      }

      this.renderSummary();
      this.renderEditorSyntax();
      this.renderLineNumbers();
      this.renderPreview();
      this.updateActionAvailability();
      this.schedulePersist();
    });

    this.refs.searchNextBtn.addEventListener("click", () => this.navigateSearch(1));
    this.refs.searchPrevBtn.addEventListener("click", () => this.navigateSearch(-1));

    this.refs.copyPathBtn.addEventListener("click", () => void this.copySelectedPath());
    this.refs.copyValueBtn.addEventListener("click", () => void this.copySelectedValue());

    this.refs.fileInput.addEventListener("change", async () => {
      const [file] = Array.from(this.refs.fileInput.files || []);

      if (file) {
        await this.importFile(file);
      }

      this.refs.fileInput.value = "";
    });

    this.refs.editorDropzone.addEventListener("dragenter", (event) => {
      event.preventDefault();
      this.refs.editorDropzone.classList.add("is-dragover");
    });

    this.refs.editorDropzone.addEventListener("dragover", (event) => {
      event.preventDefault();
      this.refs.editorDropzone.classList.add("is-dragover");
    });

    this.refs.editorDropzone.addEventListener("dragleave", (event) => {
      if (event.relatedTarget instanceof Node && this.refs.editorDropzone.contains(event.relatedTarget)) {
        return;
      }

      this.refs.editorDropzone.classList.remove("is-dragover");
    });

    this.refs.editorDropzone.addEventListener("drop", async (event) => {
      event.preventDefault();
      this.refs.editorDropzone.classList.remove("is-dragover");
      const [file] = Array.from(event.dataTransfer?.files || []);

      if (file) {
        await this.importFile(file);
      }
    });

    this.refs.previewContent.addEventListener("click", (event) => this.handlePreviewClick(event));
    this.refs.splitter.addEventListener("pointerdown", (event) => this.beginSplitterDrag(event));
    this.refs.splitter.addEventListener("keydown", (event) => this.handleSplitterKeydown(event));

    window.addEventListener("pointermove", (event) => this.handleSplitterMove(event));
    window.addEventListener("pointerup", () => this.endSplitterDrag());
  }

  /**
   * 从持久化中恢复设置。
   *
   * @return {Promise<void>}
   */
  async restoreState() {
    const stored = await this.storage.load();

    this.state.text = typeof stored.text === "string" ? stored.text : DEFAULT_SETTINGS.text;
    this.state.indent = stored.indent === 4 ? 4 : 2;
    this.state.layout = stored.layout === "vertical" ? "vertical" : "horizontal";
    this.state.theme = stored.theme === "night" ? "night" : "dawn";
    this.state.previewMode = "tree";
    this.state.sortMode = stored.sortMode === "asc" || stored.sortMode === "desc" ? stored.sortMode : "source";
    this.state.workspaceRatio = clamp(Number(stored.workspaceRatio) || DEFAULT_SETTINGS.workspaceRatio, 0.25, 0.75);
    this.state.searchQuery = typeof stored.searchQuery === "string" ? stored.searchQuery : "";
    this.state.searchTarget = stored.searchTarget === "editor" ? "editor" : "preview";
    this.state.editorFontSize = clamp(Number(stored.editorFontSize) || DEFAULT_SETTINGS.editorFontSize, FONT_LIMITS.editor.min, FONT_LIMITS.editor.max);
    this.state.previewFontSize = clamp(Number(stored.previewFontSize) || DEFAULT_SETTINGS.previewFontSize, FONT_LIMITS.preview.min, FONT_LIMITS.preview.max);
  }

  /**
   * 将当前可持久化状态写入存储。
   *
   * @return {Promise<void>}
   */
  async persistState() {
    await this.storage.save({
      text: this.refs.jsonEditor.value,
      indent: this.state.indent,
      layout: this.state.layout,
      theme: this.state.theme,
      sortMode: this.state.sortMode,
      workspaceRatio: this.state.workspaceRatio,
      searchQuery: this.state.searchQuery,
      searchTarget: this.state.searchTarget,
      editorFontSize: this.state.editorFontSize,
      previewFontSize: this.state.previewFontSize,
    });
  }

  /**
   * 响应编辑区输入。
   *
   * @return {void}
   */
  handleEditorInput() {
    this.state.text = this.refs.jsonEditor.value;
    if (this.state.searchTarget === "editor") {
      this.updateEditorSearchResults();
    }
    this.renderEditorSyntax();
    this.renderLineNumbers();
    this.refreshEditorMetrics();
    this.renderSummary();
    this.updateActionAvailability();
    this.schedulePersist();
    this.scheduleParse();
  }

  /**
   * 处理编辑区快捷键。
   *
   * @param {KeyboardEvent} event 键盘事件。
   * @return {void}
   */
  handleEditorKeydown(event) {
    const modifierPressed = isMacLikePlatform() ? event.metaKey : event.ctrlKey;

    if (!modifierPressed) {
      return;
    }

    if (event.shiftKey && event.key.toLowerCase() === "f") {
      event.preventDefault();
      void this.applyStringify("pretty", "source");
      return;
    }

    if (event.shiftKey && event.key.toLowerCase() === "m") {
      event.preventDefault();
      void this.applyStringify("minify", "source");
      return;
    }

    if (event.key.toLowerCase() === "s") {
      event.preventDefault();
      this.downloadEditorText();
    }
  }

  /**
   * 用新的文本整体替换编辑区。
   *
   * @param {string} text 新文本。
   * @return {void}
   */
  replaceEditorText(text) {
    this.refs.jsonEditor.value = text;
    this.state.text = text;

    if (this.state.searchTarget === "editor") {
      this.updateEditorSearchResults();
    }

    this.renderEditorSyntax();
    this.renderLineNumbers();
    this.refreshEditorMetrics();
    this.renderSummary();
    this.updateActionAvailability();
    void this.refreshJsonState();
    this.schedulePersist();
  }

  /**
   * 导入文件到编辑区。
   *
   * @param {File} file 用户选择的文件。
   * @return {Promise<void>}
   */
  async importFile(file) {
    const text = await file.text();
    this.replaceEditorText(text);
    this.pushNotice(`已导入 ${file.name}`);
  }

  /**
   * 解析当前 JSON。
   *
   * @return {Promise<void>}
   */
  async refreshJsonState() {
    this.state.text = this.refs.jsonEditor.value;
    const text = this.state.text;

    if (!text.trim()) {
      this.applyEmptyState();
      this.renderAll();
      return;
    }

    const version = this.parseVersion += 1;

    try {
      const result = await this.worker.request("parse", {
        text,
        sortMode: this.state.sortMode,
        indent: this.state.indent,
      });

      if (version !== this.parseVersion) {
        return;
      }

      if (result.ok) {
        this.applyValidResult(result);
      } else {
        this.applyInvalidResult(result);
      }
    } catch (error) {
      this.applyWorkerFailure(error instanceof Error ? error.message : String(error));
    }

    this.renderAll();
  }

  /**
   * 在已有有效 JSON 的前提下重建派生视图。
   *
   * @return {Promise<void>}
   */
  async rebuildIfPossible() {
    if (!this.state.valid) {
      await this.refreshJsonState();
      return;
    }

    try {
      const result = await this.worker.request("rebuild", {
        sortMode: this.state.sortMode,
        indent: this.state.indent,
      });

      this.applyValidResult(result);
      this.renderAll();
    } catch (error) {
      console.warn("重建失败，已回退重新解析。", error);
      await this.refreshJsonState();
    }
  }

  /**
   * 应用成功解析结果。
   *
   * @param {any} result worker 成功载荷。
   * @return {void}
   */
  applyValidResult(result) {
    const hadValidTree = this.state.valid && this.state.nodes.length > 0;

    this.state.valid = true;
    this.state.empty = false;
    this.state.error = null;
    this.state.metadata = result.metadata;
    this.state.formattedText = result.formattedText;
    this.state.nodes = result.nodes;
    this.state.rootId = result.rootId;
    this.state.expandableIds = new Set(result.expandableIds);
    this.nodeMap = new Map(result.nodes.map((node) => [node.id, node]));

    if (!hadValidTree || !this.state.hasCustomExpansion) {
      // 首次得到合法 JSON 时默认全部展开，满足“先看全貌，再按需收起”的浏览习惯。
      this.state.expandedIds = new Set(result.expandableIds);
    } else {
      this.state.expandedIds = new Set([...this.state.expandedIds].filter((id) => this.state.expandableIds.has(id)));
    }

    if (!this.state.expandedIds.has(this.state.rootId)) {
      this.state.expandedIds.add(this.state.rootId);
    }

    if (!this.nodeMap.has(this.state.selectedNodeId)) {
      this.state.selectedNodeId = this.state.rootId;
    }

    this.updateSearchResults();
  }

  /**
   * 应用非法 JSON 的失败结果。
   *
   * @param {any} result worker 错误载荷。
   * @return {void}
   */
  applyInvalidResult(result) {
    this.state.valid = false;
    this.state.empty = false;
    this.state.metadata = result.metadata;
    this.state.error = result.error;
    this.state.formattedText = "";
    this.state.nodes = [];
    this.state.expandableIds = new Set();
    this.state.expandedIds = new Set();
    this.state.hasCustomExpansion = false;
    this.state.autoExpandedIds = new Set();
    this.state.searchMatches = [];
    this.state.currentMatchIndex = 0;
    this.state.selectedNodeId = "$";
    this.nodeMap = new Map();
    this.pendingScroll = result.error?.line ? { mode: "error", index: Math.max(0, result.error.line - 1) } : null;
  }

  /**
   * 应用空输入状态。
   *
   * @return {void}
   */
  applyEmptyState() {
    this.state.valid = false;
    this.state.empty = true;
    this.state.metadata = {
      chars: 0,
      bytes: 0,
      lines: 0,
    };
    this.state.error = null;
    this.state.formattedText = "";
    this.state.nodes = [];
    this.state.expandableIds = new Set();
    this.state.expandedIds = new Set();
    this.state.hasCustomExpansion = false;
    this.state.autoExpandedIds = new Set();
    this.state.searchMatches = [];
    this.state.currentMatchIndex = 0;
    this.state.selectedNodeId = "$";
    this.nodeMap = new Map();
    this.pendingScroll = null;
  }

  /**
   * 应用 worker 执行失败状态。
   *
   * @param {string} message 错误信息。
   * @return {void}
   */
  applyWorkerFailure(message) {
    this.state.valid = false;
    this.state.empty = false;
    this.state.error = {
      message,
      rawMessage: message,
      line: null,
      column: null,
      position: null,
    };
    this.state.nodes = [];
    this.state.metadata = buildRawRows(this.state.text, null).length
      ? {
          chars: this.state.text.length,
          bytes: new TextEncoder().encode(this.state.text).length,
          lines: this.state.text.split("\n").length,
        }
      : {
          chars: 0,
          bytes: 0,
          lines: 0,
        };
    this.nodeMap = new Map();
  }

  /**
   * 根据当前 query 更新搜索命中与自动展开祖先。
   *
   * @return {void}
   */
  updateSearchResults() {
    const query = this.state.searchQuery.trim().toLowerCase();

    if (!this.state.valid || !query) {
      this.state.searchMatches = [];
      this.state.autoExpandedIds = new Set();
      this.state.currentMatchIndex = 0;
      return;
    }

    const matches = this.state.nodes
      .filter((node) => node.searchText.includes(query))
      .map((node) => node.id);

    const ancestors = new Set();

    for (const id of matches) {
      let cursor = this.nodeMap.get(id);

      while (cursor?.parentId) {
        ancestors.add(cursor.parentId);
        cursor = this.nodeMap.get(cursor.parentId);
      }
    }

    this.state.searchMatches = matches;
    this.state.autoExpandedIds = ancestors;

    if (matches.length === 0) {
      this.state.currentMatchIndex = 0;
      return;
    }

    const existingIndex = matches.indexOf(this.state.selectedNodeId);

    if (existingIndex !== -1) {
      this.state.currentMatchIndex = existingIndex;
      return;
    }

    this.state.currentMatchIndex = 0;
    this.state.selectedNodeId = matches[0];
    this.pendingScroll = { mode: "selection", index: 0 };
  }

  /**
   * 计算编辑区搜索命中。
   *
   * 编辑区搜索直接基于原始文本做大小写不敏感匹配，
   * 这样即使 JSON 还没通过校验，也能继续定位到正在排查的错误字段或值。
   *
   * @return {void}
   */
  updateEditorSearchResults() {
    const query = this.state.searchQuery.trim();
    const text = this.refs.jsonEditor.value;

    if (!query || !text) {
      this.state.editorSearchMatches = [];
      this.state.editorCurrentMatchIndex = 0;
      return;
    }

    const lines = text.split("\n");
    /** @type {Array<{ lineNumber: number, start: number, end: number, absoluteStart: number, absoluteEnd: number }>} */
    const matches = [];
    let absoluteOffset = 0;

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const ranges = buildSearchRanges(line, query);

      for (const range of ranges) {
        matches.push({
          lineNumber: index + 1,
          start: range.start,
          end: range.end,
          absoluteStart: absoluteOffset + range.start,
          absoluteEnd: absoluteOffset + range.end,
        });
      }

      absoluteOffset += line.length + 1;
    }

    this.state.editorSearchMatches = matches;

    if (matches.length === 0) {
      this.state.editorCurrentMatchIndex = 0;
      return;
    }

    this.state.editorCurrentMatchIndex = 0;
  }

  /**
   * 获取当前激活搜索域的命中数量。
   *
   * @return {number} 命中数量。
   */
  getActiveSearchMatchCount() {
    return this.state.searchTarget === "editor" ? this.state.editorSearchMatches.length : this.state.searchMatches.length;
  }

  /**
   * 渲染搜索域下拉框状态。
   *
   * 搜索模式已经收敛为单个下拉控件，这里直接同步 select value，
   * 避免状态变化后界面还停留在旧文案。
   *
   * @return {void}
   */
  renderSearchTargetControl() {
    this.refs.searchTargetSelect.value = this.state.searchTarget;
  }

  /**
   * 根据当前搜索域更新输入框提示。
   *
   * @return {void}
   */
  renderSearchInputPlaceholder() {
    this.refs.searchInput.placeholder = this.state.searchTarget === "editor"
      ? "搜索编辑区原始 JSON 文本"
      : "搜索预览键名 / 值 / 路径";
  }

  /**
   * 让编辑区滚动到当前搜索命中附近。
   *
   * @return {void}
   */
  scrollToCurrentEditorMatch() {
    const match = this.state.editorSearchMatches[this.state.editorCurrentMatchIndex];

    if (!match) {
      return;
    }

    const lineTop = Math.max(0, (match.lineNumber - 1) * this.getEditorLineHeight() - this.refs.jsonEditor.clientHeight / 2 + this.getEditorLineHeight() * 2);
    this.refs.jsonEditor.scrollTop = lineTop;
    this.refs.lineNumbers.scrollTop = this.refs.jsonEditor.scrollTop;
    this.syncEditorSyntaxScroll();
  }

  /**
   * 在搜索命中之间切换。
   *
   * @param {number} step 步长，1 为下一个，-1 为上一个。
   * @return {void}
   */
  navigateSearch(step) {
    if (this.state.searchTarget === "editor") {
      if (this.state.editorSearchMatches.length === 0) {
        return;
      }

      const length = this.state.editorSearchMatches.length;
      this.state.editorCurrentMatchIndex = (this.state.editorCurrentMatchIndex + step + length) % length;
      this.renderSummary();
      this.renderEditorSyntax();
      this.renderLineNumbers();
      this.scrollToCurrentEditorMatch();
      return;
    }

    if (this.state.searchMatches.length === 0) {
      return;
    }

    const length = this.state.searchMatches.length;
    this.state.currentMatchIndex = (this.state.currentMatchIndex + step + length) % length;
    this.state.selectedNodeId = this.state.searchMatches[this.state.currentMatchIndex];
    this.renderSummary();
    this.renderPreview();
    this.renderSelection();
  }

  /**
   * 处理预览区点击。
   *
   * @param {MouseEvent} event 点击事件。
   * @return {void}
   */
  handlePreviewClick(event) {
    if (this.state.previewMode !== "tree" || !this.state.valid) {
      return;
    }

    const target = /** @type {HTMLElement | null} */ (event.target instanceof HTMLElement ? event.target : null);

    if (!target) {
      return;
    }

    const toggle = target.closest("[data-action='toggle']");

    if (toggle instanceof HTMLElement) {
      const nodeId = toggle.getAttribute("data-node-id");

      if (nodeId) {
        this.state.selectedNodeId = nodeId;
        this.renderSelection();
        this.toggleNode(nodeId);
      }

      return;
    }

    // 用户拖选树形文本后浏览器依然会补发 click；
    // 这里显式跳过行选中，避免“刚选完文本就被切到别的节点”，影响复制体验。
    if (this.hasPreviewTextSelection()) {
      return;
    }

    const row = target.closest("[data-node-id]");

    if (row instanceof HTMLElement) {
      const nodeId = row.getAttribute("data-node-id");

      if (nodeId && this.nodeMap.has(nodeId)) {
        this.state.selectedNodeId = nodeId;
        this.renderSelection();
        this.renderPreview();
      }
    }
  }

  /**
   * 判断预览区当前是否存在有效文本选区。
   *
   * 只在选区锚点或焦点落在预览区内部时返回 true，
   * 这样不会误伤编辑区或页面其他位置的正常选择行为。
   *
   * @return {boolean} 是否存在预览区内的非折叠文本选区。
   */
  hasPreviewTextSelection() {
    const selection = window.getSelection();

    if (!selection || selection.isCollapsed || !selection.toString()) {
      return false;
    }

    const anchorInPreview = Boolean(selection.anchorNode && this.refs.previewContent.contains(selection.anchorNode));
    const focusInPreview = Boolean(selection.focusNode && this.refs.previewContent.contains(selection.focusNode));

    return anchorInPreview || focusInPreview;
  }

  /**
   * 切换单个节点的展开状态。
   *
   * @param {string} nodeId 节点 id。
   * @return {void}
   */
  toggleNode(nodeId) {
    if (!this.state.expandableIds.has(nodeId)) {
      return;
    }

    if (this.isNodeLockedByPreviewSearch(nodeId)) {
      this.pushNotice("当前节点下有搜索命中，清空搜索后才能折叠。", 2600, "warning");
      return;
    }

    this.state.hasCustomExpansion = true;

    if (this.state.expandedIds.has(nodeId)) {
      this.state.expandedIds.delete(nodeId);
    } else {
      this.state.expandedIds.add(nodeId);
    }

    this.renderPreview();
  }

  /**
   * 判断节点是否被“预览搜索自动展开”锁定。
   *
   * 搜索态必须保证命中路径对用户可见，否则父节点一旦被折叠，
   * 搜索计数还在但结果消失，会让人误以为搜索失效；因此这里选择锁定折叠并给出明确提示。
   *
   * @param {string} nodeId 节点 id。
   * @return {boolean} 是否处于搜索锁定展开状态。
   */
  isNodeLockedByPreviewSearch(nodeId) {
    return this.state.searchTarget === "preview"
      && Boolean(this.state.searchQuery.trim())
      && this.state.autoExpandedIds.has(nodeId);
  }

  /**
   * 计算当前树形视图的可见行。
   *
   * @return {Array<{ node: any, depth: number, expanded: boolean, isMatch: boolean, isSelected: boolean }>} 虚拟滚动行。
   */
  buildVisibleTreeRows() {
    if (!this.state.valid || !this.nodeMap.has(this.state.rootId)) {
      return [];
    }

    /** @type {Array<{ node: any, depth: number, expanded: boolean, isMatch: boolean, isSelected: boolean }>} */
    const rows = [];
    /** @type {Array<{ id: string, depth: number }>} */
    const stack = [{ id: this.state.rootId, depth: 0 }];

    while (stack.length > 0) {
      const current = stack.pop();

      if (!current) {
        break;
      }

      const node = this.nodeMap.get(current.id);

      if (!node) {
        continue;
      }

      const expanded = this.state.expandedIds.has(node.id) || this.state.autoExpandedIds.has(node.id);
      rows.push({
        node,
        depth: current.depth,
        expanded,
        isMatch: this.state.searchMatches.includes(node.id),
        isSelected: this.state.selectedNodeId === node.id,
      });

      if (node.expandable && expanded) {
        for (let index = node.childIds.length - 1; index >= 0; index -= 1) {
          stack.push({
            id: node.childIds[index],
            depth: current.depth + 1,
          });
        }
      }
    }

    return rows;
  }

  /**
   * 渲染全部依赖状态的 UI。
   *
   * @return {void}
   */
  renderAll() {
    this.renderFontControls();
    this.renderEditorSyntax();
    this.renderLineNumbers();
    this.refreshEditorMetrics();
    this.renderHeroMetrics();
    this.renderSummary();
    this.renderSelection();
    this.renderPreview();
    this.updateActionAvailability();
  }

  /**
   * 渲染行号，并在错误态强调出错行。
   *
   * @return {void}
   */
  renderLineNumbers() {
    const lineCount = Math.max(1, this.refs.jsonEditor.value.split("\n").length);
    const fragment = document.createDocumentFragment();
    const matchedLines = new Set(this.state.searchTarget === "editor" ? this.state.editorSearchMatches.map((match) => match.lineNumber) : []);
    const currentEditorMatch = this.state.searchTarget === "editor"
      ? (this.state.editorSearchMatches[this.state.editorCurrentMatchIndex] || null)
      : null;

    for (let line = 1; line <= lineCount; line += 1) {
      const item = document.createElement("span");
      item.className = "line-number";

      if (this.state.error?.line === line) {
        item.classList.add("is-error");
      }

      if (matchedLines.has(line)) {
        item.classList.add("is-search-match");
      }

      if (currentEditorMatch?.lineNumber === line) {
        item.classList.add("is-search-current");
      }

      item.textContent = String(line);
      fragment.append(item);
    }

    this.refs.lineNumbers.replaceChildren(fragment);
    this.refs.lineNumbers.scrollTop = this.refs.jsonEditor.scrollTop;
  }

  /**
   * 刷新编辑区语法高亮层。
   *
   * 编辑区仍以 textarea 作为真实输入控件，保证选区、输入法和快捷键行为稳定；
   * 语法层只是镜像文本并提供着色，不参与事件命中，因此不会破坏原生编辑体验。
   *
   * @return {void}
   */
  renderEditorSyntax() {
    const text = this.refs.jsonEditor.value;
    const lines = text.length === 0 ? [""] : text.split("\n");
    const fragment = document.createDocumentFragment();
    /** @type {Map<number, Array<{ start: number, end: number, isCurrent?: boolean }>>} */
    const searchRangesByLine = new Map();
    const currentMatch = this.state.searchTarget === "editor"
      ? (this.state.editorSearchMatches[this.state.editorCurrentMatchIndex] || null)
      : null;

    if (this.state.searchTarget === "editor" && this.state.searchQuery) {
      for (const match of this.state.editorSearchMatches) {
        const ranges = searchRangesByLine.get(match.lineNumber) || [];
        ranges.push({
          start: match.start,
          end: match.end,
          isCurrent: Boolean(currentMatch && currentMatch.absoluteStart === match.absoluteStart),
        });
        searchRangesByLine.set(match.lineNumber, ranges);
      }
    }

    for (let index = 0; index < lines.length; index += 1) {
      const line = lines[index];
      const row = document.createElement("div");
      row.className = "editor-syntax-line";
      row.append(buildJsonSyntaxFragment(line, null, searchRangesByLine.get(index + 1) || []));
      fragment.append(row);
    }

    this.refs.editorSyntax.replaceChildren(fragment);
    this.syncEditorSyntaxScroll();
  }

  /**
   * 同步高亮层与 textarea 的滚动位置。
   *
   * 高亮层不滚动自身，而是通过 transform 跟随 textarea 的 scrollTop/scrollLeft，
   * 这样可以完全复用 textarea 的原生滚动条与选择行为。
   *
   * @return {void}
   */
  syncEditorSyntaxScroll() {
    this.refs.editorSyntax.style.transform = `translate(${-this.refs.jsonEditor.scrollLeft}px, ${-this.refs.jsonEditor.scrollTop}px)`;
  }

  /**
   * 刷新编辑区文本规模信息。
   *
   * @return {void}
   */
  refreshEditorMetrics() {
    const text = this.refs.jsonEditor.value;
    const lines = text.length === 0 ? 0 : text.split("\n").length;
    const bytes = new TextEncoder().encode(text).length;

    this.refs.editorLineStats.textContent = `${formatCount(lines)} 行`;
    this.refs.editorByteStats.textContent = formatBytes(bytes);
  }

  /**
   * 获取当前编辑区行高。
   *
   * 编辑区使用 textarea + 语法镜像双层结构，字号变化时两层必须共用同一行高，
   * 否则滚动同步和错误行号都会错位。
   *
   * @return {number} 行高像素值。
   */
  getEditorLineHeight() {
    return this.state.editorFontSize + 10;
  }

  /**
   * 获取当前树形预览行高。
   *
   * 虚拟滚动依赖固定行高估算可见区，所以字号调整不能只改 CSS；
   * 这里统一从字号推导出行高，让渲染窗口和真实 DOM 始终一致。
   *
   * @return {number} 行高像素值。
   */
  getTreeRowHeight() {
    return this.state.previewFontSize + 18;
  }

  /**
   * 获取当前文本预览字号。
   *
   * 文本预览比树形信息密度更高，字号略小一档可以在放大后仍保留足够的单屏信息量。
   *
   * @return {number} 文本预览字号像素值。
   */
  getRawPreviewFontSize() {
    return Math.max(FONT_LIMITS.preview.min, this.state.previewFontSize - 1);
  }

  /**
   * 获取当前文本预览行高。
   *
   * @return {number} 行高像素值。
   */
  getRawRowHeight() {
    return this.getRawPreviewFontSize() + 15;
  }

  /**
   * 将字号状态投射到 CSS 变量。
   *
   * 组件的字号、行高和虚拟列表高度都通过这些变量共享，
   * 这样编辑区、树形预览和文本预览可以一起响应缩放，而不需要分别改一堆硬编码样式。
   *
   * @return {void}
   */
  applyTypographySettings() {
    this.refs.body.style.setProperty("--editor-font-size", `${this.state.editorFontSize}px`);
    this.refs.body.style.setProperty("--editor-line-height", `${this.getEditorLineHeight()}px`);
    this.refs.body.style.setProperty("--preview-tree-font-size", `${this.state.previewFontSize}px`);
    this.refs.body.style.setProperty("--preview-tree-row-height", `${this.getTreeRowHeight()}px`);
    this.refs.body.style.setProperty("--preview-raw-font-size", `${this.getRawPreviewFontSize()}px`);
    this.refs.body.style.setProperty("--preview-raw-row-height", `${this.getRawRowHeight()}px`);
  }

  /**
   * 渲染字号控制按钮状态。
   *
   * 重置按钮直接展示当前字号，用户不必在工具栏和内容区之间来回对照。
   *
   * @return {void}
   */
  renderFontControls() {
    this.refs.editorFontResetBtn.textContent = `${this.state.editorFontSize}px`;
    this.refs.previewFontResetBtn.textContent = `${this.state.previewFontSize}px`;
    this.refs.editorFontDownBtn.disabled = this.state.editorFontSize <= FONT_LIMITS.editor.min;
    this.refs.editorFontUpBtn.disabled = this.state.editorFontSize >= FONT_LIMITS.editor.max;
    this.refs.previewFontDownBtn.disabled = this.state.previewFontSize <= FONT_LIMITS.preview.min;
    this.refs.previewFontUpBtn.disabled = this.state.previewFontSize >= FONT_LIMITS.preview.max;
  }

  /**
   * 调整指定区域字号。
   *
   * @param {"editor" | "preview"} target 目标区域。
   * @param {number} delta 调整步长。
   * @return {void}
   */
  adjustFontSize(target, delta) {
    const limits = target === "editor" ? FONT_LIMITS.editor : FONT_LIMITS.preview;
    const stateKey = target === "editor" ? "editorFontSize" : "previewFontSize";
    const nextSize = clamp(this.state[stateKey] + delta, limits.min, limits.max);

    if (nextSize === this.state[stateKey]) {
      return;
    }

    this.state[stateKey] = nextSize;
    this.handleTypographyChange(target === "preview" ? "已调整预览区字号。" : "已调整编辑区字号。");
  }

  /**
   * 重置指定区域字号。
   *
   * @param {"editor" | "preview"} target 目标区域。
   * @return {void}
   */
  resetFontSize(target) {
    const limits = target === "editor" ? FONT_LIMITS.editor : FONT_LIMITS.preview;
    const stateKey = target === "editor" ? "editorFontSize" : "previewFontSize";

    if (this.state[stateKey] === limits.default) {
      return;
    }

    this.state[stateKey] = limits.default;
    this.handleTypographyChange(target === "preview" ? "已重置预览区字号。" : "已重置编辑区字号。");
  }

  /**
   * 应用字号变化带来的联动刷新。
   *
   * @param {string} notice 完成提示。
   * @return {void}
   */
  handleTypographyChange(notice) {
    this.applyTypographySettings();
    this.renderFontControls();
    this.renderLineNumbers();
    this.renderEditorSyntax();
    this.renderPreview();
    this.schedulePersist();
    this.pushNotice(notice);
  }

  /**
   * 渲染顶部概要指标。
   *
   * @return {void}
   */
  renderHeroMetrics() {
    if (this.state.empty) {
      this.refs.heroValidity.textContent = "等待输入";
      return;
    }

    this.refs.heroValidity.textContent = this.state.valid ? "JSON 合法" : "JSON 错误";
  }

  /**
   * 渲染摘要区 chip。
   *
   * @return {void}
   */
  renderSummary() {
    const chips = [];

    if (this.state.empty) {
      chips.push({ text: "等待 JSON 输入", className: "" });
    } else if (this.state.valid) {
      chips.push({ text: "校验通过", className: "is-success" });
      chips.push({ text: `根类型 · ${this.state.metadata.rootType}`, className: "" });
      chips.push({ text: `字节 · ${formatBytes(this.state.metadata.bytes)}`, className: "" });
      chips.push({ text: `节点 · ${formatCount(this.state.metadata.nodeCount)}`, className: "" });
      chips.push({ text: `最大深度 · ${formatCount(this.state.metadata.maxDepth)}`, className: "" });
      chips.push({ text: `排序 · ${this.getSortLabel(this.state.sortMode)}`, className: "" });
    } else {
      chips.push({ text: "校验失败", className: "is-warning" });
      chips.push({ text: `字节 · ${formatBytes(this.state.metadata?.bytes || 0)}`, className: "" });
      chips.push({
        text: this.state.error?.line ? `错误位置 · 第 ${this.state.error.line} 行 ${this.state.error.column || "?"} 列` : "错误位置 · 未知",
        className: "is-warning",
      });
    }

    const fragment = document.createDocumentFragment();

    for (const chip of chips) {
      const element = document.createElement("span");
      element.className = "mini-pill";

      if (chip.className) {
        element.classList.add(chip.className);
      }

      element.textContent = chip.text;
      fragment.append(element);
    }

    this.refs.summaryChips.replaceChildren(fragment);
    const matchTotal = this.getActiveSearchMatchCount();
    const current = matchTotal > 0
      ? (this.state.searchTarget === "editor" ? this.state.editorCurrentMatchIndex + 1 : this.state.currentMatchIndex + 1)
      : 0;
    this.refs.searchCount.textContent = `${current} / ${matchTotal}`;
  }

  /**
   * 渲染当前选中节点的路径和摘要。
   *
   * @return {void}
   */
  renderSelection() {
    if (!this.state.valid) {
      this.refs.selectionPath.textContent = "$";
      this.refs.selectionMeta.textContent = this.state.empty
        ? "输入有效 JSON 后会在这里显示当前节点路径和摘要。"
        : this.state.error?.line
          ? `错误位置：第 ${this.state.error.line} 行，第 ${this.state.error.column || "?"} 列`
          : "当前无法提取节点信息。";
      return;
    }

    const node = this.nodeMap.get(this.state.selectedNodeId) || this.nodeMap.get(this.state.rootId);

    if (!node) {
      this.refs.selectionPath.textContent = "$";
      this.refs.selectionMeta.textContent = "尚未选中节点";
      return;
    }

    this.refs.selectionPath.textContent = node.path;
    this.refs.selectionMeta.textContent = node.metaLabel ? `${node.metaLabel} · ${node.preview}` : node.preview;
  }

  /**
   * 渲染预览内容。
   *
   * @return {void}
   */
  renderPreview() {
    this.refs.previewContent.classList.toggle("is-invalid", !this.state.valid && !this.state.empty);
    this.renderPreviewState();

    if (this.state.empty) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "把 JSON 粘贴到编辑区，预览会在这里实时刷新。";
      this.previewList.setStaticContent(empty);
      return;
    }

    if (!this.state.valid) {
      this.renderRawPreview(this.state.text, this.state.error);
      return;
    }

    if (this.state.previewMode === "meta") {
      this.renderMetaPreview();
      return;
    }

    if (this.state.previewMode === "text") {
      this.renderRawPreview(this.state.formattedText, null);
      return;
    }

    this.renderTreePreview();
  }

  /**
   * 渲染树形预览。
   *
   * @return {void}
   */
  renderTreePreview() {
    const rows = this.buildVisibleTreeRows();
    const query = this.state.searchTarget === "preview" ? this.state.searchQuery.trim() : "";

    this.previewList.setConfig({
      rowHeight: this.getTreeRowHeight(),
      emptyMessage: "当前没有可见节点。",
      renderRow: (item, index) => this.renderTreeRow(item, query, index),
    });
    this.previewList.setItems(rows);

    const selectedIndex = rows.findIndex((row) => row.node.id === this.state.selectedNodeId);

    if (selectedIndex !== -1 && this.state.searchMatches.length > 0) {
      this.previewList.scrollToIndex(selectedIndex);
    }
  }

  /**
   * 渲染文本或错误预览。
   *
   * @param {string} text 预览文本。
   * @param {{ line: number | null, column: number | null, message: string } | null} error 解析错误。
   * @return {void}
   */
  renderRawPreview(text, error) {
    const rows = buildRawRows(text, error);
    const query = this.state.searchTarget === "preview" ? this.state.searchQuery.trim() : "";

    this.previewList.setConfig({
      rowHeight: this.getRawRowHeight(),
      emptyMessage: "当前没有文本内容。",
      renderRow: (item) => this.renderRawRow(item, query),
    });
    this.previewList.setItems(rows);

    if (this.pendingScroll?.mode === "error") {
      this.previewList.scrollToIndex(this.pendingScroll.index);
      this.pendingScroll = null;
    }
  }

  /**
   * 渲染元数据卡片视图。
   *
   * @return {void}
   */
  renderMetaPreview() {
    const metadata = this.state.metadata;

    if (!metadata) {
      const empty = document.createElement("div");
      empty.className = "empty-state";
      empty.textContent = "暂无元数据。";
      this.previewList.setStaticContent(empty);
      return;
    }

    const cards = [
      { label: "根类型", value: metadata.rootType },
      { label: "原始字节", value: formatBytes(metadata.bytes) },
      { label: "原始行数", value: formatCount(metadata.lines) },
      { label: "格式化行数", value: formatCount(metadata.formattedLines) },
      { label: "字段数", value: formatCount(metadata.keyCount) },
      { label: "总节点数", value: formatCount(metadata.nodeCount) },
      { label: "叶子节点", value: formatCount(metadata.leafCount) },
      { label: "对象数量", value: formatCount(metadata.objectCount) },
      { label: "数组数量", value: formatCount(metadata.arrayCount) },
      { label: "字符串", value: formatCount(metadata.stringCount) },
      { label: "数字", value: formatCount(metadata.numberCount) },
      { label: "布尔", value: formatCount(metadata.booleanCount) },
      { label: "null", value: formatCount(metadata.nullCount) },
      { label: "最大深度", value: formatCount(metadata.maxDepth) },
      { label: "排序模式", value: this.getSortLabel(this.state.sortMode) },
      { label: "预览布局", value: this.state.layout === "horizontal" ? "左右分栏" : "上下分栏" },
    ];

    this.previewList.setStaticContent(buildMetaGrid(cards));
  }

  /**
   * 创建一行树节点。
   *
   * @param {{ node: any, depth: number, expanded: boolean, isMatch: boolean, isSelected: boolean }} row 行数据。
   * @param {string} query 当前搜索词。
   * @param {number} index 当前可见行序号，从 0 开始。
   * @return {HTMLElement} 行元素。
   */
  renderTreeRow(row, query, index) {
    const element = document.createElement("div");
    element.className = "preview-row tree-row";
    element.dataset.nodeId = row.node.id;

    if (row.isSelected) {
      element.classList.add("is-selected");
    }

    if (row.isMatch) {
      element.classList.add("is-match");
    }

    const toggle = document.createElement("button");
    toggle.className = "tree-toggle";
    toggle.type = "button";
    const isSearchLocked = this.isNodeLockedByPreviewSearch(row.node.id);

    if (row.node.expandable) {
      toggle.dataset.action = "toggle";
      toggle.dataset.nodeId = row.node.id;
      toggle.textContent = row.expanded ? "▾" : "▸";

      if (isSearchLocked) {
        toggle.classList.add("is-search-locked");
        toggle.title = "当前节点下有搜索命中，清空搜索后才能折叠";
      }
    } else {
      toggle.disabled = true;
      toggle.textContent = "·";
    }

    /**
     * 树形视图没有稳定的“原始源码行号”，这里展示的是当前可见行序号。
     * 这样展开/折叠与虚拟滚动复用同一套索引口径，用户看到的编号才会连续且可定位。
     */
    const number = document.createElement("div");
    number.className = "tree-line-number";
    number.textContent = String(index + 1);

    const content = document.createElement("div");
    content.className = "tree-row-content";
    content.style.paddingLeft = `${10 + row.depth * 18}px`;

    const key = document.createElement("span");
    key.className = "tree-key";
    key.append(buildHighlightedFragment(row.node.keyLabel, query));

    const value = document.createElement("span");
    value.className = "tree-value";

    if (row.node.expandable) {
      const open = document.createElement("span");
      open.className = "syntax-brace";
      open.textContent = row.node.type === "array" ? "[" : "{";

      const middle = document.createElement("span");
      middle.className = "tree-summary";
      middle.textContent = row.node.childCount > 0 ? "…" : "";

      const close = document.createElement("span");
      close.className = "syntax-brace";
      close.textContent = row.node.type === "array" ? "]" : "}";

      value.append(open);

      if (middle.textContent) {
        value.append(document.createTextNode(" "), middle, document.createTextNode(" "));
      }

      value.append(close);
    } else {
      value.classList.add(`syntax-value-${row.node.type === "null" ? "null" : row.node.type}`);
      value.append(buildHighlightedFragment(row.node.preview, query));
    }

    const path = document.createElement("span");
    path.className = "tree-path";
    path.append(buildHighlightedFragment(row.node.path, query));

    content.append(toggle);

    if (row.node.keyLabel) {
      content.append(key);
    }

    content.append(value);

    if (row.node.expandable && row.node.metaLabel) {
      const meta = document.createElement("span");
      meta.className = "meta-pill";
      meta.textContent = row.node.metaLabel;
      content.append(meta);
    }

    content.append(path);
    element.append(number, content);
    return element;
  }

  /**
   * 创建一行文本预览。
   *
   * @param {{ lineNumber: number, text: string, isError: boolean, errorColumn: number | null, meta: string }} row 行数据。
   * @param {string} query 当前搜索词。
   * @return {HTMLElement} 行元素。
   */
  renderRawRow(row, query) {
    const element = document.createElement("div");
    element.className = "preview-row raw-row";
    const searchRanges = buildSearchRanges(row.text, query);

    if (row.isError) {
      element.classList.add("is-error");
    }

    if (searchRanges.length > 0) {
      element.classList.add("is-search-match");
    }

    const number = document.createElement("div");
    number.className = "raw-line-number";
    number.textContent = String(row.lineNumber);

    const code = document.createElement("div");
    code.className = "raw-line-code";
    code.append(buildJsonSyntaxFragment(row.text, row.errorColumn, searchRanges));

    const meta = document.createElement("div");
    meta.className = "raw-line-meta";
    meta.textContent = row.meta;

    element.append(number, code, meta);
    return element;
  }

  /**
   * 渲染预览区说明文案。
   *
   * @return {void}
   */
  renderPreviewState() {
    if (this.noticeText) {
      this.refs.previewState.textContent = this.noticeText;
      return;
    }

    if (this.state.empty) {
      this.refs.previewState.textContent = "预览区待命中。";
      return;
    }

    if (!this.state.valid) {
      this.refs.previewState.textContent = this.state.error?.line
        ? `错误位置：第 ${this.state.error.line} 行，第 ${this.state.error.column || "?"} 列。`
        : "JSON 解析失败。";
      return;
    }

    if (this.state.previewMode === "tree") {
      const visible = this.buildVisibleTreeRows().length;
      this.refs.previewState.textContent = `树形预览 · 可见节点 ${formatCount(visible)} / 总节点 ${formatCount(this.state.metadata.nodeCount)} · 已启用虚拟滚动。`;
      return;
    }

    if (this.state.previewMode === "text") {
      this.refs.previewState.textContent = `文本预览 · ${formatCount(this.state.metadata.formattedLines)} 行 · 按 ${this.getSortLabel(this.state.sortMode)} 展示。`;
      return;
    }

    this.refs.previewState.textContent = "元数据视图 · 展示规模、结构分布和当前预览配置。";
  }

  /**
   * 控制工具栏可用性。
   *
   * @return {void}
   */
  updateActionAvailability() {
    const hasText = this.refs.jsonEditor.value.trim().length > 0;
    const hasValidJson = this.state.valid;
    const treeMode = hasValidJson && this.state.previewMode === "tree";
    const matchCount = this.getActiveSearchMatchCount();

    this.refs.formatBtn.disabled = !hasValidJson;
    this.refs.minifyBtn.disabled = !hasValidJson;
    this.refs.sortFormatBtn.disabled = !hasValidJson;
    this.refs.copyBtn.disabled = !hasText;
    this.refs.downloadBtn.disabled = !hasText;
    this.refs.expandAllBtn.disabled = !treeMode;
    this.refs.collapseAllBtn.disabled = !treeMode;
    this.refs.copyPathBtn.disabled = !hasValidJson;
    this.refs.copyValueBtn.disabled = !hasValidJson;
    this.refs.searchPrevBtn.disabled = matchCount === 0;
    this.refs.searchNextBtn.disabled = matchCount === 0;
  }

  /**
   * 应用布局切换。
   *
   * @param {"horizontal" | "vertical"} layout 布局模式。
   * @return {void}
   */
  applyLayout(layout) {
    this.refs.workspace.dataset.layout = layout;
    this.refs.workspace.style.setProperty("--workspace-ratio", String(this.state.workspaceRatio));
    this.refs.splitter.setAttribute("aria-orientation", layout === "horizontal" ? "vertical" : "horizontal");

    document.querySelectorAll("[data-layout]").forEach((button) => {
      button.classList.toggle("is-active", button.getAttribute("data-layout") === layout);
    });
  }

  /**
   * 应用主题切换。
   *
   * @param {"dawn" | "night"} theme 主题名。
   * @return {void}
   */
  applyTheme(theme) {
    this.refs.body.dataset.theme = theme;

    document.querySelectorAll("[data-theme-choice]").forEach((button) => {
      button.classList.toggle("is-active", button.getAttribute("data-theme-choice") === theme);
    });
  }

  /**
   * 应用预览模式按钮状态。
   *
   * @return {void}
   */
  applyPreviewModeButtons() {
    document.querySelectorAll("[data-preview-mode]").forEach((button) => {
      button.classList.toggle("is-active", button.getAttribute("data-preview-mode") === this.state.previewMode);
    });
  }

  /**
   * 触发格式化/压缩输出并回写到编辑区。
   *
   * @param {"pretty" | "minify"} style 输出样式。
   * @param {"source" | "asc" | "desc"} sortMode 排序模式。
   * @return {Promise<void>}
   */
  async applyStringify(style, sortMode) {
    if (!this.state.valid) {
      this.pushNotice("当前 JSON 非法，无法执行格式化或压缩。");
      return;
    }

    const result = await this.worker.request("stringify", {
      style,
      sortMode,
      indent: this.state.indent,
    });

    this.replaceEditorText(result.text);
    this.pushNotice(style === "minify" ? "已压缩并回写编辑区。" : "已格式化并回写编辑区。");
  }

  /**
   * 下载当前编辑区内容。
   *
   * 下载始终以编辑区文本为准，确保用户手工微调过的文本不会因为预览排序或派生视图而被悄悄改写。
   *
   * @return {void}
   */
  downloadEditorText() {
    const text = this.refs.jsonEditor.value;

    if (!text.trim()) {
      return;
    }

    const blob = new Blob([text], { type: "application/json;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = `json-prism-${buildTimestamp()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
    this.pushNotice("已下载当前 JSON 文件。");
  }

  /**
   * 复制当前选中节点的路径。
   *
   * @return {Promise<void>}
   */
  async copySelectedPath() {
    const node = this.nodeMap.get(this.state.selectedNodeId) || this.nodeMap.get(this.state.rootId);

    if (!node) {
      this.pushNotice("当前没有可复制的节点路径。");
      return;
    }

    await this.copyText(node.path, "已复制当前节点路径。");
  }

  /**
   * 构造当前选中节点的可复制 JSON 文本。
   *
   * 复制值必须尽量在原始点击事件的同步阶段完成文本准备，
   * 否则等 worker 异步返回后再执行复制，Chromium 很容易把它判定为“非用户触发”而拒绝写入剪贴板。
   *
   * @return {string} 当前选中节点的 JSON 文本。
   * @throws {Error} 当前文本已失效或节点路径无法解析时抛错。
   */
  buildSelectedNodeValueText() {
    const targetPath = this.nodeMap.has(this.state.selectedNodeId) ? this.state.selectedNodeId : this.state.rootId;
    const rootValue = JSON.parse(this.refs.jsonEditor.value);
    const targetValue = resolveNodeValueByPath(rootValue, targetPath);
    return stringifyJsonValue(targetValue, this.state.sortMode, this.state.indent, true);
  }

  /**
   * 复制当前选中节点的值。
   *
   * 容器节点同样走 stringify，而不是只复制摘要文案；
   * 这样用户可以直接拿到合法 JSON 子树，后续粘贴到接口调试或测试数据里无需再清洗。
   *
   * @return {Promise<void>}
   */
  async copySelectedValue() {
    if (!this.state.valid) {
      this.pushNotice("当前 JSON 无法复制节点值。");
      return;
    }

    try {
      await this.copyText(this.buildSelectedNodeValueText(), "已复制当前节点值。", {
        duration: 2800,
        tone: "success",
      });
    } catch (error) {
      console.error("Copy selected value failed.", error);
      this.pushNotice("复制当前节点值失败，请重试。");
    }
  }

  /**
   * 复制文本到剪贴板。
   *
   * @param {string} text 需要复制的文本。
   * @param {string} notice 复制成功后的提示文案。
   * @param {{ duration?: number, tone?: "default" | "success" | "warning" }} [noticeOptions] 提示展示配置。
   * @return {Promise<void>}
   */
  async copyText(text, notice, noticeOptions = {}) {
    if (!text) {
      this.pushNotice("当前没有可复制的内容。");
      return;
    }

    const duration = Number.isFinite(noticeOptions.duration) ? Number(noticeOptions.duration) : 2200;
    const tone = noticeOptions.tone || "default";

    // 优先走同步复制命令，尽量把复制动作留在原始用户点击的同一事件栈里，
    // 这样“复制路径/复制值”不会因为中间插入异步任务而失去用户手势。
    if (this.copyTextWithExecCommand(text)) {
      this.pushNotice(notice, duration, tone);
      return;
    }

    try {
      await this.writeClipboardText(text);
      this.pushNotice(notice, duration, tone);
    } catch (error) {
      console.error("Copy to clipboard failed.", error);
      this.pushNotice("复制失败，请检查浏览器是否允许写入剪贴板。");
    }
  }

  /**
   * 将文本写入剪贴板。
   *
   * 扩展页里的异步 Clipboard API 会受到权限、焦点和浏览器版本差异影响；
   * 这里只把它当作首选路径，失败后立即回退到 `execCommand("copy")`，
   * 避免用户点击“复制路径/复制值”后完全没有结果。
   *
   * @param {string} text 需要写入剪贴板的文本。
   * @return {Promise<void>}
   * @throws {Error} 两条复制链路都失败时抛错。
   */
  async writeClipboardText(text) {
    if (navigator.clipboard?.writeText) {
      try {
        await navigator.clipboard.writeText(text);
        return;
      } catch (error) {
        console.warn("Async clipboard write failed, fallback to execCommand.", error);
      }
    }

    throw new Error("Clipboard write rejected.");
  }

  /**
   * 使用旧版同步复制命令兜底写入剪贴板。
   *
   * 这里优先使用 `copy` 事件直接写入剪贴板数据，避免隐藏文本框与可见选区互相干扰；
   * 只有浏览器不接受事件注入时，才退回到传统的 textarea 选区复制。
   *
   * @param {string} text 需要复制的文本。
   * @return {boolean} 是否复制成功。
   */
  copyTextWithExecCommand(text) {
    let injected = false;

    const injectedHandler = (event) => {
      if (!event.clipboardData) {
        return;
      }

      event.preventDefault();
      event.clipboardData.setData("text/plain", text);
      injected = true;
    };

    document.addEventListener("copy", injectedHandler);

    try {
      if (document.execCommand("copy") && injected) {
        return true;
      }
    } catch (error) {
      console.warn("execCommand event injection copy failed.", error);
    } finally {
      document.removeEventListener("copy", injectedHandler);
    }

    return this.copyTextWithSelectionFallback(text);
  }

  /**
   * 用隐藏 textarea 恢复最传统的选区复制方案。
   *
   * 某些 Chromium 版本不会触发上面的 clipboardData 注入分支，
   * 这里保留 textarea 方案作为最后兜底，并尽量恢复原焦点与原有文本选区。
   *
   * @param {string} text 需要复制的文本。
   * @return {boolean} 是否复制成功。
   */
  copyTextWithSelectionFallback(text) {
    const activeElement = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const activeTextControl = activeElement instanceof HTMLTextAreaElement || activeElement instanceof HTMLInputElement ? activeElement : null;
    const selection = window.getSelection();
    /** @type {Range[]} */
    const savedRanges = [];

    if (selection) {
      for (let index = 0; index < selection.rangeCount; index += 1) {
        savedRanges.push(selection.getRangeAt(index).cloneRange());
      }
    }

    const savedSelection = activeTextControl
      ? {
          start: activeTextControl.selectionStart,
          end: activeTextControl.selectionEnd,
          direction: activeTextControl.selectionDirection,
        }
      : null;

    const helper = document.createElement("textarea");
    helper.value = text;
    helper.setAttribute("readonly", "true");
    helper.setAttribute("aria-hidden", "true");
    helper.style.position = "fixed";
    helper.style.top = "0";
    helper.style.left = "0";
    helper.style.width = "1px";
    helper.style.height = "1px";
    helper.style.padding = "0";
    helper.style.border = "0";
    helper.style.opacity = "0";
    helper.style.pointerEvents = "none";

    document.body.append(helper);

    try {
      helper.focus({ preventScroll: true });
    } catch (error) {
      helper.focus();
    }

    helper.select();
    helper.setSelectionRange(0, helper.value.length);

    let copied = false;

    try {
      copied = document.execCommand("copy");
    } catch (error) {
      console.warn("execCommand selection copy failed.", error);
      copied = false;
    } finally {
      helper.remove();

      if (selection) {
        selection.removeAllRanges();

        for (const range of savedRanges) {
          selection.addRange(range);
        }
      }

      if (activeElement) {
        try {
          activeElement.focus({ preventScroll: true });
        } catch (error) {
          activeElement.focus();
        }
      }

      if (activeTextControl && savedSelection?.start !== null && savedSelection?.end !== null) {
        activeTextControl.setSelectionRange(
          savedSelection.start,
          savedSelection.end,
          savedSelection.direction || "none",
        );
      }
    }

    return copied;
  }

  /**
   * 记录一条短时提示。
   *
   * @param {string} message 提示文案。
   * @param {number} duration 展示时长。
   * @param {"default" | "success" | "warning"} [tone] 提示语义。
   * @return {void}
   */
  pushNotice(message, duration = 2200, tone = "default") {
    this.noticeText = message;
    this.noticeTone = tone;
    this.renderNotice();
    this.renderPreviewState();

    if (this.noticeTimer !== null) {
      window.clearTimeout(this.noticeTimer);
    }

    this.noticeTimer = window.setTimeout(() => {
      this.noticeText = null;
      this.noticeTone = "default";
      this.renderNotice();
      this.renderPreviewState();
    }, duration);
  }

  /**
   * 渲染全局轻提示。
   *
   * 复制、导入、格式化这类动作的反馈不应再挤占主要工作区，
   * 所以统一走右上角短时 toast，既可感知又不会打断正在查看的树或文本。
   *
   * @return {void}
   */
  renderNotice() {
    this.refs.noticeToast.textContent = this.noticeText || "";
    this.refs.noticeToast.classList.toggle("is-visible", Boolean(this.noticeText));
    this.refs.noticeToast.dataset.tone = this.noticeText ? this.noticeTone : "default";
  }

  /**
   * 开始拖动分隔条。
   *
   * @param {PointerEvent} event 指针事件。
   * @return {void}
   */
  beginSplitterDrag(event) {
    event.preventDefault();
    this.isDraggingSplitter = true;
    this.refs.splitter.setPointerCapture(event.pointerId);
  }

  /**
   * 响应分隔条拖动。
   *
   * @param {PointerEvent} event 指针事件。
   * @return {void}
   */
  handleSplitterMove(event) {
    if (!this.isDraggingSplitter) {
      return;
    }

    const rect = this.refs.workspace.getBoundingClientRect();
    const nextRatio = this.state.layout === "horizontal"
      ? (event.clientX - rect.left) / rect.width
      : (event.clientY - rect.top) / rect.height;

    this.state.workspaceRatio = clamp(nextRatio, 0.25, 0.75);
    this.refs.workspace.style.setProperty("--workspace-ratio", String(this.state.workspaceRatio));
  }

  /**
   * 结束分隔条拖动。
   *
   * @return {void}
   */
  endSplitterDrag() {
    if (!this.isDraggingSplitter) {
      return;
    }

    this.isDraggingSplitter = false;
    this.schedulePersist();
  }

  /**
   * 支持键盘微调分栏比例。
   *
   * @param {KeyboardEvent} event 键盘事件。
   * @return {void}
   */
  handleSplitterKeydown(event) {
    const delta = 0.03;
    let nextRatio = this.state.workspaceRatio;

    if (event.key === "ArrowLeft" || event.key === "ArrowUp") {
      nextRatio -= delta;
    } else if (event.key === "ArrowRight" || event.key === "ArrowDown") {
      nextRatio += delta;
    } else {
      return;
    }

    event.preventDefault();
    this.state.workspaceRatio = clamp(nextRatio, 0.25, 0.75);
    this.refs.workspace.style.setProperty("--workspace-ratio", String(this.state.workspaceRatio));
    this.schedulePersist();
  }

  /**
   * 获取排序模式中文标签。
   *
   * @param {"source" | "asc" | "desc"} sortMode 排序模式。
   * @return {string} 展示文案。
   */
  getSortLabel(sortMode) {
    if (sortMode === "asc") {
      return "字母升序";
    }

    if (sortMode === "desc") {
      return "字母降序";
    }

    return "源顺序";
  }

  /**
   * 获取预览模式中文标签。
   *
   * @param {"tree" | "text" | "meta"} mode 预览模式。
   * @return {string} 展示文案。
   */
  getPreviewModeLabel(mode) {
    if (mode === "text") {
      return "文本";
    }

    if (mode === "meta") {
      return "元数据";
    }

    return "树形";
  }
}

const app = new JsonPrismDeckApp({
  storage: new StorageBridge(STORAGE_KEY),
  worker: new WorkerBridge(chrome.runtime.getURL("json-worker.js")),
  previewList: new VirtualList(/** @type {HTMLElement} */ (getRequiredElement("previewContent"))),
});

void app.init();
