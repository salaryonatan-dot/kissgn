// PROPOSED lane BF-GATE on Agent/Daily integration I7 — the operator biz_access backfill bound to the authoritative registry
// (independent I6 review I6-R-03 / R6-6; T-BF-GATE, PROPOSED for the P1 / user-access / operations owners and the S0 / VAT guard owners). Pure plan + the REAL runBackfill apply flow over an in-memory
// Admin-SDK-shaped database (the real-transport run is test/emulator/backfill-registry-gate-emulator.mjs BFE-01). Nothing hosted is contacted.
//   BF-01  a grant is planned only when the tenant's RAW registry node classifies the exact business `registered` (the runtime rule);
//          absent / bare-array / bare-string / malformed / ambiguous / unregistered targets are REFUSED (listed, never written); owners
//          stay skipped; the digest is order-independent and changes with every planned or refused path; cleanup semantics unchanged
//   BF-02  the apply gate: any refused target, a missing digest or a digest other than the approved one refuses
//   BF-03  runBackfill: dry-run writes nothing and prints the digest; --apply with a refused target, without / with a foreign digest,
//          a refused target at the apply-time read (even if a later read matches again), or drift between approval and the fresh read
//          immediately before the write → exit 5, nothing written; the approved
//          plan writes exactly its grants
//   BF-07..BF-10 (BF2, independent BF1 review BF1-R-02): committed behavioural rows for four claimed semantics that BF1's rows did not
//          protect — roles precedence, a malformed user element, a non-array scope, malformed tenants in the digest
//   NOTE: BF-05 drives runBackfill (the flow main() calls after initialization), not the process entry. The real-process CLI evidence
//          (main() → firebase-admin → project verification) is test/emulator/backfill-registry-cli-emulator.mjs BFC-00..06.
import { test } from "node:test";
import assert from "node:assert/strict";
import { planBackfill, planTenantBackfill, planDigest, applyGate, reconcile, runBackfill, parseArgs } from "../../scripts/backfill-biz-access.mjs";
import { classifyRegistryTarget } from "../../lib/businessRegistry.js";

const env = (v) => ({ _v: JSON.stringify(v) });
const USERS = env([{ firebaseUid: "uMgr", role: "manager", allowedBizIds: ["bizA", "bizB"] }, { firebaseUid: "uView", role: "viewer", allowedBizIds: ["bizA"] }, { firebaseUid: "uOwn", role: "owner", allowedBizIds: ["bizA"] }]);
const ROLES = { uMgr: "manager", uView: "viewer", uOwn: "owner" };
const tenant = (business) => ({ roles: ROLES, app: { users: USERS, ...(business === undefined ? {} : { business }) } });
const REGS = [
  ["registered", env([{ id: "bizA" }, { id: "bizB" }]), { bizA: "registered", bizB: "registered" }],
  ["absent", undefined, { bizA: "unreadable", bizB: "unreadable" }],
  ["null", null, { bizA: "unreadable", bizB: "unreadable" }],
  ["bare array", [{ id: "bizA" }, { id: "bizB" }], { bizA: "unreadable", bizB: "unreadable" }],
  ["bare JSON string", JSON.stringify([{ id: "bizA" }, { id: "bizB" }]), { bizA: "unreadable", bizB: "unreadable" }],
  ["malformed JSON", { _v: "[{" }, { bizA: "unreadable", bizB: "unreadable" }],
  ["twin", env([{ id: "bizA" }, { id: " bizA " }, { id: "bizB" }]), { bizA: "ambiguous", bizB: "registered" }],
  ["duplicate", env([{ id: "bizA" }, { id: "bizA" }, { id: "bizB" }]), { bizA: "ambiguous", bizB: "registered" }],
  ["coerced twin", env([{ id: "bizA" }, "bizA", { id: "bizB" }]), { bizA: "ambiguous", bizB: "registered" }],
  ["unregistered", env([{ id: "bizB" }]), { bizA: "not_registered", bizB: "registered" }],
  ["non-array JSON", { _v: "{}" }, { bizA: "unreadable", bizB: "unreadable" }],
  ["non-string envelope", { _v: 7 }, { bizA: "unreadable", bizB: "unreadable" }],
  ["unrelated defects", env([{ id: "bizA" }, { id: "bizB" }, null, { id: "other" }, { id: "other" }, ["bizA"]]), { bizA: "registered", bizB: "registered" }],
];

