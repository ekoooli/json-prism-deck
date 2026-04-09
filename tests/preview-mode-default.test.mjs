import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

/**
 * 读取工作台入口 HTML。
 *
 * 这个回归点只关心分段按钮在模板里的静态顺序与初始激活态，
 * 用源码断言就能稳定覆盖，不需要额外引入浏览器级测试环境。
 *
 * @return {string} HTML 源码。
 */
function readWorkbenchHtml() {
  return fs.readFileSync(new URL("../index.html", import.meta.url), "utf8");
}

/**
 * 读取主线程脚本源码。
 *
 * 预览模式默认值和恢复策略都定义在 `app.js` 内部，
 * 这里直接校验源码约束，避免为了一个初始化策略测试而伪造整套 DOM 宿主。
 *
 * @return {string} JS 源码。
 */
function readAppSource() {
  return fs.readFileSync(new URL("../app.js", import.meta.url), "utf8");
}

test("preview mode buttons render in text-tree-meta order and text is initially active", () => {
  const html = readWorkbenchHtml();
  const textIndex = html.indexOf('data-preview-mode="text"');
  const treeIndex = html.indexOf('data-preview-mode="tree"');
  const metaIndex = html.indexOf('data-preview-mode="meta"');

  assert.notEqual(textIndex, -1, "应该存在文本预览按钮");
  assert.notEqual(treeIndex, -1, "应该存在树形预览按钮");
  assert.notEqual(metaIndex, -1, "应该存在元数据预览按钮");
  assert.equal(textIndex < treeIndex && treeIndex < metaIndex, true);

  /**
   * 首屏在脚本接管前也应该与默认策略一致，
   * 否则页面会先闪一下“树形已选中”，再被脚本切回文本。
   */
  assert.match(html, /<button class="segment-btn is-active" data-preview-mode="text">文本<\/button>/);
});

test("preview mode defaults to text and restoreState forces text even when session storage remembers another mode", () => {
  const source = readAppSource();

  assert.match(source, /previewMode:\s*"text"/);

  /**
   * 这里必须在恢复持久化状态时显式强制成文本模式，
   * 否则 sessionStorage 里残留的树形/元数据选择会覆盖“每次打开都回文本”的产品约束。
   */
  assert.match(source, /this\.state\.previewMode\s*=\s*"text";/);
});
