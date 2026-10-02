// C2 test support: the canonical financial fingerprint block (window.MarjinC2) of index.html,
// evaluated in a node vm. The block takes the core `F` explicitly, so tests run it over the SAME
// generated fincore/v1 bundle the page loads (test/support/c1-seam.mjs loadFinance).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { REPO } from "./fincore-load.mjs";

export const C2_START = "// ── C2 canonical financial fingerprint";

/** The C2 block's script text from an index.html source (exactly one block). */
export function c2Source(html) {
  const i = html.indexOf(C2_START);
  if (i < 0) throw new Error("C2 fingerprint block not found");
  if (html.indexOf(C2_START, i + 1) !== -1) throw new Error("C2 fingerprint block not unique");
  const end = html.indexOf("</script>", i);
  return html.slice(i, end);
}

/** Evaluate the C2 block of `html` (default: the working-tree index.html); returns window.MarjinC2. */
export function loadC2(html = readFileSync(join(REPO, "index.html"), "utf8")) {
  const win = {};
  vm.runInNewContext(c2Source(html), { window: win, Object, JSON, Array, String });
  return win.MarjinC2;
}
