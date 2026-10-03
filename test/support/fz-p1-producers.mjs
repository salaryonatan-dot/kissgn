// FZ-P1 supplement producers (tests only): live outputs of the P1 R1 code over representative credit
// states — none, present, negative net, invalid record, corrupt chain, unreadable node, not loaded,
// pending review, flagged review, accepted, rejected, voided, corrected identity — for the five frozen
// artifacts. Every node is written by the real writer domain (test/support/p1-credit-fixtures.mjs).
import { readFileSync } from "node:fs";
import { join } from "node:path";
import vm from "node:vm";
import { REPO, loadCommitted } from "./fincore-load.mjs";
import { compileServer, makeDb } from "./server-reader-harness.mjs";
import { loadSeam, srcOf } from "./c1-seam.mjs";
import { NOW_MS, T, B, asLegacy, entry, env, inputs, seedRaw, uid } from "./b1-fixtures.mjs";
import { spec, creditNode, replaceIn, mutate } from "./p1-credit-fixtures.mjs";

export const FZ_P1_VERSION = "FZ-P1/2";
export const IDS = ["FZ-P1-01", "FZ-P1-02", "FZ-P1-03", "FZ-P1-04", "FZ-P1-05"];
const pad = (n) => String(n).padStart(2, "0");
const AUG = () => Array.from({ length: 31 }, (_, i) => entry(uid(1 + i), `2026-08-${pad(i + 1)}`, { sales: "1000", supplier_payments: { s1: i < 30 ? "300" : "0" }, payroll: "100" }));
const S = (n, issue, amount, extra) => spec(n, "s1", `2026-08-${pad(issue)}`, amount, extra);

/** [name, stored node or a decoded-state literal] — the representative credit states. */
export function scenarios() {
  return [
    ["none", null],
    ["present", creditNode([S(1, 15, "300"), spec(2, "s9", "2026-08-20", "40")])],
    ["negative_net", creditNode([S(1, 20, "9500")])],
    ["invalid_record", creditNode([S(1, 12, "1", { raw: { amount: "0" } })])],
    ["corrupt_chain", mutate(replaceIn(creditNode([S(1, 5, "100")]), 1, 2, { issueDate: "2026-08-07", amount: "90" }), (n) => { delete n.voids[Object.keys(n.voids)[0]]; })],
    ["unreadable", "garbage"],
    ["not_loaded", { state: "not_loaded" }],
    ["pending", creditNode([S(1, 15, "300", { review: "pending" })])],
    ["flagged", creditNode([S(1, 15, "300", { review: "flagged" })])],
    ["accepted", creditNode([S(1, 15, "300", { review: "acknowledged" })])],
    ["rejected", creditNode([S(1, 15, "300", { review: "rejected" })])],
    ["voided", creditNode([S(1, 15, "300", { voided: true })])],
    ["corrected_identity", replaceIn(creditNode([S(1, 5, "100")]), 1, 2, { documentNumber: "CR-77" }, { identityCorrection: true })],
  ];
}
const OWNER = "P1 Supplier Credits (P1 R2 candidate)";
const uniq = (xs) => [...new Set(xs)].sort();

