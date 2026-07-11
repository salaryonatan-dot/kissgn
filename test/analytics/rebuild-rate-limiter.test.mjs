// Dedicated local test for the analytics-rebuild rate-limiter fallback added to
// api/analytics/daily-builder.ts (fix: analytics rebuild rate limiter fallback).
//
// Self-contained: it stubs every external dependency of daily-builder.ts, compiles
// the TypeScript with the project's own typescript devDependency, imports the
// compiled module, and asserts behaviour. It performs NO network, Firebase,
// email, provider or production calls — every dependency is an in-memory stub.
//
//   Run:  node test/analytics/rebuild-rate-limiter.test.mjs
//   (Requires `npm install` so devDependency `typescript` is present, or set
//    TSC_BIN to a typescript `bin/tsc`.)
import { mkdtempSync, writeFileSync, copyFileSync, mkdirSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, dirname } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { spawnSync } from "node:child_process";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO = join(__dirname, "..", "..");
const SRC = join(REPO, "api", "analytics", "daily-builder.ts");
const TSC = process.env.TSC_BIN || join(REPO, "node_modules", "typescript", "bin", "tsc");
if (!existsSync(TSC)) { console.error("typescript compiler not found at", TSC, "- run `npm install` or set TSC_BIN"); process.exit(2); }

const dir = mkdtempSync(join(tmpdir(), "rl-rebuild-"));
mkdirSync(join(dir, "api", "analytics"), { recursive: true });
mkdirSync(join(dir, "lib", "analytics"), { recursive: true });
mkdirSync(join(dir, "src", "analytics"), { recursive: true });
copyFileSync(SRC, join(dir, "api", "analytics", "daily-builder.ts"));
const w = (p, c) => writeFileSync(join(dir, p), c);
w("lib/verifyToken.js", `export async function requireAuth(req){ return globalThis.__H.requireAuth(req); }`);
w("lib/helpers.js", `export async function requireTenantAccess(u,t,r){ return globalThis.__H.requireTenantAccess(u,t,r); }
export async function isRateLimited(k,l,w){ return globalThis.__H.isRateLimited(k,l,w); }`);
w("lib/adminSdk.js", `export function getAdminDb(){ globalThis.__H.calls.push("getAdminDb"); return globalThis.__H.db(); }`);
w("lib/analytics/sources.js", `export async function fetchBeecommDaily(){ globalThis.__H.calls.push("fetchBeecommDaily"); return {}; }`);
w("src/analytics/dailyBuilder.js", `export async function buildAnalyticsForBiz(t,b,d){ globalThis.__H.calls.push("buildAnalyticsForBiz"); return globalThis.__H.buildAnalyticsForBiz(t,b,d); }
export async function buildAnalyticsForAll(d){ globalThis.__H.calls.push("buildAnalyticsForAll"); return { docs:[], failures:[] }; }
export async function saveAnalyticsDoc(x){ globalThis.__H.calls.push("saveAnalyticsDoc"); }
export async function buildAndSaveInsights(t,b,d,x){ globalThis.__H.calls.push("buildAndSaveInsights"); }
export function yesterdayInIsrael(){ return "2026-07-09"; }`);

const r = spawnSync("node", [TSC, "--module","esnext","--target","es2020","--moduleResolution","bundler","--skipLibCheck","--noEmitOnError","false", join(dir,"api","analytics","daily-builder.ts")], { encoding:"utf8" });
const outJs = join(dir, "api", "analytics", "daily-builder.js");
if (!existsSync(outJs)) { console.error("compile failed:\n", r.stdout, r.stderr); process.exit(2); }

const mod = await import(pathToFileURL(outJs).href);
const handler = mod.default;
const localRL = mod.analyticsRebuildLocalRateLimit;
const resolveRL = mod.resolveAnalyticsRebuildRateLimit;
const resetRL = mod.__resetAnalyticsRebuildLocalRateLimit;

let pass=0, fail=0; const results=[];
const ok=(n,c)=>{ if(c){pass++;results.push("PASS "+n);} else {fail++;results.push("FAIL "+n);} };
const t=async(n,fn)=>{ try{ await fn(); }catch(e){ fail++; results.push("FAIL "+n+" :: "+(e&&e.message||e)); } };
const mkRes=()=>{ const x={statusCode:0,body:null,headers:{}}; x.setHeader=(k,v)=>{x.headers[k]=v;}; x.status=(c)=>{x.statusCode=c;return x;}; x.json=(b)=>{x.body=b;return x;}; x.end=()=>x; return x; };
const baseH=(o={})=>({ requireAuth:async()=>({uid:"u1"}), requireTenantAccess:async()=>"owner", isRateLimited:async()=>false, buildAnalyticsForBiz:async()=>({meta:{builtAt:1}}), calls:[], db:()=>({ ref:(p)=>({ once:async()=>({ val:()=>{ if(p.endsWith("/app/business")) return [{id:"b1",name:"Biz"}]; if(p.endsWith("/app/users")) return [{firebaseUid:"u1",role:"owner",allowedBizIds:["b1"]}]; if(p.includes("insights:daily")) return {tenantId:"t1",bizId:"b1",date:"2026-07-09",engineVersion:"insights-v1",generatedAt:Date.now(),insights:[{a:1}]}; return null; } }) }) }), ...o });
const req=()=>({ method:"POST", headers:{}, query:{}, body:{ action:"rebuild_after_entry_save", tenantId:"t1", bizId:"b1", date:"2026-07-09" } });

