import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import { buildExpandDepthOptions, pickExpandedIdsByDepth } from "../expand-depth-policy.js";

/**
 * 读取主线程脚本源码，校验关键优先级约束没有回退。
 *
 * @return {string} `app.js` 源码。
 */
function readAppSource() {
  return fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
}

test("buildExpandDepthOptions returns depth options from 1 to maxDepth", () => {
  assert.deepEqual(buildExpandDepthOptions(0), []);
  assert.deepEqual(buildExpandDepthOptions(1), [1]);
  assert.deepEqual(buildExpandDepthOptions(3), [1, 2, 3]);
  /**
   * `maxDepth` 可能包含叶子层深度；展开层级只对容器节点有意义。
   * 当可展开容器最大深度小于总深度时，选项必须截断到容器深度上限，避免出现“选了没变化”的档位。
   */
  assert.deepEqual(buildExpandDepthOptions(4, 3), [1, 2, 3]);
});

test("pickExpandedIdsByDepth expands only nodes within selected depth and always keeps root", () => {
  const expanded = pickExpandedIdsByDepth({
    nodes: [
      { id: "$", depth: 0 },
      { id: "$.level1", depth: 1 },
      { id: "$.level1.level2", depth: 2 },
      { id: "$.level1.level2.level3", depth: 3 },
    ],
    expandableIds: new Set(["$", "$.level1", "$.level1.level2", "$.level1.level2.level3"]),
    depth: 2,
    rootId: "$",
  });

  assert.deepEqual([...expanded].sort(), ["$", "$.level1", "$.level1.level2"]);
});

test("expand-all and collapse-all handlers reset selected depth before applying higher-priority action", () => {
  const source = readAppSource();

  assert.match(
    source,
    /this\.refs\.expandAllBtn\.addEventListener\("click",\s*\(\)\s*=>\s*\{\s*this\.resetExpandDepthSelection\(\);/s,
  );
  assert.match(
    source,
    /this\.refs\.collapseAllBtn\.addEventListener\("click",\s*\(\)\s*=>\s*\{\s*this\.resetExpandDepthSelection\(\);/s,
  );
});

test("new data default full-expand path resets selected depth", () => {
  const source = readAppSource();

  assert.match(source, /if \(shouldResetExpansion\)\s*\{[\s\S]*this\.resetExpandDepthSelection\(\);[\s\S]*\}/);
});

test("manual single-node toggle does not reset selected depth", () => {
  const source = readAppSource();
  const toggleSection = source.match(/toggleNode\(nodeId\)\s*\{([\s\S]*?)\n  \}\n\n  \/\*\*/);

  assert.ok(toggleSection, "应该能找到 toggleNode 方法实现");
  assert.equal(toggleSection[1].includes("resetExpandDepthSelection"), false);
});

test("search auto expansion keeps higher priority over manual depth selection", () => {
  const source = readAppSource();

  assert.match(
    source,
    /isNodeExpanded\(nodeId\)\s*\{\s*return this\.state\.expandedIds\.has\(nodeId\) \|\| this\.state\.autoExpandedIds\.has\(nodeId\);\s*\}/s,
  );
});
