import test from "node:test";
import assert from "node:assert/strict";

import { shouldReparseForSortChange } from "../sort-refresh-policy.js";

test("switching back to source order always reparses from editor text", () => {
  assert.equal(
    shouldReparseForSortChange({
      nextSortMode: "source",
      editorText: '{"b":1,"a":2}',
      lastSuccessfulParsedText: '{"a":2,"b":1}',
    }),
    true,
  );
});

test("derived sort modes can reuse snapshot when editor text is unchanged", () => {
  assert.equal(
    shouldReparseForSortChange({
      nextSortMode: "asc",
      editorText: '{"b":1,"a":2}',
      lastSuccessfulParsedText: '{"b":1,"a":2}',
    }),
    false,
  );
});

test("derived sort modes must reparse when editor text has drifted from last successful parse", () => {
  assert.equal(
    shouldReparseForSortChange({
      nextSortMode: "desc",
      editorText: '{"b":1,"a":2,"c":3}',
      lastSuccessfulParsedText: '{"b":1,"a":2}',
    }),
    true,
  );
});