test("BF-01 a grant is planned exactly when the runtime rule registers the target; every other target is refused, never written", () => {
  for (const [label, raw, states] of REGS) {
    const p = planTenantBackfill("t1", USERS, ROLES, raw);
    const want = [["bizA", "uMgr"], ["bizB", "uMgr"], ["bizA", "uView"]];
    for (const [b, u] of want) {
      const path = `tenants/t1/biz_access/${b}/${u}`;
      assert.equal(states[b], classifyRegistryTarget(raw, b).state, label + ": fixture = runtime");
      assert.equal(p.updates[path] === true, states[b] === "registered", `${label}: ${path} planned ⇔ registered`);
      assert.equal(p.refused.some((r) => r.path === path && r.state === states[b]), states[b] !== "registered", `${label}: ${path} refused with its state`);
    }
    assert.ok(!Object.keys(p.updates).some((k) => k.endsWith("/uOwn")) && !p.refused.some((r) => r.path.endsWith("/uOwn")), label + ": owners skipped");
  }
  // aggregate: the summary counts refusals by state; the digest is independent of tenant / user order and moves with any path
  const a = planBackfill({ t1: tenant(REGS[0][1]), t2: tenant(REGS[6][1]) }), b = planBackfill({ t2: tenant(REGS[6][1]), t1: tenant(REGS[0][1]) });
  assert.equal(planDigest(a), planDigest(b), "order-independent digest");
  assert.deepEqual([a.summary.accessEntriesProposed, a.summary.accessEntriesRefused, a.summary.refusedByState], [4, 2, { ambiguous: 2 }]);
  const c = planBackfill({ t1: tenant(REGS[0][1]), t2: tenant(REGS[9][1]) });
  assert.notEqual(planDigest(a), planDigest(c), "a different refusal changes the digest");
  // cleanup semantics unchanged: a grant to a refused business is derived (not unexpected); a grant nobody derives is unexpected
  const data = { t2: { ...tenant(REGS[6][1]), biz_access: { bizA: { uMgr: true }, bizZ: { uMgr: true } } } };
  const plan = planBackfill(data);
  assert.deepEqual(reconcile(plan.updates, data, plan.refused).unexpected, ["tenants/t2/biz_access/bizZ/uMgr"]);
  assert.deepEqual(reconcile(plan.updates, data, plan.refused).missing.sort(), ["tenants/t2/biz_access/bizB/uMgr"], "missing counts only registered targets");
});

test("BF-02 the apply gate fails closed: any refused target, a missing digest, a digest other than the approved one", () => {
  const ok = planBackfill({ t1: tenant(REGS[0][1]) }), bad = planBackfill({ t1: tenant(REGS[6][1]) });
  assert.equal(applyGate(ok, { expectPlan: planDigest(ok) }).allowed, true);
  assert.match(applyGate(bad, { expectPlan: planDigest(bad) }).reason, /authoritative registry does not register \(refused: ambiguous\)/);
  assert.equal(applyGate(bad, { expectPlan: planDigest(bad) }).allowed, false, "a refused target refuses even with its own digest");
  assert.equal(applyGate(ok, { expectPlan: null }).allowed, false); assert.match(applyGate(ok, {}).reason, /missing --expect-plan/);
  assert.match(applyGate(ok, { expectPlan: "0".repeat(64) }).reason, /plan drift/);
  assert.equal(parseArgs(["--expect-plan=abc"]).expectPlan, "abc");
});

