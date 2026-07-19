// Deterministic P0 regression tests for the false supplier & revenue insights.
// Self-contained: compiles the real insight modules + dailyBuilder with the
// project's typescript devDependency, then asserts behaviour. NO network,
// Firebase, Vercel, email, or provider calls — every dependency is stubbed.
//   Run:  node test/insights/false-insights-p0.test.mjs
//   (needs `npm install` for `typescript`, or set TSC_BIN)
import { mkdtempSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..");
const TSC = process.env.TSC_BIN || join(REPO, "node_modules", "typescript", "bin", "tsc");
if (!existsSync(TSC)) { console.error("typescript not found at", TSC, "(npm install or set TSC_BIN)"); process.exit(2); }

const dir = mkdtempSync(join(tmpdir(), "p0-insights-"));
mkdirSync(join(dir, "src", "insights"), { recursive: true });
mkdirSync(join(dir, "src", "analytics"), { recursive: true });
mkdirSync(join(dir, "src", "firebase"), { recursive: true });
for (const f of ["types.ts", "baselines.ts", "rules.ts", "buildInsights.ts"])
  copyFileSync(join(REPO, "src", "insights", f), join(dir, "src", "insights", f));
copyFileSync(join(REPO, "src", "analytics", "dailyBuilder.ts"), join(dir, "src", "analytics", "dailyBuilder.ts"));
// stubs for dailyBuilder's external imports (resolved by Node at runtime)
writeFileSync(join(dir, "src", "firebase", "admin.js"), `export function getDb(){ return globalThis.__DB; }`);
writeFileSync(join(dir, "src", "analytics", "regionResolver.js"), `export function resolveOrefAreas(){ return ["חדרה"]; }`);

const tscArgs = ["--module","esnext","--target","es2020","--moduleResolution","bundler","--skipLibCheck","--noEmitOnError","false",
  join(dir,"src","insights","buildInsights.ts"), join(dir,"src","insights","rules.ts"),
  join(dir,"src","insights","baselines.ts"), join(dir,"src","analytics","dailyBuilder.ts")];
const r = spawnSync("node", [TSC, ...tscArgs], { encoding: "utf8" });
const built = (f)=>join(dir,"src",f);
if (!existsSync(built("insights/rules.js")) || !existsSync(built("analytics/dailyBuilder.js"))) {
  console.error("compile failed:\n", r.stdout, r.stderr); process.exit(2);
}

const rules = await import(pathToFileURL(built("insights/rules.js")).href);
const baselines = await import(pathToFileURL(built("insights/baselines.js")).href);
const engine = await import(pathToFileURL(built("insights/buildInsights.js")).href);
const daily = await import(pathToFileURL(built("analytics/dailyBuilder.js")).href);

let pass=0, fail=0; const results=[];
const ok=(n,c)=>{ if(c){pass++;results.push("PASS "+n);} else {fail++;results.push("FAIL "+n);} };
const approx=(a,b,eps=0.01)=>Math.abs(a-b)<=eps;

// Fixture: an AnalyticsDailyInput. dow 0=Sun..6=Sat. FRI=5.
function day(date, dow, total, opts={}) {
  const { food=0, payroll=0, had=total>0||food>0, has_sales, sales, exception } = opts;
  const rev = { sales: sales ?? total, deliveries:0, other_income:0, total, food_cost:food, payroll, had_entry:had };
  if (has_sales !== undefined) rev.has_sales = has_sales;
  const obj = { date, bizId:"b1", tenantId:"t1", revenue:rev,
    weather:null, alerts:null, operational:{war_day:"regular"},
    calendar:{ dow, weekend: dow===5||dow===6, holiday:false } };
  if (exception) obj.is_exception = true;
  return obj;
}
const NOW = 1000;

// ---- REVENUE BASELINE (same-weekday) ----
// Real-world 07-10 fixture: target Friday 10908; prior Fridays avg 14552.
const priorFridays = [ day("2026-06-19",5,14000), day("2026-06-26",5,14552), day("2026-07-03",5,15104) ]; // avg 14552, n=3
const target = day("2026-07-10",5,10908,{food:6547.66});
{
  const sw = baselines.sameWeekdayRecentAvg(priorFridays, 5, 4);
  ok("baseline = mean of last valid same-weekday (14552, n=3)", approx(sw.avg,14552) && sw.n===3);
  const spike = rules.ruleRevenueSpike(target, priorFridays, NOW);
  ok("19/21: target 10908 vs 14552 does NOT produce a +76% spike (null)", spike===null);
  const drop = rules.ruleRevenueDrop(target, priorFridays, NOW);
  ok("20: same fixture yields ~-25% drop", drop && approx(drop.deltaPct,-0.2504,0.002));
  ok("25: evidence includes sample count + baseline + weekday", drop && drop.evidence.some(e=>/דגימות/.test(e)&&/3/.test(e)) && drop.baselineValue===14552 && drop.evidence.some(e=>/שישי/.test(e)) && /^מחזור: ₪/.test(drop.evidence[0]));
}
// prove OLD generic logic could yield ~+76% (documentation): baseline 6201
ok("old-style baseline 6201 would give +76% (documented, not from new code)", approx((10908-6201)/6201,0.759,0.01));

// 1: target excluded from its own baseline (history never contains target)
{
  const withTargetInHistory = [...priorFridays]; // caller passes history w/o today
  const sw = baselines.sameWeekdayRecentAvg(withTargetInHistory,5,4);
  ok("1: baseline uses only history (target not in it)", sw.n===3 && approx(sw.avg,14552));
}
// 2: same weekday only (a Thursday must not enter a Friday baseline)
{
  const mixed=[...priorFridays, day("2026-07-09",4,99999)]; // Thursday big
  const sw=baselines.sameWeekdayRecentAvg(mixed,5,4);
  ok("2: same-weekday only (Thursday ignored)", approx(sw.avg,14552)&&sw.n===3);
}
// 3/4: last 4 samples, exactly 3 allowed
{
  const f4=[day("2026-06-05",5,10000),day("2026-06-12",5,20000),day("2026-06-19",5,14000),day("2026-06-26",5,14552),day("2026-07-03",5,15104)];
  const sw=baselines.sameWeekdayRecentAvg(f4,5,4);
  ok("3: uses last 4 same-weekday only", sw.n===4 && approx(sw.avg,(20000+14000+14552+15104)/4));
  const sw3=baselines.sameWeekdayRecentAvg(priorFridays,5,4);
  ok("4: exactly 3 samples is allowed (>=MIN)", sw3.n===3);
}
// 5: only 2 valid samples -> suppress
{
  const two=[day("2026-06-26",5,14000),day("2026-07-03",5,15000)];
  ok("5: 2 samples suppresses spike/drop", rules.ruleRevenueSpike(day("2026-07-10",5,30000),two,NOW)===null && rules.ruleRevenueDrop(day("2026-07-10",5,3000),two,NOW)===null);
}
// 8/9: total=0 / supplier-only had_entry excluded
{
  const withZeros=[...priorFridays, day("2026-06-12",5,0,{food:5000,had:true})]; // supplier-only Friday total 0
  const sw=baselines.sameWeekdayRecentAvg(withZeros,5,4);
  ok("8/9: total=0 supplier-only day excluded from baseline", sw.n===3 && approx(sw.avg,14552));
}
// 10: legacy (no has_sales) total>0 included
{
  const legacy=[day("2026-06-19",5,14000),day("2026-06-26",5,14552),day("2026-07-03",5,15104)]; // no has_sales field
  ok("10: legacy record without has_sales but total>0 included", baselines.sameWeekdayRecentAvg(legacy,5,4).n===3);
}
// 11: explicit has_sales=false excluded even if total>0
{
  const hs=[day("2026-06-19",5,14000),day("2026-06-26",5,14552),day("2026-07-03",5,15104),day("2026-06-12",5,50000,{has_sales:false})];
  const sw=baselines.sameWeekdayRecentAvg(hs,5,4);
  ok("11: has_sales===false excluded from baseline", sw.n===3 && approx(sw.avg,14552));
}
// 17/18: baseline zero / negative target
{
  ok("17: baseline of 0 -> deltaPct null -> suppressed", baselines.deltaPct(100,0)===null);
  const negTarget=day("2026-07-10",5,-500);
  ok("18: negative/zero revenue target -> no positive spike", rules.ruleRevenueSpike(negTarget,priorFridays,NOW)===null);
}
// 21/22/23: genuine spike + thresholds
{
  const bigFri=day("2026-07-10",5,20000); // (20000-14552)/14552=+37% >= 20%
  const sp=rules.ruleRevenueSpike(bigFri,priorFridays,NOW);
  ok("21: genuine same-weekday spike still fires positive", sp && sp.severity==="positive" && sp.deltaPct>=0.2);
  const belowFri=day("2026-07-10",5,16500); // (16500-14552)/14552=+13.4% < 20%
  ok("22: below threshold does not fire", rules.ruleRevenueSpike(belowFri,priorFridays,NOW)===null);
  const atFri=day("2026-07-10",5, Math.round(14552*1.2001)); // just over +20%
  ok("23: at/above threshold fires", rules.ruleRevenueSpike(atFri,priorFridays,NOW)!==null);
}

// ---- SUPPLIER RULE (suppressed) ----
ok("26: lumpy 6547.66/10908 (60%) does NOT produce supplier_spend_risk", rules.ruleSupplierSpendRisk(target, priorFridays, NOW)===null);
{
  const heavy=day("2026-07-06",6,13692,{food:14159.89}); // 103% daily ratio
  ok("27: 103% daily purchase ratio produces no Food Cost insight", rules.ruleSupplierSpendRisk(heavy,[],NOW)===null);
  ok("28: no-purchase day produces none", rules.ruleSupplierSpendRisk(day("2026-07-04",6,25778,{food:0}),[],NOW)===null);
}
// 30/31: not renamed; other rules still run
{
  const built = engine.buildInsights(target, priorFridays, NOW);
  const types = built.insights.map(i=>i.type);
  ok("30: no supplier_spend_risk emitted for the false 60% day", !types.includes("supplier_spend_risk"));
  ok("31: other rules still run (revenue_drop present for -25% day)", types.includes("revenue_drop"));
  ok("engine: no positive spike in the false fixture", !built.insights.some(i=>i.type==="revenue_spike"));
}

// ---- ANALYTICS BUILD (has_sales) via stubbed db (no network/Firebase) ----
globalThis.fetch = async () => ({ ok:false, status:500, json: async()=>({}) }); // soft-fail weather/oref
function stubDb(entries){ return { ref:(p)=>({ once: async()=>({ val:()=> p.endsWith(":entries")? entries : (p.endsWith("/app/business")? [{id:"b1",name:"Biz"}] : {}) }) }) }; }
{
  globalThis.__DB = stubDb([{date:"2026-07-10", sales:10908, supplier_payments:{x:"6547.66"}}]);
  const doc = await daily.buildAnalyticsForBiz("t1","b1","2026-07-10");
  ok("32: revenue entry => has_sales=true, had_entry=true", doc.revenue.has_sales===true && doc.revenue.had_entry===true && doc.revenue.total===10908);
  ok("supplier field preserved in analytics", approx(doc.revenue.food_cost,6547.66));
}
{
  globalThis.__DB = stubDb([{date:"2026-07-12", sales:0, deliveries:0, supplier_payments:{x:"870.34"}}]);
  const doc = await daily.buildAnalyticsForBiz("t1","b1","2026-07-12");
  ok("33: supplier-only entry => has_sales=false, had_entry=true, total=0", doc.revenue.has_sales===false && doc.revenue.had_entry===true && doc.revenue.total===0);
}
{
  globalThis.__DB = stubDb([{date:"2026-07-01", sales:100}]); // missing target date
  const doc = await daily.buildAnalyticsForBiz("t1","b1","2026-07-10");
  ok("34: missing revenue entry => total 0, has_sales false (not a valid baseline day)", doc.revenue.total===0 && doc.revenue.has_sales===false && doc.revenue.had_entry===false);
}

// ---- CHANGE 1: revenue-drop TARGET eligibility (guard the target, not just baseline) ----
{
  const supplierOnly = day("2026-07-10",5,0,{food:5000,had:true,has_sales:false});
  ok("C1.1: supplier-only target (had_entry,total=0,has_sales=false) => no revenue_drop", rules.ruleRevenueDrop(supplierOnly, priorFridays, NOW)===null);
  const b = engine.buildInsights(supplierOnly, priorFridays, NOW);
  ok("C1.1b: supplier-only target => no revenue anomaly at all", !b.insights.some(i=>i.type==="revenue_drop"||i.type==="revenue_spike"));
  const legacyZero = day("2026-07-10",5,0,{food:5000,had:true}); // total=0, no has_sales
  ok("C1.2: legacy target total=0, no has_sales => no revenue_drop", rules.ruleRevenueDrop(legacyZero, priorFridays, NOW)===null);
  const hsFalse = day("2026-07-10",5,10908,{has_sales:false});
  ok("C1.3: total>0 but has_sales=false => no revenue_drop", rules.ruleRevenueDrop(hsFalse, priorFridays, NOW)===null);
  const validDrop = day("2026-07-10",5,10908,{has_sales:true});
  const dr4 = rules.ruleRevenueDrop(validDrop, priorFridays, NOW);
  ok("C1.4: valid total>0 & has_sales=true => drop fires (~-25%)", dr4 && approx(dr4.deltaPct,-0.2504,0.002));
  const legacyValid = day("2026-07-10",5,10908); // total>0, no has_sales
  ok("C1.5: legacy valid (total>0, no has_sales) => backward-compatible, drop fires", rules.ruleRevenueDrop(legacyValid, priorFridays, NOW)!==null);
  const excDrop = day("2026-07-10",5,10908,{exception:true,has_sales:true});
  const excSpike = day("2026-07-10",5,30000,{exception:true,has_sales:true});
  ok("C1.6: exception target => no revenue anomaly (drop or spike)", rules.ruleRevenueDrop(excDrop, priorFridays, NOW)===null && rules.ruleRevenueSpike(excSpike, priorFridays, NOW)===null);
}
// ---- CHANGE 2: evidence order (dashboard renders only evidence[0]) ----
{
  const dr = rules.ruleRevenueDrop(day("2026-07-10",5,10908,{has_sales:true}), priorFridays, NOW);
  ok("C2.1: drop evidence[0] is the revenue summary (מחזור: ₪...)", /^מחזור: ₪/.test(dr.evidence[0]));
  ok("C2.2: target date present elsewhere in evidence", dr.evidence.slice(1).some(e=>/2026-07-10/.test(e)));
  ok("C2.3: baseline present in evidence", dr.evidence.some(e=>/ממוצע/.test(e) && /14,552/.test(e)));
  ok("C2.4: sample count present in evidence", dr.evidence.some(e=>/דגימות/.test(e) && /3/.test(e)));
  ok("C2.5: weekday present in evidence", dr.evidence.some(e=>/שישי/.test(e)));
  const sp = rules.ruleRevenueSpike(day("2026-07-10",5,20000,{has_sales:true}), priorFridays, NOW);
  ok("C2.6: spike evidence[0] is the revenue summary", /^מחזור: ₪/.test(sp.evidence[0]));
  ok("C2.7: spike retains date+baseline+samples+weekday", sp.evidence.some(e=>/2026-07-10/.test(e)) && sp.evidence.some(e=>/ממוצע/.test(e)) && sp.evidence.some(e=>/דגימות/.test(e)) && sp.evidence.some(e=>/שישי/.test(e)));
}

// ---- CHANGE 3: target eligibility for the four context/weekday revenue rules ----
// weak_weekday / weather_impact / alert_impact / war_day_impact must use the SAME
// canonical isValidRevenueTarget guard as revenue_drop/spike. A supplier-only day
// (had_entry=true, total=0, has_sales=false) must produce none of them.
function withWeather(d, isRain, mm){ d.weather = { is_rain_day:isRain, rain_mm: mm ?? null }; return d; }
function withAlerts(d, isAlert, minutes, count){ d.alerts = { is_alert_day:isAlert, alert_minutes:minutes??0, alert_count:count??0 }; return d; }
function withWar(d, status){ d.operational = { war_day:status }; return d; }

// -- weak_weekday --
{
  // priorFridays = 3 valid Fridays (avg 14552). Supplier-only Friday target => null.
  const supplierFri = day("2026-07-10",5,0,{food:5000,had:true,has_sales:false});
  ok("C3.1: supplier-only day emits NO weak_weekday (was -100%)", rules.ruleWeakWeekday(supplierFri, priorFridays, NOW)===null);
  // point 2: supplier-only day never enters the same-weekday baseline as zero.
  const withSupplier = [...priorFridays, day("2026-06-12",5,0,{food:5000,had:true,has_sales:false})];
  const sw = baselines.sameWeekdayAvg(withSupplier, 5);
  ok("C3.2: supplier-only day excluded from weekday baseline (n=3, avg 14552)", sw.n===3 && approx(sw.avg,14552));
  // point 7: a genuinely weak valid Friday still fires.
  const weakFri = day("2026-07-10",5,8000,{has_sales:true}); // -45% vs 14552
  const wk = rules.ruleWeakWeekday(weakFri, priorFridays, NOW);
  ok("C3.3: valid weak Friday still fires weak_weekday", wk && wk.deltaPct < -0.15);
  // legacy valid (no has_sales, total>0) still fires.
  ok("C3.4: legacy valid weak Friday (no has_sales) still fires", rules.ruleWeakWeekday(day("2026-07-10",5,8000), priorFridays, NOW)!==null);
}

// -- weather_impact --
{
  const dryHist = ["2026-06-01","2026-06-02","2026-06-03","2026-06-04","2026-06-05"]
    .map((dt,i)=>withWeather(day(dt,(i%5)+1,10000,{has_sales:true}), false));
  const supplierRain = withWeather(day("2026-07-10",5,0,{food:5000,had:true,has_sales:false}), true, 20);
  ok("C3.5: supplier-only rain day emits NO weather_impact", rules.ruleWeatherImpact(supplierRain, dryHist, NOW)===null);
  const validRain = withWeather(day("2026-07-10",5,7000,{has_sales:true}), true, 20); // -30% vs dry 10000
  ok("C3.6: valid rain day still fires weather_impact", rules.ruleWeatherImpact(validRain, dryHist, NOW)!==null);
}

// -- alert_impact --
{
  const calmHist = ["2026-06-01","2026-06-02","2026-06-03","2026-06-04","2026-06-05"]
    .map((dt,i)=>withAlerts(day(dt,(i%5)+1,10000,{has_sales:true}), false, 0, 0));
  const supplierAlert = withAlerts(day("2026-07-10",5,0,{food:5000,had:true,has_sales:false}), true, 30, 2);
  ok("C3.7: supplier-only alert day emits NO alert_impact", rules.ruleAlertImpact(supplierAlert, calmHist, NOW)===null);
  const validAlert = withAlerts(day("2026-07-10",5,8000,{has_sales:true}), true, 30, 2); // -20% vs calm 10000
  ok("C3.8: valid alert day still fires alert_impact", rules.ruleAlertImpact(validAlert, calmHist, NOW)!==null);
}

// -- war_day_impact --
{
  const regHist = ["2026-06-01","2026-06-02","2026-06-03","2026-06-04","2026-06-05"]
    .map((dt,i)=>withWar(day(dt,(i%5)+1,10000,{has_sales:true}), "regular"));
  const supplierWar = withWar(day("2026-07-10",5,0,{food:5000,had:true,has_sales:false}), "partial");
  ok("C3.9: supplier-only war day emits NO war_day_impact", rules.ruleWarDayImpact(supplierWar, regHist, NOW)===null);
  const validWar = withWar(day("2026-07-10",5,8000,{has_sales:true}), "partial"); // -20% vs regular 10000
  ok("C3.10: valid war day still fires war_day_impact", rules.ruleWarDayImpact(validWar, regHist, NOW)!==null);
}

// -- mixed dataset: only eligible revenue dates are used --
{
  const mixed = [ day("2026-06-19",5,14000,{has_sales:true}), day("2026-06-26",5,14552,{has_sales:true}),
                  day("2026-07-03",5,15104,{has_sales:true}), day("2026-06-12",5,0,{food:9000,had:true,has_sales:false}) ];
  const sw = baselines.sameWeekdayAvg(mixed, 5);
  ok("C3.11: mixed dataset uses only eligible revenue dates (n=3)", sw.n===3 && approx(sw.avg,14552));
}

// -- supplier-only day emits NONE of the four via the full engine --
{
  const supplierFull = withWar(withAlerts(withWeather(day("2026-07-10",5,0,{food:5000,had:true,has_sales:false}), true, 20), true, 30, 2), "partial");
  const b = engine.buildInsights(supplierFull, priorFridays, NOW);
  const t = b.insights.map(i=>i.type);
  ok("C3.12: supplier-only day emits none of weak_weekday/weather/alert/war_day",
     !t.includes("weak_weekday") && !t.includes("weather_impact") && !t.includes("alert_impact") && !t.includes("war_day_impact"));
}

// -- point 9: insertion order does not change results --
{
  const weakFri = day("2026-07-10",5,8000,{has_sales:true});
  const ordered = [ day("2026-06-19",5,14000,{has_sales:true}), day("2026-06-26",5,14552,{has_sales:true}), day("2026-07-03",5,15104,{has_sales:true}) ];
  const shuffled = [ ordered[2], ordered[0], ordered[1] ];
  const a = engine.buildInsights(weakFri, ordered, NOW).insights.map(i=>i.type).sort();
  const c = engine.buildInsights(weakFri, shuffled, NOW).insights.map(i=>i.type).sort();
  ok("C3.13: insertion order does not change the insight set", JSON.stringify(a)===JSON.stringify(c));
}

// -- point 10: no wall-clock dependency (now only affects timestamps) --
{
  const weakFri = day("2026-07-10",5,8000,{has_sales:true});
  const t1 = engine.buildInsights(weakFri, priorFridays, 1000).insights.map(i=>i.type).sort();
  const t2 = engine.buildInsights(weakFri, priorFridays, 5_000_000_000_000).insights.map(i=>i.type).sort();
  ok("C3.14: result independent of wall-clock (now)", JSON.stringify(t1)===JSON.stringify(t2));
}

console.log("Total: "+(pass+fail)+"  Passed: "+pass+"  Failed: "+fail);
console.log(results.join("\n"));
process.exit(fail>0?1:0);
