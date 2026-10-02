// C1 test support: the browser view-model seam (window.MarjinC1) of index.html, evaluated in a
// node vm over the generated fincore/v1 bundle — the same two artefacts the page loads.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { pathToFileURL } from "node:url";
import vm from "node:vm";
import { REPO } from "./fincore-load.mjs";

export const C1_START = "// ── C1 browser financial view models";

/** The seam's script text from an index.html source. */
export function seamSource(html) {
  const i = html.indexOf(C1_START);
  if (i < 0) throw new Error("C1 seam not found");
  const end = html.indexOf("</script>", i);
  return html.slice(i, end);
}

export async function loadFinance() {
  const mod = await import(pathToFileURL(join(REPO, "fincore/v1/browser/marjinFinanceGlobal.js")).href);
  return mod.default;
}

/** Evaluate the seam of `html` (default: the working-tree index.html); returns window.MarjinC1. */
export function loadSeam(html = readFileSync(join(REPO, "index.html"), "utf8")) {
  const win = {};
  vm.runInNewContext(seamSource(html), { window: win, Object, Math, Number, String, Array, isFinite });
  return win.MarjinC1;
}

// ── fixtures ────────────────────────────────────────────────────────────────
export const present = (value) => ({ state: "present", value });
export const absent = () => ({ state: "absent" });
export const unreadable = () => ({ state: "unreadable", reason: "test" });
export const ledgerOf = (states, from, to) => ({ state: Object.keys(states).length ? "present" : "absent", states, from, to });

export function row(date, fields = {}, id = date) { return { id, date, ...fields }; }

export function srcOf({ rows = [], config = present({}), fixed = absent(), asOf, ledger, rowsReady = true }) {
  return { rows, config, fixed, asOf, ledger: ledger || ledgerOf({}, "2000-01-01", "2100-12-31"), rowsReady };
}