export async function produce() {
  const C = await loadCommitted();
  const P = C.product, SCD = C.finance.supplierCredits;
  const decode = (raw) => (raw && raw.state ? raw : SCD.decodeSupplierCredits(raw, { tenantId: T, bizId: B }));
  const reports = scenarios().map(([name, raw]) => [name, P.productMonthReport({ ...inputs(AUG()), supplierCredits: decode(raw) }, { kind: "closed_month", month: "2026-08" })]);
  const html = readFileSync(join(REPO, "index.html"), "utf8");
  const C1 = loadSeam(html);
  const i = html.indexOf("// ── P1 supplier credits browser seam"); const win = {};
  vm.runInNewContext(html.slice(i, html.indexOf("</script>", i)), { window: win, Object, Promise, setTimeout, clearTimeout, AbortController });
  const SUPS = [{ id: "s1", name: "S1" }];
  const sup = scenarios().map(([name, raw]) => [name, C1.suppliers(C, { ...srcOf({ rows: AUG(), asOf: "2026-09-05" }), credits: decode(raw) }, "2026-08", SUPS)]);
  const tab = scenarios().map(([name, raw]) => [name, win.MarjinP1.monthView(C, decode(raw), "2026-08", SUPS)]);
  const decoded = scenarios().map(([name, raw]) => [name, decode(raw)]);
  // server analytics day facts
  const srv = compileServer();
  const CI = await srv.import("src/finance-server/canonicalInputs.js"), CM = await srv.import("src/finance-server/canonicalMetrics.js");
  const blocks = [];
  for (const [name, raw] of scenarios()) {
    if (raw && raw.state) continue;
    const db = seedRaw(makeDb(), { entries: asLegacy(AUG()), config: env({}) });
    if (raw !== null) db.seed(`tenants/${T}/biz:${B}:supplier_credits`, raw);
    const si = await CI.loadCanonicalInputs(db, T, B, { site: "fz", nowMs: NOW_MS, need: { config: true, fixed: true, exceptions: true } });
    for (const d of ["2026-08-05", "2026-08-12", "2026-08-15", "2026-08-20"]) blocks.push([name, si.inputIssues, CM.toAnalyticsFinancials(CM.canonicalDayRecord(si, d)).fin]);
  }
  const R = reports.map((x) => x[1]);
  const credits = R.map((r) => r.actual.purchases.credits);
  return {
    "FZ-P1-01": {
      artifact: "FinancialReport.actual.purchases credit summary (supplier credits issued in the window)",
      ids: { credits: uniq(credits.map((c) => c.contract)), creditsState: uniq(credits.map((c) => c.state)), flags: uniq(R.flatMap((r) => r.flags.map((f) => f.code)).filter((c) => /credit|net/.test(c))), issueReasons: uniq(R.flatMap((r) => [...JSON.stringify(r, (k, x) => (typeof x === "bigint" ? x.toString() : x)).matchAll(/"reason":"([a-z_]*credit[a-z_]*)"/g)].map((m) => m[1]))) },
      shapes: { credits: credits },
    },
    "FZ-P1-02": {
      artifact: "C1 suppliers view: supplier and overall gross / credits / net, disclosures",
      ids: {},
      shapes: { rows: sup.flatMap(([, v]) => (v.rows || [])), gross: sup.map(([, v]) => v.gross).filter(Boolean), credits: sup.map(([, v]) => v.credits).filter((x) => x !== undefined), disclosure: sup.map(([, v]) => v.disclosure).filter(Boolean) },
    },
    "FZ-P1-03": {
      artifact: "overall net purchases and Food Cost completeness with credits",
      ids: { purchasesPct: uniq(R.map((r) => r.actual.purchasesPct.state)) },
      shapes: { purchases: R.map((r) => { const p = r.actual.purchases; return { value: p.value, complete: p.complete, presentDays: p.presentDays, gross: p.gross, grossBySource: p.grossBySource, bySource: p.bySource }; }), purchasesPct: R.map((r) => r.actual.purchasesPct) },
    },
    "FZ-P1-04": {
      artifact: "decoded supplier-credit state (MARJIN_CREDITS/3): records with document identity and review, logical credits, reviews, effective credits, issues",
      ids: { states: uniq(decoded.map(([, d]) => d.state)), reviewStates: uniq(decoded.flatMap(([, d]) => (d.reviews || []).map((r) => r.state))), recordStatus: uniq(decoded.flatMap(([, d]) => (d.records || []).map((r) => r.status))), logicalStatus: uniq(decoded.flatMap(([, d]) => (d.logical || []).map((l) => l.status))), issueCodes: uniq(decoded.flatMap(([, d]) => (d.issues || []).map((x) => x.code))), unreadableReasons: uniq(decoded.filter(([, d]) => d.state === "unreadable").map(([, d]) => d.reason)) },
      shapes: { present: decoded.filter(([, d]) => d.state === "present").map(([, d]) => d), tab: tab.map(([, v]) => v) },
    },
    "FZ-P1-05": {
      artifact: "server analytics fin block day credit facts (supplierCredits / purchasesGross) and loader input issues",
      ids: { dayCreditStates: uniq(blocks.map((b) => b[2].supplierCredits && b[2].supplierCredits.state).filter(Boolean)), dayCreditReasons: uniq(blocks.map((b) => b[2].supplierCredits && b[2].supplierCredits.reason).filter(Boolean)), inputIssues: uniq(blocks.flatMap((b) => b[1]).filter((x) => /credit/.test(x))) },
      shapes: { supplierCredits: blocks.map((b) => b[2].supplierCredits).filter(Boolean), purchasesGross: blocks.map((b) => b[2].purchasesGross).filter(Boolean) },
    },
  };
}
export { OWNER };
