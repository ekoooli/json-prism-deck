import globals from "globals";

/**
 * 统一浏览器扩展、Node 发布脚本和测试的静态检查边界。
 *
 * 扩展页面与后台脚本运行在浏览器环境，但发布脚本必须运行在 Node；分组声明全局变量
 * 可以让 no-undef 真正发现跨运行时误用，而不是为了通过检查把所有环境变量混在一起。
 *
 * @type {import("eslint").Linter.Config[]}
 */
export default [
  {
    ignores: ["dist/**", "node_modules/**"],
  },
  {
    files: ["*.js"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: {
        ...globals.browser,
        chrome: "readonly",
      },
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
  {
    files: ["scripts/**/*.mjs", "tests/**/*.mjs"],
    languageOptions: {
      ecmaVersion: "latest",
      sourceType: "module",
      globals: globals.node,
    },
    rules: {
      "no-undef": "error",
      "no-unused-vars": ["error", { argsIgnorePattern: "^_" }],
    },
  },
];