/** An in-memory Admin-SDK-shaped db: ref(path).once / ref().update; `onRead(n)` may mutate the data before the n-th tenants read. */
export function memDb(data, onRead = () => {}) {
  let state = JSON.parse(JSON.stringify(data)), reads = 0; const writes = [];
  const refs = [];
  const get = (p) => p.split("/").filter(Boolean).reduce((v, k) => (v == null ? undefined : v[k]), state);
  return { writes, refs, state: () => state, mutate: (fn) => { fn(state); },
    ref: (p) => { refs.push(p); return { once: async () => { if (p === "tenants") onRead(++reads, state); const v = get(p); return { val: () => (v === undefined ? null : JSON.parse(JSON.stringify(v))) }; },
      on: (_event, ok, error) => { try { onRead(++reads, state); ok({ val: () => get(p) }); } catch (e) { error(e); } return ok; },
      off: () => {},
      transaction: async (fn) => { const next = fn(structuredClone(get(p))); if (next === undefined) return { committed: false }; writes.push({ [p]: next }); state[p] = next; return { committed: true }; },
      update: async (o) => { writes.push(o); for (const [k, v] of Object.entries(o)) { const ks = k.split("/"); let n = state; for (const x of ks.slice(0, -1)) n = n[x] ??= {}; if (v === null) delete n[ks.at(-1)]; else n[ks.at(-1)] = v; } } };
    } };
}
const A = (extra = []) => parseArgs(["--env=e", "--project=p", ...extra]);

test("BF-03 runBackfill: dry-run writes nothing; --apply refuses a refused target, a missing / foreign digest and drift; the approved plan writes exactly its grants", async () => {
  const silent = () => {};
  // dry-run prints the digest, writes nothing
  const good = { tenants: { t1: tenant(REGS[0][1]) } }, plan = planBackfill(good.tenants), digest = planDigest(plan);
  let db = memDb(good); const logs = [];
  assert.equal(await runBackfill(db, A(), "p", (l) => logs.push(l)), 0); assert.deepEqual(db.writes, []); assert.ok(logs.some((l) => l.includes(digest)), "the digest is printed");
  // refused target → 5, nothing written (even with its own digest)
  const badData = { tenants: { t1: tenant(REGS[0][1]), t2: tenant(REGS[9][1]) } }; const badDigest = planDigest(planBackfill(badData.tenants));
  db = memDb(badData); assert.equal(await runBackfill(db, A(["--apply", "--confirm-production=p", `--expect-plan=${badDigest}`]), "p", silent), 5); assert.deepEqual(db.writes, []);
  // missing / foreign digest → 5, nothing written
  db = memDb(good); assert.equal(await runBackfill(db, A(["--apply", "--confirm-production=p"]), "p", silent), 5); assert.deepEqual(db.writes, []);
  db = memDb(good); assert.equal(await runBackfill(db, A(["--apply", "--confirm-production=p", "--expect-plan=" + "f".repeat(64)]), "p", silent), 5); assert.deepEqual(db.writes, []);
  // drift: the registry becomes ambiguous between the first read and the fresh read right before the write → 5, nothing written
  db = memDb(good, (n, st) => { if (n === 2) st.tenants.t1.app.business = env([{ id: "bizA" }, { id: " bizA " }, { id: "bizB" }]); });
  assert.equal(await runBackfill(db, A(["--apply", "--confirm-production=p", `--expect-plan=${digest}`]), "p", silent), 5); assert.deepEqual(db.writes, []);
  // the apply-time read is itself gated: a registry that does not register a target at that read refuses, even when a later read
  // would match the approved digest again (a flapping registry is never written from) → 5, first-gate message, nothing written
  db = memDb(good, (n, st) => { if (n === 1) st.tenants.t1.app.business = env([{ id: "bizA" }, { id: " bizA " }, { id: "bizB" }]); if (n === 2) st.tenants.t1.app.business = REGS[0][1]; });
  const flap = [];
  assert.equal(await runBackfill(db, A(["--apply", "--confirm-production=p", `--expect-plan=${digest}`]), "p", (l) => flap.push(l)), 5); assert.deepEqual(db.writes, []);
  assert.ok(flap.some((l) => l.startsWith("APPLY REFUSED — ") && l.includes("refused: ambiguous")), "refused at the apply-time read, before any re-read");
  // the approved plan writes exactly its grants, once
  db = memDb(good); assert.equal(await runBackfill(db, A(["--apply", "--confirm-production=p", `--expect-plan=${digest}`]), "p", silent), 0);
  assert.equal(db.writes.length, 1);
  assert.deepEqual(db.state().tenants.t1.biz_access, { bizA: { uMgr: true, uView: true }, bizB: { uMgr: true } });
  assert.deepEqual(db.state().tenants.t1.app, good.tenants.t1.app, "source records preserved");
  assert.deepEqual(Object.keys(plan.updates).sort(), ["tenants/t1/biz_access/bizA/uMgr", "tenants/t1/biz_access/bizA/uView", "tenants/t1/biz_access/bizB/uMgr"]);
  // --apply without --confirm-production stays a dry-run (unchanged guard)
  db = memDb(good); assert.equal(await runBackfill(db, A(["--apply", `--expect-plan=${digest}`]), "p", silent), 0); assert.deepEqual(db.writes, []);
});

