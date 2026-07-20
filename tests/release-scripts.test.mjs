import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { extractReleaseNotes } from "../scripts/release-metadata.mjs";
import { syncProjectVersion } from "../scripts/sync-version.mjs";
import { verifyDistribution } from "../scripts/verify-dist.mjs";
import { verifyReleaseMetadata } from "../scripts/verify-release.mjs";
import { verifySourceExtension } from "../scripts/verify-source-extension.mjs";

/**
 * 创建隔离的发布元数据测试仓库。
 *
 * 发布脚本会写入多个版本文件，测试必须使用临时目录才能验证完整同步过程，同时避免
 * 影响真实工作区的发布版本和更新记录。
 *
 * @param {{ version?: string, changelog?: string }} [options] 初始版本和更新记录覆盖项。
 * @return {string} 临时仓库根目录。
 */
function createReleaseFixture({ version = "1.0.4", changelog } = {}) {
  const rootDir = mkdtempSync(join(tmpdir(), "json-prism-deck-release-"));
  const notes = changelog ?? [
    "# 更新记录",
    "",
    "## 1.0.5 - 2026-07-15",
    "",
    "### 重点更新",
    "",
    "- 自动发布。",
    "",
    "## 1.0.4 - 2026-07-01",
    "",
    "- 上一版。",
  ].join("\n");

  writeFileSync(join(rootDir, "package.json"), JSON.stringify({ name: "json-prism-deck", version }, null, 2));
  writeFileSync(join(rootDir, "package-lock.json"), JSON.stringify({
    name: "json-prism-deck",
    version,
    lockfileVersion: 3,
    packages: {
      "": { name: "json-prism-deck", version },
    },
  }, null, 2));
  writeFileSync(join(rootDir, "manifest.json"), JSON.stringify({ manifest_version: 3, version }, null, 2));
  writeFileSync(join(rootDir, "README.md"), `# JSON Prism Deck\n\n当前版本：\`${version}\`\n`);
  mkdirSync(join(rootDir, "src", "workbench"), { recursive: true });
  writeFileSync(join(rootDir, "src", "workbench", "main.js"), `const DEFAULT_SAMPLE_TEXT = \`{\n  "workspace": {\n    "version": "${version}"\n  }\n}\`;\n`);
  writeFileSync(join(rootDir, "CHANGELOG.md"), notes);

  return rootDir;
}

/**
 * 删除测试创建的临时仓库。
 *
 * @param {string} rootDir 临时仓库根目录。
 * @return {void}
 */
function removeFixture(rootDir) {
  rmSync(rootDir, { force: true, recursive: true });
}

test("extractReleaseNotes only returns the requested release section", () => {
  const changelog = [
    "# 更新记录",
    "",
    "## 1.0.5 - 2026-07-15",
    "",
    "- 自动发布。",
    "",
    "## 1.0.4 - 2026-07-01",
    "",
    "- 旧版本。",
  ].join("\n");

  assert.equal(extractReleaseNotes(changelog, "1.0.5"), "- 自动发布。");
});

test("extractReleaseNotes rejects a missing formal version heading", () => {
  assert.throws(
    () => extractReleaseNotes("# 更新记录\n\n## 1.0.5 补充 - 2026-07-15\n\n- 内容。", "1.0.5"),
    /必须且只能包含一个/,
  );
});

test("syncProjectVersion updates every version source before release validation", (t) => {
  const rootDir = createReleaseFixture();
  t.after(() => removeFixture(rootDir));

  const result = syncProjectVersion({ rootDir, version: "1.0.5" });
  const packageJson = JSON.parse(readFileSync(join(rootDir, "package.json"), "utf8"));
  const manifest = JSON.parse(readFileSync(join(rootDir, "manifest.json"), "utf8"));
  const packageLock = JSON.parse(readFileSync(join(rootDir, "package-lock.json"), "utf8"));

  assert.equal(result.version, "1.0.5");
  assert.equal(packageJson.version, "1.0.5");
  assert.equal(manifest.version, "1.0.5");
  assert.equal(packageLock.version, "1.0.5");
  assert.equal(packageLock.packages[""].version, "1.0.5");
  assert.match(readFileSync(join(rootDir, "README.md"), "utf8"), /当前版本：`1\.0\.5`/);
  assert.match(readFileSync(join(rootDir, "src", "workbench", "main.js"), "utf8"), /"version": "1\.0\.5"/);
  assert.equal(verifyReleaseMetadata({ rootDir, tag: "v1.0.5" }).version, "1.0.5");
});

test("verifyReleaseMetadata rejects a tag that does not match package version", (t) => {
  const rootDir = createReleaseFixture({ version: "1.0.5" });
  t.after(() => removeFixture(rootDir));

  assert.throws(() => verifyReleaseMetadata({ rootDir, tag: "v1.0.6" }), /发布 tag 必须是 v1\.0\.5/);
});

test("verifyDistribution requires a root manifest and its referenced extension files", (t) => {
  const rootDir = createReleaseFixture({ version: "1.0.5" });
  const distDir = join(rootDir, "dist");
  t.after(() => removeFixture(rootDir));
  mkdirSync(join(distDir, "icons"), { recursive: true });
  mkdirSync(join(distDir, "src", "workbench"), { recursive: true });
  writeFileSync(join(distDir, "src", "workbench", "index.html"), "<!doctype html>");
  writeFileSync(join(distDir, "service-worker.js"), "");
  writeFileSync(join(distDir, "icons", "icon-16.png"), "");
  writeFileSync(join(distDir, "manifest.json"), JSON.stringify({
    manifest_version: 3,
    version: "1.0.5",
    background: { service_worker: "service-worker.js" },
    options_ui: { page: "src/workbench/index.html" },
    icons: { 16: "icons/icon-16.png" },
  }));

  assert.deepEqual(verifyDistribution({ rootDir }), { version: "1.0.5", distDir });
});

test("verifySourceExtension keeps the project root loadable during development", (t) => {
  const rootDir = createReleaseFixture({ version: "1.0.5" });
  t.after(() => removeFixture(rootDir));
  mkdirSync(join(rootDir, "src", "background"), { recursive: true });
  mkdirSync(join(rootDir, "src", "assets", "icons"), { recursive: true });
  writeFileSync(join(rootDir, "src", "workbench", "index.html"), "<!doctype html>");
  writeFileSync(join(rootDir, "src", "background", "service-worker.js"), "");
  writeFileSync(join(rootDir, "src", "assets", "icons", "icon-16.png"), "");
  writeFileSync(join(rootDir, "manifest.json"), JSON.stringify({
    manifest_version: 3,
    version: "1.0.5",
    background: { service_worker: "src/background/service-worker.js" },
    options_ui: { page: "src/workbench/index.html" },
    icons: { 16: "src/assets/icons/icon-16.png" },
  }));

  assert.deepEqual(verifySourceExtension({ rootDir }), {
    version: "1.0.5",
    manifestPath: join(rootDir, "manifest.json"),
  });
});
