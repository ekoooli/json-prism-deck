/**
 * 预览搜索：从「全量命中节点 id」中筛出用于计数与上下键导航的节点。
 *
 * 背景：`json-worker` 里每个节点的 `searchText` 会拼接 `path`，子节点路径必然包含祖先键名。
 * 用户搜键名（如 `ztbxxinfo`）时，数组下每个元素行都会因路径命中而被算作一次匹配，
 * 计数变成 1/100、下一命中跳进第 2 行，语义上却是「同一处键」的重复曝光。
 *
 * 策略：若某节点命中，且其某个祖先节点也在全量命中集合里，则该节点只参与高亮/自动展开，
 * 不参与「第几个匹配」的导航口径——导航只保留每个分支上最浅的那一层命中。
 * 高亮仍用全量集合（由调用方维护 `searchMatchIdSet`），避免用户看不到子树里的路径高亮。
 *
 * @param {string[]} previewMatchIds 按 `nodes` 遍历顺序收集到的、searchText 命中的节点 id（可含重复 id 时先去重，此处假定已唯一）。
 * @param {Map<string, { parentId: string | null }>} nodeMap 节点 id → 至少含 parentId 的索引。
 * @return {string[]} 浅层命中 id 列表，顺序与 `previewMatchIds` 中首次出现的相对顺序一致。
 */
export function filterShallowPreviewSearchHits(previewMatchIds, nodeMap) {
  const matchSet = new Set(previewMatchIds);

  return previewMatchIds.filter((id) => {
    let cursor = nodeMap.get(id);

    while (cursor?.parentId) {
      if (matchSet.has(cursor.parentId)) {
        return false;
      }

      cursor = nodeMap.get(cursor.parentId);
    }

    return true;
  });
}
