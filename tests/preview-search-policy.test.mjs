import test from "node:test";
import assert from "node:assert/strict";
import { filterShallowPreviewSearchHits } from "../preview-search-policy.js";

test("同一分支上仅保留最浅命中，避免路径继承把键名重复计进导航", () => {
  const nodeMap = new Map([
    ["$", { parentId: null }],
    ["$.ztbxxinfo", { parentId: "$" }],
    ["$.ztbxxinfo[0]", { parentId: "$.ztbxxinfo" }],
    ["$.ztbxxinfo[1]", { parentId: "$.ztbxxinfo" }],
  ]);

  const allMatches = ["$.ztbxxinfo", "$.ztbxxinfo[0]", "$.ztbxxinfo[1]"];
  const shallow = filterShallowPreviewSearchHits(allMatches, nodeMap);

  assert.deepEqual(shallow, ["$.ztbxxinfo"]);
});

test("互不相干的两条分支各自保留浅层命中", () => {
  const nodeMap = new Map([
    ["$", { parentId: null }],
    ["$.a", { parentId: "$" }],
    ["$.a[0]", { parentId: "$.a" }],
    ["$.b", { parentId: "$" }],
    ["$.b[0]", { parentId: "$.b" }],
  ]);

  const allMatches = ["$.a[0]", "$.b[0]"];
  const shallow = filterShallowPreviewSearchHits(allMatches, nodeMap);

  assert.deepEqual(shallow, allMatches);
});