test("BF-04 exact identity: tenant colon is valid, business colon/control/alias inputs refuse; malformed users cannot allow a partial apply", async () => {
  for (const id of [null, undefined, 7, {}, [], "", "t/x", "t\u0000", "t\u007f", "t".repeat(129)])
    assert.throws(() => planTenantBackfill(id, USERS, ROLES, REGS[0][1]), /invalid tenantId/);
  for (const bad of ["biz:A", "biz/A", "biz\u0000", "biz\u001f", "biz\u007f", "x".repeat(129), 7, null, {}, ["bizA"]]) {
    const data = { tenants: { "tenant:A": { app: { users: env([{ firebaseUid: "u1", role: "viewer", allowedBizIds: ["bizA", bad] }]), business: REGS[0][1] } } } };
    const p = planBackfill(data.tenants);
    assert.deepEqual(p.updates, {}, "invalid scope is never partially granted");
    const db = memDb(data);
    assert.equal(await runBackfill(db, A(["--apply", "--confirm-production=p", `--expect-plan=${planDigest(p)}`]), "p", () => {}), 5);
    assert.deepEqual(db.writes, []);
  }
  for (const uid of ["u/x", "u\n", "u\u007f", 1, null, {}, [], "u".repeat(129)]) {
    const p = planTenantBackfill("t", env([{ firebaseUid: uid, role: "viewer", allowedBizIds: ["bizA"] }]), {}, REGS[0][1]);
    assert.deepEqual(p.updates, {}); assert.equal(p.refused[0].reason, "uid");
  }
  const p = planTenantBackfill("tenant:A", env([{ firebaseUid: "u:A", role: "viewer", allowedBizIds: [" bizA ", " bizA ", ""] }]), {}, env([{ id: " bizA " }]));
  assert.deepEqual(p.updates, { "tenants/tenant:A/biz_access/ bizA /u:A": true });
  assert.equal(planTenantBackfill("t", env([{ firebaseUid: "u", allowedBizIds: ["7"] }]), {}, env([{ id: "7" }, { id: 7 }])).refused[0].state, "ambiguous");
});

