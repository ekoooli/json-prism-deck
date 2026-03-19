/**
 * JSON 工作台的承载页路径。
 *
 * 这里显式使用独立标签页而不是 popup，原因是树形虚拟滚动、分栏编辑和大数据量渲染
 * 都需要稳定且宽裕的页面空间；如果塞进 popup，Chrome 会在尺寸和生命周期上频繁打断体验。
 *
 * @type {string}
 */
const WORKBENCH_PATH = "index.html";

/**
 * 在用户点击工具栏图标时打开完整工作台页面。
 *
 * @return {Promise<void>}
 */
async function openWorkbenchPage() {
  await chrome.tabs.create({
    url: chrome.runtime.getURL(WORKBENCH_PATH),
  });
}

chrome.action.onClicked.addListener(openWorkbenchPage);