await t("fallback: requests 1-8 allowed, 9 rejected", async()=>{ resetRL(); const now=1e6,k="key"; for(let i=1;i<=8;i++) ok("req"+i, localRL(k,8,60000,now)===false); ok("req9 rejected", localRL(k,8,60000,now)===true); });
await t("fallback: window expiry resets", async()=>{ resetRL(); const k="k2"; for(let i=0;i<8;i++) localRL(k,8,60000,1e6); ok("limited in-window", localRL(k,8,60000,1e6)===true); ok("allowed after window", localRL(k,8,60000,1e6+60001)===false); });
await t("fallback: stale entries pruned/bounded", async()=>{ resetRL(); localRL("old",8,60000,1e6); localRL("new",8,60000,1e6+120000); let a=0; for(let i=0;i<8;i++) if(localRL("old",8,60000,1e6+120000)===false) a++; ok("stale key reusable", a===8); });
await t("resolve: remote false -> allow", async()=>{ resetRL(); ok("", await resolveRL(()=>false,"k",8,60000)==="allow"); });
await t("resolve: remote true -> limited (no fallback)", async()=>{ resetRL(); ok("", await resolveRL(()=>true,"k",8,60000)==="limited"); });
await t("resolve: remote null -> fallback allow", async()=>{ resetRL(); ok("", await resolveRL(()=>null,"k",8,60000,5)==="allow"); });
await t("resolve: remote throws -> fallback allow", async()=>{ resetRL(); ok("", await resolveRL(()=>{throw new Error("down")},"k",8,60000,5)==="allow"); });
await t("resolve: fallback still limits at 9", async()=>{ resetRL(); let last; for(let i=1;i<=9;i++) last=await resolveRL(()=>null,"k9",8,60000,7); ok("", last==="limited"); });
await t("handler: auth failure -> 401 before limiter", async()=>{ globalThis.__H=baseH({requireAuth:async()=>{throw new Error("x")}, isRateLimited:async()=>{globalThis.__H.calls.push("isRateLimited");return false;}}); const res=mkRes(); await handler(req(),res); ok("401",res.statusCode===401); ok("limiter skipped",!globalThis.__H.calls.includes("isRateLimited")); });
await t("handler: RBAC failure -> 403 before limiter", async()=>{ globalThis.__H=baseH({requireTenantAccess:async()=>{throw {status:403,msg:"role"}}, isRateLimited:async()=>{globalThis.__H.calls.push("isRateLimited");return false;}}); const res=mkRes(); await handler(req(),res); ok("403",res.statusCode===403); ok("limiter skipped",!globalThis.__H.calls.includes("isRateLimited")); });
await t("handler: invalid input -> 400", async()=>{ globalThis.__H=baseH(); const q=req(); q.body.tenantId="bad!!"; const res=mkRes(); await handler(q,res); ok("400",res.statusCode===400); });
await t("handler: remote false -> 200 builder ran", async()=>{ globalThis.__H=baseH({isRateLimited:async()=>false}); const res=mkRes(); await handler(req(),res); ok("200",res.statusCode===200); ok("built",globalThis.__H.calls.includes("buildAnalyticsForBiz")); });
await t("handler: remote true -> 429 builder not run", async()=>{ globalThis.__H=baseH({isRateLimited:async()=>true}); const res=mkRes(); await handler(req(),res); ok("429",res.statusCode===429); ok("no build",!globalThis.__H.calls.includes("buildAnalyticsForBiz")); });
await t("handler: limiter throws -> fallback -> 200 (no 503)", async()=>{ resetRL(); globalThis.__H=baseH({isRateLimited:async()=>{throw new Error("rate limiter unavailable")}}); const res=mkRes(); await handler(req(),res); ok("200 not 503",res.statusCode===200); ok("built via fallback",globalThis.__H.calls.includes("buildAnalyticsForBiz")); });
await t("handler: builder error not swallowed -> 500 rebuild_failed", async()=>{ globalThis.__H=baseH({isRateLimited:async()=>false, buildAnalyticsForBiz:async()=>{throw new Error("boom")}}); const res=mkRes(); await handler(req(),res); ok("500",res.statusCode===500); ok("rebuild_failed",res.body&&res.body.error==="rebuild_failed"); });
await t("handler: cron GET path unchanged", async()=>{ globalThis.__H=baseH(); const res=mkRes(); await handler({method:"GET",headers:{"x-vercel-cron":"1"},query:{},body:{}},res); ok("cron all ran",globalThis.__H.calls.includes("buildAnalyticsForAll")); ok("rebuild not entered",!globalThis.__H.calls.includes("buildAnalyticsForBiz")); });
await t("handler: no forbidden side-effect calls", async()=>{ const bad=(globalThis.__H.calls||[]).filter(c=>/email|sendMail|createUser|delete|provider|azure|ocr/i.test(c)); ok("clean",bad.length===0); });

console.log("Total: "+(pass+fail)+"  Passed: "+pass+"  Failed: "+fail);
console.log(results.join("\n"));
process.exit(fail>0?1:0);