test("BF-05 actual entry path: project/read failures and malformed snapshots fail closed; refusal never reaches a business document or a write", async () => {
  const good = { tenants: { t1: tenant(REGS[0][1]) } };
  let db = memDb(good);
  assert.equal(await runBackfill(db, A(), "other", () => {}), 4); assert.deepEqual(db.refs, []);
  for (const at of [1, 2]) {
    db = memDb(good, (n) => { if (n === at) throw new Error("registry snapshot unavailable"); });
    const digest = planDigest(planBackfill(good.tenants));
    await assert.rejects(runBackfill(db, A(["--apply", "--confirm-production=p", `--expect-plan=${digest}`]), "p", () => {}), /snapshot unavailable/);
    assert.deepEqual(db.writes, []); assert.ok(db.refs.every((p) => p === "tenants"));
  }
  const malformed = { tenants: { t1: tenant(REGS[0][1]), broken: { app: { users: { _v: "{" } } } } };
  db = memDb(malformed);
  const plan = planBackfill(malformed.tenants, { stopOnMalformed: false });
  assert.equal(await runBackfill(db, A(["--allow-malformed", "--apply", "--confirm-production=p", `--expect-plan=${planDigest(plan)}`]), "p", () => {}), 5);
  assert.deepEqual(db.writes, []);
  for (const [, reg] of REGS.slice(1).filter(([, , states]) => Object.values(states).some((s) => s !== "registered"))) {
    db = memDb({ tenants: { t1: tenant(reg) } });
    assert.equal(await runBackfill(db, A(["--apply", "--confirm-production=p", "--expect-plan=" + "0".repeat(64)]), "p", () => {}), 5);
    assert.deepEqual(db.writes, []); assert.deepEqual(db.refs, ["tenants"], "refusal stops at the existing operator snapshot, no business-data reference");
  }
});

test("BF-06 commit output preserves all unrelated values and exact prototype-like ids", async () => {
  const data = { tenants: { "tenant:A": { app: { users: env([{ firebaseUid: "__proto__", role: "viewer", allowedBizIds: ["constructor"] }]), business: env([{ id: "constructor" }]), "biz:constructor:entries": { _v: "sentinel" } }, biz_access: { keep: { keep: true } }, unrelated: { value: 42 } } } };
  const db = memDb(data), plan = planBackfill(data.tenants);
  assert.equal(await runBackfill(db, A(["--apply", "--confirm-production=p", `--expect-plan=${planDigest(plan)}`]), "p", () => {}), 0);
  const after = db.state();
  assert.equal(Object.hasOwn(after.tenants["tenant:A"].biz_access.constructor, "__proto__"), true);
  assert.equal(after.tenants["tenant:A"].biz_access.constructor.__proto__, true);
  assert.equal(Object.prototype.__proto__, null, "no prototype mutation");
  delete after.tenants["tenant:A"].biz_access.constructor;
  assert.deepEqual(after, data, "all other data byte-for-byte equivalent in the state model");
  assert.ok(db.refs.every((p) => p === "tenants"));
});

// ── BF2 (BF1-R-02): each row below fails on the corresponding review mutant (RM-04 / RM-05 / RM-07 / RM-03) ──────────────────────

test("BF-07 roles precedence: a string tenant role decides over the record's role, in both directions; a non-string role falls back", async () => {
  const users = env([{ firebaseUid: "uA", role: "viewer", allowedBizIds: ["bizA"] }, { firebaseUid: "uB", role: "owner", allowedBizIds: ["bizA"] }, { firebaseUid: "uC", role: "viewer", allowedBizIds: ["bizA"] }]);
  const roles = { uA: "owner", uB: "viewer", uC: { role: "owner" } };
  const p = planTenantBackfill("t1", users, roles, REGS[0][1]);
  assert.deepEqual(Object.keys(p.updates).sort(), ["tenants/t1/biz_access/bizA/uB", "tenants/t1/biz_access/bizA/uC"], "roles[uA]=owner skips uA; roles[uB]=viewer grants uB; a non-string roles[uC] falls back to the record");
  assert.equal(p.skipped, 1); assert.deepEqual(p.refused, []);
  // through runBackfill: exactly those grants are written
  const data = { tenants: { t1: { roles, app: { users, business: REGS[0][1] } } } };
  const db = memDb(data);
  assert.equal(await runBackfill(db, A(["--apply", "--confirm-production=p", `--expect-plan=${planDigest(planBackfill(data.tenants))}`]), "p", () => {}), 0);
  assert.deepEqual(db.state().tenants.t1.biz_access, { bizA: { uB: true, uC: true } });
});

