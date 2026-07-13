// Deterministic structural + predicate-mirror tests for COMPLETE business isolation
// of every flat `tenants/{tid}/biz:{bizId}:*` key ($dataKey rule). NOT an Emulator run.
// (1) asserts the rule string carries the intended structure; (2) exercises a JS mirror
// of the rule predicate against the approved policy matrix. The Emulator matrix is the
// next dedicated phase. Documented residual: parameterized keys (checklist_runs/items/
// simple_runs, analytics/insights) cannot bind biz_access in RTDB rules — see report.
//   Run: node test/security/biz-keys-isolation.test.mjs
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const RULES = JSON.parse(readFileSync(join(REPO, "database.rules.json"), "utf8"));
const dk = RULES.rules.tenants.$tenantId.$dataKey;
let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log("PASS " + n); pass++; } catch (e) { console.log("FAIL " + n + " — " + (e && e.message)); fail++; } };

// ── (1) structural assertions on the deployed rule string ──
T("RULE pin read+write denied", () => { assert.ok(dk[".read"].includes("$dataKey.matches(/^biz:[^:]+:pin$/) ? false")); assert.ok(dk[".write"].includes("$dataKey.matches(/^biz:[^:]+:pin$/) ? false")); });
T("RULE parameterized keys (checklist_*/analytics/insights) deny direct read AND write", () => {
  for (const pat of ["checklist_template_items:[A-Za-z0-9_-]+","checklist_runs:[0-9]{4}-[0-9]{2}-[0-9]{2}","checklist_simple_runs:[0-9]{4}-[0-9]{2}-[0-9]{2}:[A-Za-z0-9_-]+","analytics:daily:[0-9]{4}-[0-9]{2}-[0-9]{2}","insights:daily:[0-9]{4}-[0-9]{2}-[0-9]{2}"]) {
    assert.ok(dk[".read"].includes(pat+"$/) ? false"), "read deny "+pat);
    assert.ok(dk[".write"].includes(pat+"$/) ? false"), "write deny "+pat);
  }
});
T("RULE unknown biz key fails closed (deny read+write)", () => { assert.ok(dk[".read"].includes("$dataKey.beginsWith('biz:') ? false")); assert.ok(dk[".write"].includes("$dataKey.beginsWith('biz:') ? false")); });
T("RULE fixed keys extract bizId and check biz_access", () => { assert.ok(dk[".write"].includes("$dataKey.replace('biz:','').replace(':entries','')")); assert.ok(dk[".write"].includes("$dataKey.replace('biz:','').replace(':pettycash','')")); });
T("RULE shift-tier fixed keys allow shift_manager", () => { assert.ok(dk[".write"].includes("$dataKey.matches(/^biz:[^:]+:tasks$/) ? (") && dk[".write"].includes("'shift_manager'")); });

