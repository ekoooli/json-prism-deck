import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";

/**
 * 加载 worker 内部的树预览辅助函数。
 *
 * `json-worker.js` 在运行时以 classic worker 脚本挂载，不直接对外导出；
 * 测试通过 vm 注入最小 worker 宿主，把内部函数提出来校验展示协议，
 * 这样可以在不改线上加载方式的前提下覆盖回归场景。
 *
 * @return {{
 *   buildLeafPreview: (value: unknown) => { preview: string, metaLabel: string },
 *   buildTree: (rootValue: unknown, sortMode: "source" | "asc" | "desc") => { nodes: Array<{ id: string, searchText: string, preview: string }> }
 * }} worker 内部测试钩子。
 */
function loadWorkerPreviewApi() {
  const source = fs.readFileSync(new URL("../json-worker.js", import.meta.url), "utf8");
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