test("BF-08 a malformed user element (null / array / number / string) is refused as user_shape and blocks the whole apply", async () => {
  for (const bad of [null, ["uX"], 7, "uX"]) {
    const users = env([{ firebaseUid: "uMgr", role: "manager", allowedBizIds: ["bizA"] }, bad]);
    const p = planTenantBackfill("t1", users, {}, REGS[0][1]);
    assert.deepEqual(p.refused, [{ state: "invalid_request", reason: "user_shape" }], JSON.stringify(bad) + ": refused, never skipped silently");
    assert.equal(p.malformedUsers, 1);
    const data = { tenants: { t1: { app: { users, business: REGS[0][1] } } } };
    const plan = planBackfill(data.tenants);
    assert.equal(plan.summary.refusedByState.invalid_request, 1);
    assert.equal(applyGate(plan, { expectPlan: planDigest(plan) }).allowed, false, JSON.stringify(bad) + ": the gate refuses");
    const db = memDb(data);
    assert.equal(await runBackfill(db, A(["--apply", "--confirm-production=p", `--expect-plan=${planDigest(plan)}`]), "p", () => {}), 5);
    assert.deepEqual(db.writes, [], JSON.stringify(bad) + ": the valid user's grant is not partially applied");
  }
});

test("BF-09 a non-array scope (null / string / object / number / boolean) is refused as allowedBizIds and blocks the whole apply; an absent scope is empty", async () => {
  for (const scope of [null, "bizA", { 0: "bizA" }, 7, true]) {
    const users = env([{ firebaseUid: "uMgr", role: "manager", allowedBizIds: ["bizA"] }, { firebaseUid: "uView", role: "viewer", allowedBizIds: scope }]);
    const p = planTenantBackfill("t1", users, {}, REGS[0][1]);
    assert.deepEqual(p.refused, [{ state: "invalid_request", reason: "allowedBizIds" }], JSON.stringify(scope) + ": refused, never treated as empty");
    const data = { tenants: { t1: { app: { users, business: REGS[0][1] } } } };
    const plan = planBackfill(data.tenants);
    const db = memDb(data);
    assert.equal(await runBackfill(db, A(["--apply", "--confirm-production=p", `--expect-plan=${planDigest(plan)}`]), "p", () => {}), 5);
    assert.deepEqual(db.writes, [], JSON.stringify(scope) + ": nothing written");
  }
  const absent = planTenantBackfill("t1", env([{ firebaseUid: "uView", role: "viewer" }]), {}, REGS[0][1]);
  assert.deepEqual([absent.updates, absent.refused, absent.scopedUsers], [{}, [], 1], "an absent scope is the empty scope (unchanged)");
});

test("BF-10 the digest binds the malformed tenants: adding, removing or renaming a malformed tenant changes it", () => {
  const good = { t1: tenant(REGS[0][1]) }, broken = { app: { users: { _v: "{" } } };
  const opts = { stopOnMalformed: false };
  const base = planBackfill(good, opts), withBad = planBackfill({ ...good, tBad: broken }, opts), renamed = planBackfill({ ...good, tOther: broken }, opts);
  assert.deepEqual(withBad.summary.malformedTenants, ["tBad"]);
  assert.deepEqual([Object.keys(withBad.updates).sort(), withBad.refused], [Object.keys(base.updates).sort(), base.refused], "same grants and refusals");
  assert.notEqual(planDigest(withBad), planDigest(base), "a malformed tenant changes the digest");
  assert.notEqual(planDigest(withBad), planDigest(renamed), "which tenant is malformed changes the digest");
  assert.equal(planDigest(planBackfill({ tBad: broken, ...good }, opts)), planDigest(withBad), "order-independent");
});
