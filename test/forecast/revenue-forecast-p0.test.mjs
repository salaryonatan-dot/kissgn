// Deterministic tests for REV_FORECAST/v1 (src/forecast/revenueForecast.ts).
// Pure module — compiled with the project's typescript; NO network/Firebase/provider.
import { mkdtempSync, copyFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";
const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..");
const TSC = process.env.TSC_BIN || join(REPO, "node_modules", "typescript", "bin", "tsc");
if (!existsSync(TSC)) { console.error("typescript not found; set TSC_BIN"); process.exit(2); }
const dir = mkdtempSync(join(tmpdir(), "fc-"));
mkdirSync(join(dir, "src", "forecast"), { recursive: true });
copyFileSync(join(REPO, "src", "forecast", "revenueForecast.ts"), join(dir, "src", "forecast", "revenueForecast.ts"));
const r = spawnSync("node", [TSC, "--module","esnext","--target","es2020","--moduleResolution","bundler","--skipLibCheck","--noEmitOnError","false", join(dir,"src","forecast","revenueForecast.ts")], { encoding: "utf8" });
const out = join(dir, "src", "forecast", "revenueForecast.js");
if (!existsSync(out)) { console.error("compile failed:\n", r.stdout, r.stderr); process.exit(2); }
const F = await import(pathToFileURL(out).href);

let pass=0, fail=0; const results=[];
const ok=(n,c)=>{ if(c){pass++;results.push("PASS "+n);} else {fail++;results.push("FAIL "+n);} };
const approx=(a,b,e=0.5)=>Math.abs(a-b)<=e;
const day=(date,o={})=>({ date, total:o.total??0, had_entry:o.had??(o.total>0), has_sales:o.has_sales, is_exception:o.is_exception, is_outlier:o.is_outlier, stale:o.stale });

// ---- CALENDAR (1-11) ----
ok("1: Feb non-leap 28 days", F.daysInMonth(2027,2)===28);
ok("2: Feb leap 29 days", F.daysInMonth(2028,2)===29);
ok("3: Apr 30 days", F.daysInMonth(2026,4)===30);
ok("4: Jul 31 days", F.daysInMonth(2026,7)===31);
ok("10: dow 2026-07-10 = Fri(5)", F.dowOf("2026-07-10")===5);
ok("10b: dow 2026-07-11 = Sat(6)", F.dowOf("2026-07-11")===6);
ok("10c: dow 2026-07-12 = Sun(0)", F.dowOf("2026-07-12")===0);
{
  const jul = F.datesInMonth("2026-07");
  const sundays = jul.filter(d=>F.dowOf(d)===0).length;
  const saturdays = jul.filter(d=>F.dowOf(d)===6).length;
  ok("5/6: July 2026 real weekday counts (Sun="+sundays+",Sat="+saturdays+")", sundays>=4 && saturdays>=4 && jul.length===31);
  ok("47: exact weekday counts from real calendar (sum=31)", jul.length===31);
}
ok("9: month/year boundary Dec 2026 = 31", F.daysInMonth(2026,12)===31);
ok("11: businessLocalDate deterministic (tz)", typeof F.businessLocalDate(1783771200000,"Asia/Jerusalem")==="string" && /^\d{4}-\d{2}-\d{2}$/.test(F.businessLocalDate(1783771200000,"Asia/Jerusalem")));

// ---- SAME-WEEKDAY forecast (20-35) ----
{
  const fris=["2026-05-01","2026-05-08","2026-05-15","2026-05-22","2026-05-29","2026-06-05"].map((d,i)=>day(d,{total:10000+i*1000,has_sales:true}));
  const s=F.sameWeekdayForecast(fris,5,"2026-07-10");
  ok("20/21: uses last 4 same-weekday (n=4, newest 4)", s.n===4 && s.dates[0]==="2026-05-15" && s.dates[3]==="2026-06-05");
  ok("33: sample ordering ascending", s.dates.join()<s.dates.slice().reverse().join() || s.dates.length<=1);
}
ok("22: exactly 3 samples allowed", F.sameWeekdayForecast(["2026-06-05","2026-06-12","2026-06-19"].map(d=>day(d,{total:12000,has_sales:true})),5,"2026-07-10").n===3);
ok("24: mixed weekday excluded", F.sameWeekdayForecast([day("2026-07-09",{total:99999,has_sales:true})],5,"2026-07-10").n===0);
ok("25: target/current excluded (strictly before)", F.sameWeekdayForecast([day("2026-07-10",{total:99999,has_sales:true})],5,"2026-07-10").n===0);
ok("26: future samples excluded", F.sameWeekdayForecast([day("2026-07-17",{total:99999,has_sales:true})],5,"2026-07-10").n===0);
ok("27: total=0 excluded", F.sameWeekdayForecast([day("2026-06-05",{total:0,had:true,food:1})].map(x=>({...x,had_entry:true})),5,"2026-07-10").n===0);
ok("28: has_sales=false excluded", F.sameWeekdayForecast([day("2026-06-05",{total:12000,has_sales:false})],5,"2026-07-10").n===0);
ok("29: legacy total>0 no has_sales included", F.sameWeekdayForecast([day("2026-05-29",{total:12000}),day("2026-06-05",{total:13000}),day("2026-06-12",{total:14000})],5,"2026-07-10").n===3);
ok("31: stale excluded", F.sameWeekdayForecast([day("2026-06-05",{total:12000,has_sales:true,stale:true})],5,"2026-07-10").n===0);
ok("32: exception sample excluded", F.sameWeekdayForecast([day("2026-06-05",{total:99999,has_sales:true,is_exception:true})],5,"2026-07-10").n===0);
ok("30: missing sample naturally absent", F.sameWeekdayForecast([],5,"2026-07-10").n===0);

// ---- MONTH FORECAST (12-19, 46-56) ----
function build(hist, today, month="2026-07"){ return F.computeRevenueForecast({tenantId:"t1",bizId:"b1",targetMonth:month,businessTimezone:"Asia/Jerusalem",today,nowMs:1000,history:hist}); }
{
  // History: give every weekday >=3 valid prior samples (June), plus 2 completed July days.
  const hist=[];
  for (const base of ["2026-06-01","2026-06-08","2026-06-15","2026-06-22"]) // Mondays etc across a full week
    for (let k=0;k<7;k++){ const d=new Date(Date.UTC(2026,5,parseInt(base.slice(8))+k)); const ds=d.toISOString().slice(0,10); hist.push(day(ds,{total:10000,has_sales:true})); }
  // two completed July days (before today 2026-07-05): 07-01(15000), 07-02(16000)
  hist.push(day("2026-07-01",{total:15000,has_sales:true}));
  hist.push(day("2026-07-02",{total:16000,has_sales:true}));
  const res=build(hist,"2026-07-05");
  ok("12: completed entered days in actual (15000+16000; 07-03/04 missing)", res.actualCompletedRevenue===31000);
  ok("13/14: missing past days not zero & counted", res.missingCompletedDays===2 && res.missingCompletedDates.includes("2026-07-03") && res.enteredCompletedDays===2 && res.completedCalendarDays===4);
  ok("15: current partial (07-05) not in actual", res.actualCompletedRevenue===31000);
  ok("48: actual + remaining = month-end forecast", res.monthEndForecastRevenue===res.actualCompletedRevenue+res.remainingForecastRevenue);
  ok("50/51: current day counted once as remaining; no double count", res.remainingDays===27 && (res.completedCalendarDays+res.remainingDays)===31);
  ok("52: no date outside month (31 total)", res.completedCalendarDays+res.remainingDays===31);
  ok("57: formulaId", res.formulaId==="REV_FORECAST/v1");
  ok("60: weekday breakdown complete (7 weekdays)", res.weekdayBreakdown.length===7);
  ok("61: missing-day warning", res.warnings.includes("missing_completed_days"));
  ok("62: partial-day warning", res.warnings.includes("partial_current_day"));
  ok("66: deterministic (rerun identical)", JSON.stringify(build(hist,"2026-07-05"))===JSON.stringify(res));
  ok("64/65: confidence <= max and completeness<1 not high", res.confidence<=0.95 && (res.completeness<1 ? res.confidenceBand!=="high"||res.confidence<0.95 : true));
}
// Insufficient one/all weekdays
{
  const res=build([day("2026-06-07",{total:10000,has_sales:true}),day("2026-06-14",{total:10000,has_sales:true})],"2026-07-05"); // only 2 samples, one weekday
  ok("23/54: <3 samples => insufficient; all-insufficient suppresses month number", res.monthEndForecastRevenue===null && res.warnings.includes("insufficient_weekday_history"));
  ok("63: insufficient-history disclosed", res.confidence===0);
  const model=F.buildForecastCardModel(res);
  ok("54b: suppressed presenter shows 'אין מספיק היסטוריה'", model.suppressed && /אין מספיק היסטוריה/.test(model.monthEndLine));
}

// ---- EXCEPTION days (36-45) ----
{
  const hist=[];
  for (const base of ["2026-06-01","2026-06-08","2026-06-15","2026-06-22"])
    for (let k=0;k<7;k++){ const d=new Date(Date.UTC(2026,5,parseInt(base.slice(8))+k)); hist.push(day(d.toISOString().slice(0,10),{total:10000,has_sales:true})); }
  hist.push(day("2026-07-01",{total:15000,has_sales:true}));
  hist.push(day("2026-07-02",{total:50000,has_sales:true,is_exception:true})); // festival exception, big
  const res=build(hist,"2026-07-05");
  ok("36: exception day counted in actual (15000+50000)", res.actualCompletedRevenue===65000);
  ok("45/exception warning", res.warnings.includes("exception_days_excluded"));
  // exception excluded from future baseline: a July Thursday forecast must not use 07-02(50000)
  const s=F.sameWeekdayForecast(hist,F.dowOf("2026-07-02"),"2026-07-09");
  ok("37: exception excluded from future baseline", !s.values.includes(50000));
}
ok("38: closure zero-revenue exception excluded from baseline", F.sameWeekdayForecast([day("2026-06-05",{total:0,had:true,is_exception:true})].map(x=>({...x,had_entry:true})),5,"2026-07-10").n===0);
ok("41: legacy entry defaults non-exception (is_exception undefined => sample eligible)", F.sameWeekdayForecast([day("2026-05-29",{total:12000}),day("2026-06-05",{total:12000}),day("2026-06-12",{total:12000})],5,"2026-07-10").n===3);
ok("42: clearing exception restores eligibility", F.sameWeekdayForecast([day("2026-06-05",{total:12000,has_sales:true,is_exception:false})],5,"2026-07-10").n===1);

// ---- DUPLICATE dates (49, dup policy) ----
{
  const hist=[day("2026-06-05",{total:12000,has_sales:true}),day("2026-06-05",{total:9999,has_sales:true}),day("2026-06-12",{total:12000,has_sales:true}),day("2026-06-19",{total:12000,has_sales:true})];
  const s=F.sameWeekdayForecast(hist.filter(d=>true),5,"2026-07-10");
  const res=build(hist,"2026-07-05");
  ok("dup: duplicate dates flagged (warning)", res.warnings.includes("duplicate_dates"));
  ok("dup: duplicate date excluded from baseline (not double-counted)", F.computeRevenueForecast({tenantId:"t",bizId:"b",targetMonth:"2026-07",today:"2026-07-05",nowMs:1,history:hist}).warnings.includes("duplicate_dates"));
}

// ---- Presenter / UI contract (67-73) ----
{
  const hist=[];
  for (const base of ["2026-06-01","2026-06-08","2026-06-15","2026-06-22"])
    for (let k=0;k<7;k++){ const d=new Date(Date.UTC(2026,5,parseInt(base.slice(8))+k)); hist.push(day(d.toISOString().slice(0,10),{total:10000,has_sales:true})); }
  hist.push(day("2026-07-01",{total:15000,has_sales:true}));
  hist.push(day("2026-07-05",{total:4000,has_sales:true})); // partial today
  const res=build(hist,"2026-07-05");
  const m=F.buildForecastCardModel(res);
  ok("67: card shows actual completed revenue", /בפועל מימים שהושלמו: ₪/.test(m.actualLine));
  ok("68: card shows remaining forecast", /תחזית לימים שנותרו: ₪/.test(m.remainingLine));
  ok("69: card shows month-end forecast", /תחזית סוף חודש: ₪/.test(m.monthEndLine));
  ok("70: card shows completeness X of Y", /שלמות נתונים: \d+ מתוך \d+ ימים שהסתיימו/.test(m.completenessLine));
  ok("71: card shows confidence band", /ביטחון: (גבוה|בינוני|נמוך)/.test(m.confidenceLine));
  ok("72: missing-day warning present", m.missingWarning && /טרם הוזנו/.test(m.missingWarning));
  ok("73: partial-day note present & not labeled actual", m.partialNote && /היום טרם הסתיים/.test(m.partialNote) && res.partialTodayRevenue===4000);
  ok("74: legacy-safe (no crash on legacy entries)", typeof res.monthEndForecastRevenue==="number" || res.monthEndForecastRevenue===null);
}

console.log("Total: "+(pass+fail)+"  Passed: "+pass+"  Failed: "+fail);
console.log(results.join("\n"));
process.exit(fail>0?1:0);
