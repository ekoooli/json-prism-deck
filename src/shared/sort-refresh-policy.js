/**
 * 判断排序切换时是否必须放弃 worker 里的派生快照并重新解析编辑区文本。
 *
 * 预览升序/降序只是在当前合法 JSON 上切换展示顺序，沿用快照重建就够了；
 * 但“源顺序”本质上承诺的是“按当前编辑区文本出现的字段顺序展示”，
 * 只要继续复用旧快照，就可能把上一次排序重建、旧请求回放或尚未解析的新文本误当成“源顺序”。
 * 因此这里把“切回源顺序”和“编辑区文本已经不同于最近一次成功解析文本”都定义为必须重解析的场景。
 *
 * @param {{
 *   nextSortMode: "source" | "asc" | "desc",
 *   editorText: string,
 *   lastSuccessfulParsedText: string | null
 * }} input 当前排序切换上下文。
 * @return {boolean} 是否应该走全量解析。
 */
export function shouldReparseForSortChange(input) {
  if (input.nextSortMode === "source") {
    return true;
  }

  return input.editorText !== (input.lastSuccessfulParsedText || "");
}
