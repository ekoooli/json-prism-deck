import { crx } from "@crxjs/vite-plugin";
import { defineConfig } from "vite";
import manifest from "./manifest.config.js";

/**
 * Chrome 扩展的生产构建配置。
 *
 * CRX 插件负责把 Manifest 声明的页面、后台脚本和图标收敛为可直接加载的扩展目录；
 * 关闭 sourcemap 是为了让 Release 压缩包只保留运行所需文件，避免额外分发重复源码。
 */
export default defineConfig({
  plugins: [crx({ manifest })],
  build: {
    emptyOutDir: true,
    sourcemap: false,
    target: "es2022",
  },
});
