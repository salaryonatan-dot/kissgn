// HIST-MONTH — the daily-revenue list (פדיון יומי) can show a previous month after a month rollover.
// The view model is the existing C1 history(F, src, month); the page adds month navigation bounded by
// the live month and by the save path's closure window (today−95). Writes go through the unchanged save
// path (browser harness hist.mjs covers October-from-November, December-from-January, edit / create /
// duplicate protection / labor / other business). Synthetic rows only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { REPO } from "../support/fincore-load.mjs";
import { loadFinance, loadSeam, present, row, srcOf } from "../support/c1-seam.mjs";

const F = await loadFinance();
const C = loadSeam();
const HTML = readFileSync(join(REPO, "index.html"), "utf8");
let seq = 1;
const uid = () => `00000000-0000-4000-8000-${String(seq++).padStart(12, "0")}`;
const day = (d, o = {}) => row(d, { sales: "1000", deliveries: "0", other_income: "0", supplier_payments: { s1: "300" }, payroll: "100", ...o }, uid());

test("HIST-01 a previous month (live month November): every day of October is listed; recorded days complete, a missing day 'missing'; no 'today'", () => {
  const rows = Array.from({ length: 30 }, (_, i) => day(`2026-10-${String(i + 1).padStart(2, "0")}`));
  const src = srcOf({ rows, asOf: "2026-11-03", config: present({}) });
  const h = C.history(F, src, "2026-10");
  assert.equal(h.status, "ready");
  assert.equal(h.days.length, 31);
  assert.equal(h.days.find((d) => d.date === "2026-10-31").status, "missing");
  assert.equal(h.days.find((d) => d.date === "2026-10-15").status, "complete");
  assert.ok(h.days.every((d) => !d.isToday));
});

test("HIST-02 year boundary: December 2026 seen from January 2027", () => {
  const rows = [day("2026-12-10"), day("2027-01-01")];
  const h = C.history(F, srcOf({ rows, asOf: "2027-01-02", config: present({}) }), "2026-12");
  assert.equal(h.status, "ready"); assert.equal(h.days.length, 31);
  assert.equal(h.days.find((d) => d.date === "2026-12-10").status, "complete");
  assert.ok(!h.days.some((d) => d.date.startsWith("2027-")));
});

test("HIST-03 the page binds the list, the history view model and the day dates to the selected month, bounded by the live month and the closure window", () => {
  assert.match(HTML, /const finHist = React\.useMemo\(\(\) => finView\(\(F, S\) => window\.MarjinC1\.history\(F, S, histMonth\)\)/);
  assert.match(HTML, /const monthPrefix = `\$\{histMonth\}-`;/);
  assert.match(HTML, /const histFloorKey = israelDateKey\(-95\);/);
  assert.match(HTML, /histMonthSel < liveMonth && histMonthSel >= histMinMonth \? histMonthSel : liveMonth/);
  assert.match(HTML, /disabled=\{histMonth>=liveMonth\}/);
  assert.match(HTML, /const to = io\.todayKey\(1\), from = io\.todayKey\(-95\);/, "the save path's closure window the bound mirrors");
});
