// Financial Core B2 — the morning e-mail presenter (S09): rendered from the canonical snapshot
// view model through the shared presenters. B2-T01/T03/T10/T12/T15 (e-mail side), VD-42/44/45
// and consumer-audit FC-01 (subject / KPI table must not state partial results as facts).
import { test } from "node:test";
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { join } from "node:path";
import { spawnSync } from "node:child_process";
import { compileServer, makeDb, installDb, offlineFetch } from "../support/server-reader-harness.mjs";
import { seedRaw, env, entry, uid, T, B, nowMsFor } from "../support/b1-fixtures.mjs";
import { INVARIANTS, INV_NOW_MS, completeSeptember, fullDay, GLOBAL_3000, FIXED_3100 } from "../support/financial-invariants.mjs";

offlineFetch();
const srv = compileServer();
// The shared reader sandbox (tools/, RETAIN) compiles the builder only; compile the e-mail
// presenter into the same sandbox with an e-mail seam that keeps the HTML.
writeFileSync(join(srv.dir, "lib", "sendEmail.js"), "export async function sendEmail(to, subject, html) { (globalThis.__EMAILS ||= []).push({ kind: 'email', to, subject, html }); return { messageId: 'm' }; }\n");
const tsc = spawnSync("node", [join(srv.dir, "node_modules", "typescript", "bin", "tsc"), "--module", "esnext", "--target", "es2022", "--moduleResolution", "bundler", "--skipLibCheck", "--noEmitOnError", "false", join(srv.dir, "src", "snapshot", "snapshotEmail.ts")], { encoding: "utf8" });
const SB = await srv.import("src/snapshot/snapshotBuilder.js");
const SE = await srv.import("src/snapshot/snapshotEmail.js");

async function mail(rows, { nowMs = INV_NOW_MS, config = GLOBAL_3000, fixed = FIXED_3100, bizName = "Biz " + B } = {}) {
  const db = installDb(makeDb());
  seedRaw(db, { entries: env(rows), config: env(config), fixed: fixed === null ? null : env(fixed), businesses: [{ id: B, name: bizName }] });
  const snapshot = await SB.buildSnapshotForBiz(T, B, { nowMs });
  await SE.sendSnapshotEmail("owner@example.test", snapshot);
  const m = globalThis.__EMAILS.at(-1);
  return { snapshot, subject: m.subject, html: m.html, text: m.html.replace(/<style>[\s\S]*?<\/style>/, "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ") };
}
const row = (text, label) => { const i = text.indexOf(label); assert.ok(i >= 0, "row " + label); return text.slice(i, i + label.length + 40); };

test("E-00 the presenter compiles against the typed snapshot (no `number` assumptions left)", () => {
  assert.doesNotMatch(tsc.stdout + tsc.stderr, /snapshotEmail\.ts\(\d+,\d+\): error/, tsc.stdout + tsc.stderr);
});

test("E-01 / B2-T01 complete month: exact values formatted once (₪ half away from zero, one-decimal %), window line 'נתונים עד 28.09'", async () => {
  const { subject, text } = await mail(completeSeptember());
  assert.match(subject, /\| רווח: ₪11,107$/, "33320/3 = 11106.67 ⇒ ₪11,107");
  assert.match(text, /נתונים עד 28\.09 · 28 ימים שהושלמו מתוך 30 · 28 ימים עם נתונים/);
  assert.match(row(text, "הכנסות"), /₪28,000 100\.0%/);
  assert.match(row(text, "קניות (מזון)"), /₪8,400 30\.0% \(יעד: 33\.0%\)/);
  assert.match(row(text, "עלות עובדים"), /₪5,600 20\.0% \(יעד: 27\.0%\)/);
  assert.match(row(text, "הוצאות קבועות"), /₪2,893 10\.3%/);
  assert.match(row(text, "רווח נקי"), /₪11,107 39\.7%/);
  assert.match(text, /נטו \(ללא מע״מ\) · לפי הגדרות נוכחיות · בפועל עד אתמול/);
  assert.doesNotMatch(text, /NaN|undefined|Infinity|null/);
});

