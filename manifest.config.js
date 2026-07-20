import { readFileSync } from "node:fs";
import { defineManifest } from "@crxjs/vite-plugin";

const packageJson = JSON.parse(readFileSync(new URL("./package.json", import.meta.url), "utf8"));

/**
 * Chrome 扩展的 Manifest V3 声明。
 *
 * 版本号必须直接来自 package.json，才能让构建产物与发布脚本使用同一事实来源；
 * 其余权限和入口保持与现有手工加载版本一致，避免工程化改变用户可见行为。
 */
export default defineManifest({
  manifest_version: 3,
  name: "JSON Prism Deck",
  version: packageJson.version,
  description: "本地离线 JSON 格式化、压缩、树形预览与元数据分析工作台。",
  permissions: ["clipboardWrite"],
  background: {
    service_worker: "src/background/service-worker.js",
    type: "module",
  },
  // 将工作台声明为扩展选项页，让 CRX 在构建时可靠收集页面、主模块与 JSON worker；
  // 工具栏点击仍由后台脚本开新标签页，扩展详情中的“选项”入口只是同一工作台的备用入口。
  options_ui: {
    page: "src/workbench/index.html",
    open_in_tab: true,
  },
  action: {
    default_title: "打开 JSON Prism Deck",
    default_icon: {
      16: "src/assets/icons/icon-16.png",
      32: "src/assets/icons/icon-32.png",
      48: "src/assets/icons/icon-48.png",
      128: "src/assets/icons/icon-128.png",
    },
  },
  icons: {
    16: "src/assets/icons/icon-16.png",
    32: "src/assets/icons/icon-32.png",
    48: "src/assets/icons/icon-48.png",
    128: "src/assets/icons/icon-128.png",
  },
});
