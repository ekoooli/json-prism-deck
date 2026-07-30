/**
 * 预览搜索：从「全量命中节点 id」中筛出用于计数与上下键导航的节点。
 *
 * 背景：`json-worker` 里每个节点的 `searchText` 会拼接 `path`，子节点路径必然包含祖先键名。
 * 用户搜键名（如 `ztbxxinfo`）时，数组下每个元素行都会因路径命中而被算作一次匹配，
 * 计数变成 1/100、下一命中跳进第 2 行，语义上却是「同一处键」的重复曝光。
 *
 * 策略：仅当节点只因路径继承而命中，且其某个祖先节点也在全量命中集合里，才将该节点排除出导航。
 * 节点自身的键名、值或 JSON 字段片段命中必须保留，否则搜索 `"` 这类高频文本时会被祖先错误压成极少数结果。
 * 高亮仍用全量集合（由调用方维护 `searchMatchIdSet`），避免用户看不到子树里的路径高亮。
 *
 * @param {string[]} previewMatchIds 按 `nodes` 遍历顺序收集到的、searchText 命中的节点 id（可含重复 id 时先去重，此处假定已唯一）。
 * @param {Map<string, { parentId: string | null }>} nodeMap 节点 id → 至少含 parentId 的索引。
 * @param {Set<string>} [directMatchIdSet] 由节点自身内容命中的 id 集合；这些节点不会参与路径继承去重。
 * @return {string[]} 浅层命中 id 列表，顺序与 `previewMatchIds` 中首次出现的相对顺序一致。
 */
export function filterShallowPreviewSearchHits(previewMatchIds, nodeMap, directMatchIdSet = new Set()) {
  const matchSet = new Set(previewMatchIds);

  return previewMatchIds.filter((id) => {
    if (directMatchIdSet.has(id)) {
      return true;
    }

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