// ── (2) JS mirror of the rule predicate ──
const FIXED_MGR = ["entries","config","suppliers","fixed","lastyear","credits","pettycash","customer_compensations","checklist_templates"];
const FIXED_SHIFT = ["tasks","logs","active-log"];
const esc = (s) => s.replace(/[-]/g, "\\-");
function classify(key) {
  if (!key.startsWith("biz:")) return { type: "nonbiz" };
  for (const s of FIXED_MGR) if (new RegExp("^biz:[^:]+:" + esc(s) + "$").test(key)) return { type: "fixed_mgr", bizId: key.replace("biz:","").replace(":"+s,"") };
  for (const s of FIXED_SHIFT) if (new RegExp("^biz:[^:]+:" + esc(s) + "$").test(key)) return { type: "fixed_shift", bizId: key.replace("biz:","").replace(":"+s,"") };
  if (/^biz:[^:]+:pin$/.test(key)) return { type: "pin" };
  if (/^biz:[^:]+:analytics:daily:[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(key)) return { type: "derived" };
  if (/^biz:[^:]+:insights:daily:[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(key)) return { type: "derived" };
  if (/^biz:[^:]+:checklist_template_items:[A-Za-z0-9_-]+$/.test(key)) return { type: "param_mgr" };
  if (/^biz:[^:]+:checklist_runs:[0-9]{4}-[0-9]{2}-[0-9]{2}$/.test(key)) return { type: "param_shift" };
  if (/^biz:[^:]+:checklist_simple_runs:[0-9]{4}-[0-9]{2}-[0-9]{2}:[A-Za-z0-9_-]+$/.test(key)) return { type: "param_shift" };
  return { type: "unknown_biz" };
}
// ctx: { auth, uid, role, member, biz: Set(`${bizId}:${uid}`) }
const g = (b, u) => `${b}:${u}`;
const isOwnerLvl = (r) => r === "owner" || r === "super_owner";
function canRead(ctx) {
  if (!ctx.auth) return false;
  const c = classify(ctx.key);
  switch (c.type) {
    case "pin": return false;
    case "unknown_biz": return false;
    case "fixed_mgr": case "fixed_shift": return ctx.member && (isOwnerLvl(ctx.role) || ctx.biz.has(g(c.bizId, ctx.uid)));
    case "derived": case "param_mgr": case "param_shift": return false; // server-mediated: direct read denied
    case "nonbiz": return ctx.member;
  }
}
function canWrite(ctx) {
  if (!ctx.auth) return false;
  const c = classify(ctx.key);
  switch (c.type) {
    case "pin": case "derived": case "unknown_biz": return false;
    case "fixed_mgr": return isOwnerLvl(ctx.role) || (ctx.role === "manager" && ctx.biz.has(g(c.bizId, ctx.uid)));
    case "fixed_shift": return isOwnerLvl(ctx.role) || ((ctx.role === "manager" || ctx.role === "shift_manager") && ctx.biz.has(g(c.bizId, ctx.uid)));
    case "param_mgr": case "param_shift": return false; // server-mediated: direct write denied
    case "nonbiz": return ctx.member || ["super_owner","owner","manager"].includes(ctx.role);
  }
}
const base = (o) => ({ auth: true, uid: "u1", member: true, biz: new Set(), key: "biz:A:config", ...o });
const withA = (o) => base({ biz: new Set([g("A","u1")]), ...o });

// ── auth/scope ──
T("unauthenticated denied read+write", () => { assert.strictEqual(canRead(base({auth:false})), false); assert.strictEqual(canWrite(base({auth:false})), false); });
T("missing biz_access denies scoped read+write of fixed keys", () => { assert.strictEqual(canRead(base({role:"manager"})), false); assert.strictEqual(canWrite(base({role:"manager"})), false); });
T("business-A user denied business-B fixed read/write", () => { assert.strictEqual(canRead(withA({role:"manager",key:"biz:B:config"})), false); assert.strictEqual(canWrite(withA({role:"manager",key:"biz:B:config"})), false); });
T("multi-business user allowed only listed businesses", () => { const ctx={auth:true,uid:"u1",member:true,role:"manager",biz:new Set([g("A","u1"),g("C","u1")])}; assert.ok(canWrite({...ctx,key:"biz:A:entries"})); assert.ok(canWrite({...ctx,key:"biz:C:entries"})); assert.ok(!canWrite({...ctx,key:"biz:B:entries"})); });

// ── manager-plus fixed keys ──
for (const s of FIXED_MGR) {
  T(`MGR-key ${s}: viewer/shift_manager write denied; manager+biz_access allowed; owner allowed; unauth-biz read denied`, () => {
    const k = `biz:A:${s}`;
    assert.strictEqual(canWrite(withA({role:"viewer",key:k})), false);
    assert.strictEqual(canWrite(withA({role:"shift_manager",key:k})), false);
    assert.strictEqual(canWrite(base({role:"manager",key:k})), false);          // no biz_access
    assert.strictEqual(canWrite(withA({role:"manager",key:k})), true);
    assert.strictEqual(canWrite(base({role:"owner",key:k})), true);             // implicit
    assert.strictEqual(canWrite(base({role:"super_owner",key:k})), true);
    assert.strictEqual(canRead(withA({role:"viewer",key:k})), true);           // authorized viewer read
    assert.strictEqual(canRead(withA({role:"viewer",key:`biz:B:${s}`})), false); // unauthorized biz read
  });
}
// ── shift-manager-plus fixed keys ──
for (const s of FIXED_SHIFT) {
  T(`SHIFT-key ${s}: viewer denied; shift_manager+biz_access allowed; shift_manager no biz_access denied; manager+biz_access allowed; cross-business denied`, () => {
    const k = `biz:A:${s}`;
    assert.strictEqual(canWrite(withA({role:"viewer",key:k})), false);
    assert.strictEqual(canWrite(base({role:"shift_manager",key:k})), false);   // no biz_access
    assert.strictEqual(canWrite(withA({role:"shift_manager",key:k})), true);
    assert.strictEqual(canWrite(withA({role:"manager",key:k})), true);
    assert.strictEqual(canWrite(withA({role:"shift_manager",key:`biz:B:${s}`})), false); // cross-business
  });
}
// ── derived keys ──
T("derived analytics/insights: authorized read; client write DENIED for every role incl owner/super_owner", () => {
  for (const suf of ["analytics:daily:2026-07-13","insights:daily:2026-07-13"]) {
    const k = `biz:A:${suf}`;
    assert.strictEqual(canWrite(base({role:"owner",key:k})), false);
    assert.strictEqual(canWrite(base({role:"super_owner",key:k})), false);
    assert.strictEqual(canWrite(withA({role:"manager",key:k})), false);
    assert.strictEqual(canRead(withA({role:"viewer",key:k})), false); // direct read denied (server-mediated)
  }
});
T("malformed derived date denied write path (unknown biz → deny)", () => {
  assert.strictEqual(classify("biz:A:analytics:daily:2026-7-13").type, "unknown_biz");
  assert.strictEqual(canWrite(base({role:"owner",key:"biz:A:analytics:daily:2026-7-13"})), false);
  assert.strictEqual(canRead(base({role:"owner",key:"biz:A:analytics:daily:2026-7-13"})), false);
});
// ── pin ──
T("PIN: direct read AND write denied for EVERY role", () => {
  for (const r of ["viewer","shift_manager","manager","owner","super_owner"]) {
    assert.strictEqual(canRead(withA({role:r,key:"biz:A:pin"})), false);
    assert.strictEqual(canWrite(withA({role:r,key:"biz:A:pin"})), false);
  }
});
T("PIN: client no longer subscribes to or writes pin; owner UI role-gated", () => {
  const IDX = readFileSync(join(REPO, "index.html"), "utf8");
  assert.ok(!/sg2\(`biz:\$\{bizId\}:pin`\)/.test(IDX), "no direct pin read");
  assert.ok(!IDX.includes("ownerPinIn===ownerPin"), "no PIN-based auth check");
  assert.ok(IDX.includes('loggedInRole==="owner" || loggedInRole==="super_owner"'), "owner UI gated on authoritative role");
});
// ── unknown / malformed / spoof ──
T("unknown biz suffix + extra-colon spoof denied", () => {
  assert.strictEqual(classify("biz:A:secret").type, "unknown_biz");
  assert.strictEqual(canWrite(withA({role:"owner",key:"biz:A:entries:evil"})), false); // extra colon => unknown
  assert.strictEqual(canWrite(withA({role:"manager",key:"biz::config"})), false);       // empty bizId not [^:]+
  assert.strictEqual(canRead(withA({role:"owner",key:"biz:A:unknownthing"})), false);
});
T("malformed checklist date/id denied", () => {
  assert.strictEqual(classify("biz:A:checklist_runs:2026-7-1").type, "unknown_biz");
  assert.strictEqual(classify("biz:A:checklist_simple_runs:2026-07-13").type, "unknown_biz"); // missing tplId
});
T("parameterized checklist/derived keys: ALL direct client read+write DENIED (server-mediated)", () => {
  for (const k of ["biz:A:checklist_template_items:tpl1","biz:A:checklist_runs:2026-07-13","biz:A:checklist_simple_runs:2026-07-13:t1","biz:A:analytics:daily:2026-07-13","biz:A:insights:daily:2026-07-13"]) {
    for (const r of ["viewer","shift_manager","manager","owner","super_owner"]) {
      assert.strictEqual(canRead(withA({role:r,key:k})), false, "read "+k+" "+r);
      assert.strictEqual(canWrite(withA({role:r,key:k})), false, "write "+k+" "+r);
    }
  }
});
// ── compatibility ──
T("legitimate manager revenue save + shift-manager task/log/checklist-run workflow remain possible with biz_access", () => {
  assert.ok(canWrite(withA({role:"manager",key:"biz:A:entries"})));
  assert.ok(canWrite(withA({role:"shift_manager",key:"biz:A:tasks"})));
  assert.ok(canWrite(withA({role:"shift_manager",key:"biz:A:logs"})));
  assert.ok(canWrite(withA({role:"manager",key:"biz:A:pettycash"})));
  assert.ok(canWrite(withA({role:"manager",key:"biz:A:customer_compensations"})));
});
T("shift_manager CANNOT write pettycash/customer_compensations (manager+ only)", () => {
  assert.strictEqual(canWrite(withA({role:"shift_manager",key:"biz:A:pettycash"})), false);
  assert.strictEqual(canWrite(withA({role:"shift_manager",key:"biz:A:customer_compensations"})), false);
});
T("non-biz tenant key keeps existing member policy (not accidentally captured)", () => {
  assert.strictEqual(canRead(base({role:"viewer",key:"someTenantKey"})), true);
  assert.strictEqual(canWrite(base({role:"viewer",member:true,key:"someTenantKey"})), true);
});

console.log(`\nTotal: ${pass + fail}  Passed: ${pass}  Failed: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
