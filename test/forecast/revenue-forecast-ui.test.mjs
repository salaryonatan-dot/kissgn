// Verifies the ACTUAL inline forecast code in index.html (window.MarjinForecast)
// is behaviorally equivalent to the canonical TS engine, and tests the exception
// helpers. It extracts and evals the real inline block (not a re-implementation).
import { readFileSync, mkdtempSync, copyFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
import vm from "node:vm";
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..");
const TSC = process.env.TSC_BIN || join(REPO, "node_modules", "typescript", "bin", "tsc");

// 1) extract the inline window.MarjinForecast script from index.html and eval it
const html = readFileSync(join(REPO, "index.html"), "utf8");
const marker = html.indexOf("REV_FORECAST/v1 — mirrored");
const sOpen = html.indexOf("<script>", marker);
const sClose = html.indexOf("</script>", sOpen);
const inlineJs = html.slice(sOpen + "<script>".length, sClose);
const sandbox = { window: {}, Date, Math, parseFloat, isFinite, String, Object, console };
vm.runInNewContext(inlineJs, sandbox);
const MF = sandbox.window.MarjinForecast;
if (!MF) { console.error("failed to extract window.MarjinForecast"); process.exit(2); }

// 2) compile the canonical TS engine for parity comparison
const dir = mkdtempSync(join(tmpdir(), "fcui-"));
mkdirSync(join(dir, "src", "forecast"), { recursive: true });
copyFileSync(join(REPO, "src", "forecast", "revenueForecast.ts"), join(dir, "src", "forecast", "revenueForecast.ts"));
spawnSync("node", [TSC, "--module","esnext","--target","es2020","--moduleResolution","bundler","--skipLibCheck","--noEmitOnError","false", join(dir,"src","forecast","revenueForecast.ts")], { encoding: "utf8" });
const TS = await import(pathToFileURL(join(dir, "src", "forecast", "revenueForecast.js")).href);

let pass=0, fail=0; const results=[];
const ok=(n,c)=>{ if(c){pass++;results.push("PASS "+n);} else {fail++;results.push("FAIL "+n);} };
const day=(date,o={})=>({date,total:o.total??0,had_entry:o.had??(o.total>0),has_sales:o.has_sales,is_exception:o.is_exception,is_outlier:o.is_outlier,stale:o.stale});

// ---- FORECAST CONSISTENCY: inline == TS engine (1-15) ----
function makeHistory(){
  const h=[];
  for(const base of ["2026-06-01","2026-06-08","2026-06-15","2026-06-22"])
    for(let k=0;k<7;k++){ const d=new Date(Date.UTC(2026,5,parseInt(base.slice(8))+k)); h.push(day(d.toISOString().slice(0,10),{total:10000,has_sales:true})); }
  h.push(day("2026-07-01",{total:15000,has_sales:true}));
  h.push(day("2026-07-02",{total:16000,has_sales:true}));
  h.push(day("2026-07-05",{total:4000,has_sales:true}));          // partial today
  h.push(day("2026-06-05",{total:0,had:true,has_sales:false}));   // supplier-only (excluded)
  h.push(day("2026-06-12",{total:99999,has_sales:true,is_exception:true})); // exception (excluded)
  return h;
}
for (const [label, opts] of [
  ["1/13: 31-day July fixture", {targetMonth:"2026-07",today:"2026-07-05"}],
  ["14: Asia/Jerusalem-style date (string today)", {targetMonth:"2026-07",today:"2026-07-15"}],
  ["month/year boundary Dec", {targetMonth:"2026-12",today:"2026-12-10"}],
]) {
  const h=makeHistory();
  const a=MF.computeRevenueForecast({tenantId:"t",bizId:"b",today:opts.today,targetMonth:opts.targetMonth,nowMs:1000,history:h});
  const b=TS.computeRevenueForecast({tenantId:"t",bizId:"b",today:opts.today,targetMonth:opts.targetMonth,nowMs:1000,history:h});
  ok(label+" parity (inline==TS)", JSON.stringify(a)===JSON.stringify(b));
}
// specific behavior checks on the inline impl
{
  const r=MF.computeRevenueForecast({tenantId:"t",bizId:"b",today:"2026-07-05",targetMonth:"2026-07",nowMs:1,history:makeHistory()});
  ok("2/3/4: same-weekday last-4 min-3 (inline sameWeekdayForecast)", MF.sameWeekdayForecast(makeHistory(),0,"2026-07-12").n>=3);
  ok("5: missing day not zero (07-03/04 missing counted)", r.missingCompletedDays===2 && !r.missingCompletedDates.includes("2026-07-05"));
  ok("6: current partial 07-05 not in actual (=31000)", r.actualCompletedRevenue===31000 && r.partialTodayRevenue===4000);
  ok("8: exception history excluded from baseline (99999 not in any weekday samples)", !r.weekdayBreakdown.some(w=>w.sampleValues.includes(99999)));
  ok("10/11: has_sales=false & total=0 excluded", !r.weekdayBreakdown.some(w=>w.sampleValues.includes(0)));
  ok("13: exact weekday counts sum to 31", r.completedCalendarDays+r.remainingDays===31);
  ok("15: no MTD run-rate (result is same-weekday based, formula REV_FORECAST/v1)", r.formulaId==="REV_FORECAST/v1");
  ok("48/25: no NaN/Infinity", Number.isFinite(r.monthEndForecastRevenue) && Number.isFinite(r.remainingForecastRevenue));
}
// insufficient => suppressed (12/23)
{
  const r=MF.computeRevenueForecast({tenantId:"t",bizId:"b",today:"2026-07-05",targetMonth:"2026-07",nowMs:1,history:[day("2026-06-07",{total:10000,has_sales:true}),day("2026-06-14",{total:10000,has_sales:true})]});
  ok("12: insufficient history suppresses number (null)", r.monthEndForecastRevenue===null && r.warnings.includes("insufficient_weekday_history"));
  const m=MF.buildForecastCardModel(r); ok("23: card shows insufficient-history text", /אין מספיק היסטוריה/.test(m.monthEndLine));
}
// ---- DASHBOARD card model (16-22) ----
{
  const r=MF.computeRevenueForecast({tenantId:"t",bizId:"b",today:"2026-07-05",targetMonth:"2026-07",nowMs:1,history:makeHistory()});
  const m=MF.buildForecastCardModel(r);
  ok("16: actual completed line", /בפועל מימים שהושלמו: ₪/.test(m.actualLine));
  ok("17: remaining forecast line", /תחזית לימים שנותרו: ₪/.test(m.remainingLine));
  ok("18: month-end line", /תחזית סוף חודש: ₪/.test(m.monthEndLine));
  ok("19: completeness line", /שלמות נתונים: \d+ מתוך \d+/.test(m.completenessLine));
  ok("20: confidence band", /ביטחון: (גבוה|בינוני|נמוך)/.test(m.confidenceLine));
  ok("21: missing-day warning", m.missingWarning && /טרם הוזנו/.test(m.missingWarning));
  ok("22: partial-day note", m.partialNote && /היום טרם הסתיים/.test(m.partialNote));
}
// entriesToForecastDays mapper
{
  const fds=MF.entriesToForecastDays([{date:"2026-07-01",sales:"100",supplier_payments:{a:"50"}},{date:"2026-07-02",sales:0,supplier_payments:{a:"500"}}]);
  ok("mapper: sales day => has_sales true; supplier-only => has_sales false", fds[0].has_sales===true && fds[0].total===100 && fds[1].has_sales===false && fds[1].total===0 && fds[1].had_entry===true);
}
// ---- EXCEPTION helpers (26-38) ----
ok("26/27/28: manager/owner/super_owner can edit exception", MF.canEditException("manager")&&MF.canEditException("owner")&&MF.canEditException("super_owner"));
ok("29/30/48: shift_manager/viewer cannot; no admin role", !MF.canEditException("shift_manager")&&!MF.canEditException("viewer")&&!MF.canEditException("admin"));
{
  const prev={is_exception:true,exception_reason:"holiday",exception_note:"n",exception_set_at:5,exception_set_by:"u1"};
  ok("31: existing exception loads", MF.loadExceptionForForm(prev).is_exception===true && MF.loadExceptionForForm(prev).exception_reason==="holiday");
  ok("35: legacy entry defaults false", MF.loadExceptionForForm({date:"x"}).is_exception===false);
  const cleared=MF.sanitizeExceptionOnSave("owner",prev,{is_exception:false},"u2",99);
  ok("32: clearing removes exception (is_exception false)", cleared.is_exception===false && cleared.exception_reason===undefined);
  const forged=MF.sanitizeExceptionOnSave("viewer",{is_exception:false},{is_exception:true,exception_reason:"holiday"},"attacker",99);
  ok("36: unauthorized forged exception stripped", forged.is_exception===false);
  const preserved=MF.sanitizeExceptionOnSave("shift_manager",prev,{is_exception:false},"sm",99);
  ok("36b: unauthorized cannot clear an existing exception (prior preserved)", preserved.is_exception===true && preserved.exception_set_by==="u1");
  const set=MF.sanitizeExceptionOnSave("manager",{is_exception:false},{is_exception:true,exception_reason:"closure",exception_note:"x"},"mgr",1234);
  ok("37: authorized set stamps set_at/set_by", set.is_exception===true && set.exception_reason==="closure" && set.exception_set_at===1234 && set.exception_set_by==="mgr");
  ok("33/34: reason carried, note optional", set.exception_note==="x");
}
console.log("Total: "+(pass+fail)+"  Passed: "+pass+"  Failed: "+fail);
console.log(results.join("\n"));
process.exit(fail>0?1:0);
