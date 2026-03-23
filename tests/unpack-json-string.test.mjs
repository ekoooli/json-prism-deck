import test from "node:test";
import assert from "node:assert/strict";

import { canUnpackEmbeddedJson, unpackEmbeddedJsonText } from "../unpack-json-string.js";

test("detects root-level JSON string that wraps an object", () => {
  const wrapped = "\"{\\\"name\\\":\\\"Eko\\\",\\\"age\\\":18}\"";

  assert.equal(canUnpackEmbeddedJson(wrapped), true);
});

test("rejects normal JSON object text", () => {
  const plainObject = "{\"name\":\"Eko\"}";

  assert.equal(canUnpackEmbeddedJson(plainObject), false);
});

test("pretty unpack rewrites wrapped JSON string into formatted JSON text", () => {
  const wrapped = "\"{\\\"hooks\\\":{\\\"afterMapping\\\":{\\\"function\\\":\\\"demo\\\"}}}\"";

  assert.equal(
    unpackEmbeddedJsonText(wrapped, { style: "pretty", indent: 2 }),
    "{\n  \"hooks\": {\n    \"afterMapping\": {\n      \"function\": \"demo\"\n    }\n  }\n}",
  );
});

test("minify unpack rewrites wrapped JSON string into compact JSON text", () => {
  const wrapped = "\"[1, 2, {\\\"ok\\\":true}]\"";

  assert.equal(
    unpackEmbeddedJsonText(wrapped, { style: "minify", indent: 2 }),
    "[1,2,{\"ok\":true}]",
  );
});

test("throws when root value is not a wrapped object or array", () => {
  assert.throws(
    () => unpackEmbeddedJsonText("\"hello\"", { style: "pretty", indent: 2 }),
    /不属于可解包的 JSON 字符串/,
  );
});
