// Financial Core B2 successor — B2-G36 / B2-R03: deterministic FULL normalized subject + HTML
// goldens for every material e-mail state (not substring checks). Normalization only trims each
// line and drops empty lines (template indentation); every tag, attribute, figure, label and
// note must match byte-for-byte. Regenerate ONLY after reviewing the diff:
//   B2_GOLDEN_UPDATE=1 node --test test/finance/b2-email-goldens.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { mail, closure } from "../support/b2-email-harness.mjs";
import { INVARIANTS, completeSeptember, fullDay } from "../support/financial-invariants.mjs";
import { nowMsFor, entry } from "../support/b1-fixtures.mjs";

const DIR = join(import.meta.dirname, "goldens", "b2-email");
const UPDATE = process.env.B2_GOLDEN_UPDATE === "1";
const without = (rows, ...dates) => rows.filter((r) => !dates.includes(r.date));

export const GOLDEN_STATES = Object.freeze([
  { name: "01-complete", title: "complete month (Sep 1–28, asOf 29.09)", opts: () => ({ rows: completeSeptember() }) },
  { name: "02-explicit-zero", title: "every completed day revenue 0 (B2-R02: share '—')", opts: () => ({ rows: completeSeptember({ sales: "0" }) }) },
  { name: "03-missing-partial", title: "revenue missing on 08.09 and 15.09 (CDA-18 dated warning; partial forecast)", opts: () => ({ rows: completeSeptember().map((r) => (r.date === "2026-09-08" || r.date === "2026-09-15" ? { ...r, sales: undefined, deliveries: undefined, other_income: undefined } : r)) }) },
  { name: "04-closure-timing", title: "completed closure 06.09 + future closure 30.09", opts: () => ({ rows: without(completeSeptember(), "2026-09-06"), exceptions: { "2026-09-06": closure(), "2026-09-30": closure() } }) },
  { name: "05-unreadable-ledger", title: "unreadable exception ledger", opts: () => ({ rows: completeSeptember(), exceptions: "corrupt" }) },
  { name: "06-sparse", title: "entries on every second completed day only (insufficient history)", opts: () => ({ rows: completeSeptember().filter((_, i) => i % 2 === 0) }) },
  { name: "07-no-completed-day", title: "1st of the month (VD-45 neutral short e-mail)", opts: () => ({ rows: [...completeSeptember(), fullDay("2026-10-01")] }), nowMs: nowMsFor("2026-10-01") },
  { name: "08-purchases-only", title: "purchases-only day 17.09 (revenue missing, purchases kept)", opts: () => ({ rows: completeSeptember().map((r) => (r.date === "2026-09-17" ? entry(r.id, r.date, { supplier_payments: { s1: "300" }, payroll: "100" }) : r)) }) },
  { name: "09-closure-contradiction", title: "closure on 10.09 with recorded revenue (CDA-02)", opts: () => ({ rows: completeSeptember(), exceptions: { "2026-09-10": closure() } }) },
  { name: "10-partial-numerator", title: "invalid purchase cell on 14.09 (purchases partial, food % '—')", opts: () => ({ rows: completeSeptember().map((r) => (r.date === "2026-09-14" ? { ...r, supplier_payments: { s1: "300", s2: "12,5" } } : r)) }) },
]);

for (const st of GOLDEN_STATES) {
  test(`GOLDEN ${st.name}: ${st.title}`, async () => {
    const { normalized } = await mail(st.opts(), st.nowMs);
    const file = join(DIR, st.name + ".golden.txt");
    if (UPDATE) { mkdirSync(DIR, { recursive: true }); writeFileSync(file, normalized); }
    assert.ok(existsSync(file), "golden missing: " + file);
    assert.equal(normalized, readFileSync(file, "utf8"), st.name + " differs from its reviewed golden");
    assert.doesNotMatch(normalized, /NaN|undefined|Infinity|\bnull\b|\[object/, st.name + " leaks a non-value");
  });
}

test("GOLDEN set: the rendered states are pairwise different and the daily-average row is absent from all (VD-41)", async () => {
  const seen = new Map();
  for (const st of GOLDEN_STATES) {
    const g = readFileSync(join(DIR, st.name + ".golden.txt"), "utf8");
    assert.ok(!seen.has(g), st.name + " duplicates " + seen.get(g)); seen.set(g, st.name);
    assert.doesNotMatch(g, /ממוצע/, st.name);
  }
  assert.ok(INVARIANTS.length >= 1);
});
