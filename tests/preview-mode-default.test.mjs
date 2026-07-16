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

test("editor defaults to lite while preserving an explicitly stored mode", () => {
  const html = readWorkbenchHtml();
  const source = readAppSource();

  assert.match(html, /<button id="editorModeLiteBtn" class="segment-btn is-active" type="button">精简<\/button>/);
  assert.match(source, /editorMode:\s*"lite"/);

  /**
   * 只有用户明确保存过完整模式时才恢复完整模式；缺失历史字段必须回退精简，
   * 才能同时满足“首次默认精简”和“尊重用户手动选择”两个约束。
   */
  assert.match(source, /stored\.editorMode\s*===\s*"full"\s*\?\s*"full"\s*:\s*"lite"/);
});

test("tree path toggle is tree-only and persists the display preference across tabs", () => {
  const html = readWorkbenchHtml();
  const source = readAppSource();

  assert.match(html, /id="treePathToggleBtn"/);
  assert.match(source, /showTreePath:\s*true/);
  assert.match(source, /loadTreePathPreference/);
  assert.match(source, /saveTreePathPreference/);
  assert.match(source, /sharedTreePath\s*===\s*null\s*\?\s*stored\.showTreePath\s*!==\s*false\s*:\s*sharedTreePath/);
  assert.match(source, /showTreePath:\s*this\.state\.showTreePath/);
  assert.match(source, /this\.refs\.treePathToggleBtn\.hidden\s*=\s*!isTreeMode/);
});

test("workspace defaults to a 4-to-6 editor and preview split", () => {
  const source = readAppSource();
  const styles = fs.readFileSync(new URL("../styles.css", import.meta.url), "utf8");

  assert.match(source, /workspaceRatio:\s*0\.4/);
  assert.match(styles, /--workspace-ratio:\s*0\.4/);
});

test("text preview attaches container count labels next to the JSON line", () => {
  const source = readAppSource();

  assert.match(source, /inlineMeta:\s*node\.expandable\s*\?\s*node\.metaLabel\s*:\s*""/);
  assert.match(source, /text-container-meta/);
});
