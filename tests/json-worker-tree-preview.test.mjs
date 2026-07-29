import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

/**
 * 加载 worker 内部的树预览辅助函数。
 *
 * `src/workers/json-worker.js` 在运行时以 module worker 脚本挂载，不直接对外导出；
 * 测试通过 vm 注入最小 worker 宿主，把内部函数提出来校验展示协议，
 * 这样可以在不改线上加载方式的前提下覆盖回归场景。
 *
 * @return {{
 *   buildLeafPreview: (value: unknown) => { preview: string, metaLabel: string },
 *   buildTree: (rootValue: unknown, sortMode: "source" | "asc" | "desc") => { nodes: Array<{ id: string, searchText: string, preview: string, childCount: number, metaLabel: string }> }
 * }} worker 内部测试钩子。
 */
function loadWorkerPreviewApi() {
  const source = fs.readFileSync(new URL("../src/workers/json-worker.js", import.meta.url), "utf8");
  const context = {
    TextEncoder,
    console,
    self: {
      postMessage() {},
    },
  };

  vm.createContext(context);
  vm.runInContext(`${source}\nthis.__testApi = { buildLeafPreview, buildTree };`, context);
  return context.__testApi;
}

test("long string preview keeps the full payload so tree rows can scroll horizontally", () => {
  const { buildLeafPreview } = loadWorkerPreviewApi();
  const url = "http://49.77.204.6:10081/qyryyjqy/serviceportal/portalsite/comprehensive_inquiry/list_detail?qytype=0&dwtype=1&guid=paramsEncB966FDB48A0B45C341CC11CCFA5A753E3DD6C210519AB142B29F912176A25C5310EBD50A528DBE529DC7E56963A12F2D08D4F7534CB28B6E85C7F65D659C1E0A00D6F4537C8EC25D84C0E26576A6205510ECF4157F81B9518AFACC7D4E9B27133DECEC0B44EAA958B29F90784AA4545E";
  const preview = buildLeafPreview(url);

  /**
   * vm 里构造出来的对象原型来自另一套 realm，不能直接用 deepStrictEqual 比较整个对象；
   * 这里拆成字段断言，只校验我们真正关心的展示协议。
   */
  assert.equal(preview.preview, JSON.stringify(url));
  assert.equal(preview.metaLabel, "");
});

test("tree search text keeps the long string content instead of the shortened ellipsis version", () => {
  const { buildTree } = loadWorkerPreviewApi();
  const url = "http://49.77.204.6:10081/qyryyjqy/serviceportal/portalsite/comprehensive_inquiry/list_detail?qytype=0&dwtype=1&guid=paramsEncB966FDB48A0B45C341CC11CCFA5A753E3DD6C210519AB142B29F912176A25C5310EBD50A528DBE529DC7E56963A12F2D08D4F7534CB28B6E85C7F65D659C1E0A00D6F4537C8EC25D84C0E26576A6205510ECF4157F81B9518AFACC7D4E9B27133DECEC0B44EAA958B29F90784AA4545E";
  const tree = buildTree({ requestUrl: url }, "source");
  const leaf = tree.nodes.find((node) => node.id === "$.requestUrl");

  assert.ok(leaf, "应该能构建出 requestUrl 叶子节点");

  /**
   * 命中判断依赖 `searchText`，这里必须包含全文而不是省略号版本；
   * 否则用户即使已经看到完整值，也无法搜索到 88 个字符之后的片段。
   */
  assert.equal(leaf.searchText.includes("FA5A753E3DD6C210519AB142B29F912176A25C5310EBD50A528DBE529DC7E56963A12"), true);
});

test("tree search text preserves the JSON-quoted form of object keys", () => {
  const { buildTree } = loadWorkerPreviewApi();
  const tree = buildTree({ name: "JSON Prism Deck", "": "empty key" }, "source");
  const nameNode = tree.nodes.find((node) => node.id === "$.name");
  const emptyKeyNode = tree.nodes.find((node) => node.id === '$[""]');
  const rootNode = tree.nodes.find((node) => node.id === "$");

  assert.ok(nameNode, "应该能构建出 name 节点");
  assert.ok(emptyKeyNode, "应该能构建出空字符串键节点");
  assert.ok(rootNode, "应该能构建出根节点");
  assert.equal(nameNode.searchText.includes('"name"'), true);
  assert.equal(emptyKeyNode.searchText.includes('""'), true);
  assert.equal(rootNode.searchText.includes('""'), false);
});

test("container nodes expose field and item counts for tree and text previews", () => {
  const { buildTree } = loadWorkerPreviewApi();
  const tree = buildTree({ workspace: { name: "Deck", enabled: true }, records: [1, 2, 3], empty: {} }, "source");
  const workspace = tree.nodes.find((node) => node.id === "$.workspace");
  const records = tree.nodes.find((node) => node.id === "$.records");
  const empty = tree.nodes.find((node) => node.id === "$.empty");

  assert.equal(workspace?.childCount, 2);
  assert.equal(workspace?.metaLabel, "2 个字段");
  assert.equal(records?.childCount, 3);
  assert.equal(records?.metaLabel, "3 项");
  assert.equal(empty?.childCount, 0);
  assert.equal(empty?.metaLabel, "0 个字段");
});