test("E-02 / B2-T03 / FC-01 a missing completed day: subject 'רווח: —', revenue marked partial, ratios and profit '—', no profit insight", async () => {
  const { subject, text } = await mail(INVARIANTS.find((i) => i.id === "INV-02").apply(completeSeptember()));
  assert.match(subject, /\| רווח: —$/);
  assert.match(row(text, "הכנסות"), /₪27,000 \(חלקי\) —/);
  assert.match(row(text, "רווח נקי"), /— —/);
  // CDA-18 / B2-G21 (supersedes the generic day count for revenue): the exact missing date, in text, directly below MTD revenue
  assert.match(text, /הכנסות ₪27,000 \(חלקי\) — ⚠ חסרות הכנסות בימים: 20\.09 — סכום ההכנסות אינו מלא/);
  assert.doesNotMatch(text, /רווח נקי (שלילי|חזק)/);
});

test("E-03 FC-01 minimal input (sales 1000, no payroll / purchases / fixed config): the e-mail never states a ₪1,000 profit", async () => {
  const { subject, text } = await mail([entry(uid(3), "2026-09-28", { sales: "1000" })], { config: {}, fixed: null });
  assert.match(subject, /רווח: —$/); assert.doesNotMatch(subject + text, /רווח נקי ₪1,000|רווח: ₪1,000/); assert.match(row(text, "הכנסות"), /₪1,000 \(חלקי\)/);
  assert.match(row(text, "עלות עובדים"), /— —/); assert.match(row(text, "קניות (מזון)"), /— —/);
});

test("E-04 / B2-T10 VD-45 default (b): on the 1st the e-mail is the short 'no completed day' note — no figures, no fixed-cost 'loss'", async () => {
  const { subject, text, snapshot } = await mail([...completeSeptember(), fullDay("2026-10-01")], { nowMs: nowMsFor("2026-10-01") });
  assert.equal(snapshot.presentation, "no_completed_days");
  assert.match(subject, /אין עדיין יום שהושלם החודש$/); assert.doesNotMatch(subject, /רווח/);
  assert.doesNotMatch(text, /₪/); assert.doesNotMatch(text, /מדדי ביצוע|תחזית לסוף החודש/);
});

test("E-05 / B2-T12 / VD-42 projection block: REV_FORECAST/v2 revenue with its formula id; heading 'תחזית לסוף החודש' (typo fixed); insufficient history ⇒ '—' + reason", async () => {
  const full = await mail(completeSeptember());
  assert.match(full.text, /תחזית הכנסות \(REV_FORECAST\/v2\)/); assert.match(full.text, /🎯 תחזית לסוף החודש/); assert.doesNotMatch(full.html, /תחזוקה/);
  assert.equal(full.snapshot.financials.projection.revenue.exact, "30000");
  const short = await mail(Array.from({ length: 8 }, (_, i) => fullDay(`2026-09-${String(21 + i).padStart(2, "0")}`)));
  assert.match(short.text, /רווח נקי חזוי בסיום החודש — לא זמין \([^)]*insufficient_history/);
});

test("E-06 VD-44 insights: shown only for complete inputs; texts keep the retained literals", async () => {
  const good = await mail(completeSeptember(), { config: { ...GLOBAL_3000, targets: { foodCostPct: "20" } } });
  assert.match(good.text, /עלות המזון גבוהה מהיעד: 30\.0% \(יעד: 20%\)/);
  const incomplete = await mail(INVARIANTS.find((i) => i.id === "INV-05").apply(completeSeptember()));
  assert.doesNotMatch(incomplete.text, /עלות העובדים (גבוהה|נמוכה) מהיעד/, "missing payroll ⇒ no labor insight");
});

test("E-07 hourly_payroll recorded ⇒ the 'not counted' note; ₪ rounding is half away from zero on the exact value", async () => {
  const { text } = await mail(INVARIANTS.find((i) => i.id === "INV-08").apply(completeSeptember()));
  assert.match(text, /שדה ישן \(hourly_payroll\) — לא נספר/);
  const half = await mail(completeSeptember().map((r, i) => (i === 0 ? { ...r, sales: "1000.5" } : r)));
  assert.match(row(half.text, "הכנסות"), /₪28,001 /, "28000.5 ⇒ ₪28,001");
});
