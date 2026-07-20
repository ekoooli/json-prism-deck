/**
 * 根据当前树最大深度构建“展开层级”选项列表。
 *
 * 根节点深度固定为 0，不属于用户要选择的业务层级；
 * 因此这里从 1 开始生成，避免出现“展开层级0”这种无意义选项。
 *
 * @param {number | null | undefined} maxDepth 树总最大深度（可能包含叶子层）。
 * @param {number | null | undefined} [maxExpandableDepth=maxDepth] 可展开容器最大深度。
 * @return {number[]} 可选层级列表（1..maxDepth）。
 */
export function buildExpandDepthOptions(maxDepth, maxExpandableDepth = maxDepth) {
  const safeDepth = Number.isFinite(maxDepth) ? Math.max(0, Math.floor(Number(maxDepth))) : 0;
  const safeExpandableDepth = Number.isFinite(maxExpandableDepth)
    ? Math.max(0, Math.floor(Number(maxExpandableDepth)))
    : safeDepth;
  const effectiveDepth = Math.min(safeDepth, safeExpandableDepth);

  if (effectiveDepth < 1) {
    return [];
  }

  return Array.from({ length: effectiveDepth }, (_, index) => index + 1);
}

/**
 * 基于目标层级挑选需要保持展开的可展开节点集合。
 *
 * 展开层级 N 的定义是“深度 <= N 的容器节点都展开，深度 > N 的容器折叠”，
 * 同时根节点必须始终保留展开态，避免整棵树在边界条件下被完全折叠看不到入口。
 *
 * @param {{
 *   nodes: Array<{ id: string, depth: number }>,
 *   expandableIds: Set<string>,
 *   depth: number,
 *   rootId: string
 * }} input 计算输入。
 * @return {Set<string>} 目标展开节点集合。
 */
export function pickExpandedIdsByDepth(input) {
  const depth = Number.isFinite(input.depth) ? Math.max(0, Math.floor(input.depth)) : 0;
  const expanded = new Set();

  for (const node of input.nodes) {
    if (!input.expandableIds.has(node.id)) {
      continue;
    }

    if (node.depth <= depth) {
      expanded.add(node.id);
    }
  }

  expanded.add(input.rootId);
  return expanded;
}
