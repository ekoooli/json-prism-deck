import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

/**
 * 构造最小 sessionStorage 替身，避免测试依赖浏览器运行时。
 *
 * @param {Record<string, string>} [initial] 初始键值。
 * @return {Storage} 可用于 StorageBridge 的内存存储。
 */
function createSessionStorage(initial = {}) {
  const values = new Map(Object.entries(initial));

  return /** @type {Storage} */ ({
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
  });
}

/**
 * 从工作台源码隔离加载 StorageBridge，便于校验真实的会话存储策略。
 *
 * @param {Storage} sessionStorage 测试用会话存储。
 * @return {new (storageKey: string, payloadStore?: unknown) => { load: () => Promise<Record<string, unknown>>, save: (snapshot: Record<string, unknown>) => Promise<unknown> }} StorageBridge 构造函数。
 */
function loadStorageBridge(sessionStorage) {
  const source = fs.readFileSync(new URL("../src/workbench/main.js", import.meta.url), "utf8");
  const start = source.indexOf("class StorageBridge {");
  const end = source.indexOf("/**\n * 与 worker 通信的轻量 RPC 封装。", start);

  assert.notEqual(start, -1, "应该能找到 StorageBridge 实现");
  assert.notEqual(end, -1, "应该能找到 StorageBridge 结束位置");

  const context = { sessionStorage };
  vm.runInNewContext(`${source.slice(start, end)}\nglobalThis.StorageBridge = StorageBridge;`, context);
  return /** @type {ReturnType<typeof loadStorageBridge>} */ (context.StorageBridge);
}

test("大文本写入 IndexedDB，而 sessionStorage 仅保留轻量设置", async () => {
  const sessionStorage = createSessionStorage();
  const StorageBridge = loadStorageBridge(sessionStorage);
  const calls = [];
  const payloadStore = {
    async loadText() {
      return null;
    },
    async saveText(key, text) {
      calls.push({ key, text });
      return true;
    },
  };
  const storage = new StorageBridge("json-prism-deck-state", payloadStore);
  const text = "x".repeat(6 * 1024 * 1024);

  await storage.save({ text, theme: "night", layout: "horizontal" });

  const persistedSettings = JSON.parse(sessionStorage.getItem("json-prism-deck-state") || "{}");
  assert.equal(Object.hasOwn(persistedSettings, "text"), false);
  assert.equal(calls.length, 1);
  assert.equal(typeof calls[0]?.key, "string");
  assert.equal(calls[0]?.text, text);
});

test("恢复状态时优先使用 IndexedDB 中同一会话的大文本", async () => {
  const sessionStorage = createSessionStorage({
    "json-prism-deck-state": JSON.stringify({ theme: "night" }),
  });
  const StorageBridge = loadStorageBridge(sessionStorage);
  let loadedKey = "";
  const payloadStore = {
    async loadText(key) {
      loadedKey = key;
      return "{\n  \"large\": true\n}";
    },
    async saveText() {
      return true;
    },
  };
  const storage = new StorageBridge("json-prism-deck-state", payloadStore);

  const restored = await storage.load();

  assert.notEqual(loadedKey, "");
  assert.equal(restored.theme, "night");
  assert.equal(restored.text, "{\n  \"large\": true\n}");
});

test("旧 sessionStorage 快照会迁移文本并释放会话配额", async () => {
  const legacyText = "x".repeat(6 * 1024 * 1024);
  const sessionStorage = createSessionStorage({
    "json-prism-deck-state": JSON.stringify({ text: legacyText, theme: "night" }),
  });
  const StorageBridge = loadStorageBridge(sessionStorage);
  const calls = [];
  const payloadStore = {
    async loadText() {
      return null;
    },
    async saveText(key, text) {
      calls.push({ key, text });
      return true;
    },
  };
  const storage = new StorageBridge("json-prism-deck-state", payloadStore);

  const restored = await storage.load();
  const migratedSettings = JSON.parse(sessionStorage.getItem("json-prism-deck-state") || "{}");

  assert.equal(restored.text, legacyText);
  assert.equal(Object.hasOwn(migratedSettings, "text"), false);
  assert.equal(calls[0]?.text, legacyText);
});
