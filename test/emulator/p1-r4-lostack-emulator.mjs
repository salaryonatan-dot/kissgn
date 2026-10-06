// Finding #2 reproduction (P1 R3 review): transitionReview lost-ack readback can never resolve.
// Real api/admin.js + real lib/ + real fincore against the RTDB emulator (worktree Rules loaded).
// Seams: adminSdk (emulator Admin app), verifyToken (claims from the request), sendEmail (no-op).
// Scenario A: authorized manager create; the pending→cleared transition COMMITS but the SDK call
//             throws afterwards (ack lost). Expected by contract: readback resolves ("resolved" via
//             readback). Observed: outcome_unknown, response review:"pending" while stored state is cleared.
// Scenario B: access revoked between the fresh check and the commit; the pending→flagged transition
//             COMMITS, ack lost. Observed: audit "flag_unconfirmed" while the stored state is flagged
//             with a valid flagAudit.
// Proof of cause: JSON.stringify(readback entry) !== JSON.stringify(intended) purely by key order.
import admin from "firebase-admin";
import { mkdtempSync, cpSync, writeFileSync, mkdirSync, symlinkSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os"; import { join } from "node:path"; import { pathToFileURL } from "node:url";
const ROOT = process.argv[2];
const HOST = "127.0.0.1:9000", NS = "demo-marjin-rules-default-rtdb", DB_URL = `http://${HOST}?ns=${NS}`;
const rules = JSON.parse(readFileSync(join(ROOT, "database.rules.json"), "utf8"));
await fetch(`http://${HOST}/.settings/rules.json?ns=${NS}`, { method: "PUT", headers: { Authorization: "Bearer owner", "Content-Type": "application/json" }, body: JSON.stringify(rules) });
const T = "tenantA", B = "bizA"; const NODE = `tenants/${T}/biz:${B}:supplier_credits`; const env = (v) => ({ _v: JSON.stringify(v) });
const cid = (n) => `c0000000-0000-4000-8000-${String(n).padStart(12, "0")}`, oid = (n) => `0a000000-0000-4000-8000-${String(n).padStart(12, "0")}`;
const dir = mkdtempSync(join(tmpdir(), "f2-")); cpSync(join(ROOT, "lib"), join(dir, "lib"), { recursive: true }); mkdirSync(join(dir, "api")); cpSync(join(ROOT, "api/admin.js"), join(dir, "api/admin.js")); mkdirSync(join(dir, "fincore")); cpSync(join(ROOT, "fincore/v1"), join(dir, "fincore/v1"), { recursive: true }); symlinkSync(join(ROOT, "node_modules"), join(dir, "node_modules"), "dir");
writeFileSync(join(dir, "lib/adminSdk.js"), `export function getAdminDb(){ return globalThis.__DB(); }\nexport function getAdminAuth(){ return {}; }\n`);
writeFileSync(join(dir, "lib/verifyToken.js"), `export async function requireAuth(req){ return req.__claims; }\nexport async function verifyToken(){ return null; }\n`);
writeFileSync(join(dir, "lib/sendEmail.js"), `export async function sendEmail(){ return {}; }\nexport async function sendAlertDigest(){ return {}; }\n`);
const app = admin.initializeApp({ databaseURL: DB_URL }, "srv"); const real = app.database();
let hook = null;
globalThis.__DB = () => ({ ref: (p) => { const r = real.ref(p); if (p !== NODE || !hook) return r; return new Proxy(r, { get(t, k) { if (k !== "transaction") { const v = t[k]; return typeof v === "function" ? v.bind(t) : v; } return (...a) => hook(t, a); } }); } });
const handler = (await import(pathToFileURL(join(dir, "api/admin.js")).href)).default;
const W = await import(pathToFileURL(join(dir, "lib/supplierCredits.js")).href);
const Repo = await import(pathToFileURL(join(dir, "lib/repositories/supplierCreditsRepo.js")).href);
const FC = await import(pathToFileURL(join(dir, "fincore/v1/finance/supplierCredits.js")).href);
const seed = async () => real.ref("/").set({ tenants: { [T]: { members: { u_mgr: true }, roles: { u_mgr: "manager" }, biz_access: { [B]: { u_mgr: true } }, app: { business: env([{ id: B }]) }, [`biz:${B}:suppliers`]: env([{ id: "s1" }]) } } });
const call = async (body) => { const r = { code: null, body: null, setHeader() {}, status(n) { this.code = n; return this; }, json(v) { this.body = v; return this; } }; await handler({ method: "POST", query: { action: "create-supplier-credit" }, headers: {}, body, __claims: { uid: "u_mgr" } }, r); return r; };
const sortKeys = (o) => Array.isArray(o) ? o.map(sortKeys) : o && typeof o === "object" ? Object.fromEntries(Object.keys(o).sort().map((k) => [k, sortKeys(o[k])])) : o;
let fails = 0; const check = (name, ok, detail) => { console.log((ok ? "PASS " : "FAIL ") + name + (detail ? " :: " + detail : "")); if (!ok) fails++; };

// ── Scenario A: cleared transition commits, ack lost ──────────────────────────────────────────
await seed();
let n = 0, lostAt = null;
hook = async (t, a) => { const o = await t.transaction(...a); n++; if (n === 2 && o.committed) { lostAt = { txn: n, committed: o.committed }; throw new Error("ack lost after commit"); } return o; };
const rA = await call({ tenantId: T, bizId: B, creditId: cid(1), operationId: oid(1), supplierId: "s1", issueDate: "2026-10-01", amount: "10", documentNumber: "L-1" });
const sA = (await real.ref(NODE).get()).val(); const rvA = sA.review[oid(1)];
console.log("A response:", JSON.stringify({ code: rA.code, review: rA.body.review, reviewResolution: rA.body.reviewResolution, rebuildRequired: rA.body.rebuildRequired, postCommitAccess: rA.body.postCommitAccess, audit: rA.body.audit }));
console.log("A stored review entry:", JSON.stringify(rvA));
console.log("A ack lost on transaction #", JSON.stringify(lostAt));
check("A1 the transition COMMITTED (stored state is cleared)", rvA.state === "cleared", "stored state=" + rvA.state);
check("A2 CONTRACT: lost ack is resolved by readback (expected reviewResolution absent/resolved, review:cleared) — observed", rA.body.review === "cleared" && !rA.body.reviewResolution, "review=" + rA.body.review + " reviewResolution=" + rA.body.reviewResolution);
check("A3 response reports the stored credit as NOT counted (review pending) although it is authoritative", !(rA.body.review === "pending" && rvA.state === "cleared"), "mismatch between response and store");
check("A4 rebuildRequired is false although an authoritative credit was just stored", rA.body.rebuildRequired !== false, "rebuildRequired=" + rA.body.rebuildRequired);
check("A4b confirmed clear API outcome and date agree with persisted authoritative credit", rA.code === 200 && rA.body.ok === true && rA.body.applied === true && rA.body.review === rvA.state && rA.body.rebuildRequired === true && JSON.stringify(rA.body.affectedDates) === JSON.stringify(["2026-10-01"]), JSON.stringify({ok:rA.body.ok,applied:rA.body.applied,dates:rA.body.affectedDates}));
// cause: the intended entry (built inside the transaction) vs the read-back entry differ ONLY by key order
const pendingLike = { ...rvA }; delete pendingLike.resolvedAt; delete pendingLike.resolution; pendingLike.state = "pending";
const nodeBefore = { ...sA, review: { ...sA.review, [oid(1)]: pendingLike }, revision: sA.revision - 1 };
const re = W.applyReviewTransition(nodeBefore, { tenantId: T, bizId: B, operationId: oid(1), intentDigest: rvA.intentDigest, to: "cleared", resolution: rvA.resolution, now: rvA.resolvedAt });
const intended = re.o === "applied" ? re.node.review[oid(1)] : null;
console.log("A intended keys :", intended ? Object.keys(intended).join(",") : re.o);
console.log("A readback keys :", Object.keys(rvA).join(","));
check("A5 cause: stringify(intended) !== stringify(readback) while sorted-key forms are identical", intended && JSON.stringify(intended) !== JSON.stringify(rvA) && JSON.stringify(sortKeys(intended)) === JSON.stringify(sortKeys(rvA)), "key-order-only difference");
// the decoded node counts the credit (authoritative) — the response said pending
const dec = FC.decodeSupplierCredits(sA, { tenantId: T, bizId: B });
console.log("A decoded:", JSON.stringify({ state: dec.state, credits: (dec.credits || []).map((c) => c.creditId), issues: (dec.issues || []).map((i) => i.code) }));
check("A6 strict reader counts the credit (cleared) — contradicts the response", dec.state === "present" && dec.credits.length === 1 && dec.credits[0].creditId === cid(1), "credits=" + (dec.credits || []).length);

// ── Scenario B: revoked in window ⇒ flagged transition commits, ack lost ─────────────────────
await real.ref("/").set(null); await seed();
n = 0; lostAt = null;
hook = async (t, a) => { const o = await t.transaction(...a); n++; if (n === 1) { await real.ref(`tenants/${T}/members/u_mgr`).set(false); } if (n === 2 && o.committed) { lostAt = { txn: n }; throw new Error("ack lost after commit"); } return o; };
const rB = await call({ tenantId: T, bizId: B, creditId: cid(2), operationId: oid(2), supplierId: "s1", issueDate: "2026-10-01", amount: "10", documentNumber: "L-2" });
const sB = (await real.ref(NODE).get()).val(); const rvB = sB.review[oid(2)];
console.log("B response:", JSON.stringify({ code: rB.code, review: rB.body.review, reviewResolution: rB.body.reviewResolution, audit: rB.body.audit, postCommitAccess: rB.body.postCommitAccess }));
console.log("B stored review entry state/flagAudit:", rvB.state, rvB.flagAudit ? "flagAudit present (" + rvB.flagAudit.contract + ")" : "no flagAudit");
check("B1 the flag transition COMMITTED with durable flagAudit", rvB.state === "flagged" && !!rvB.flagAudit, "state=" + rvB.state);
check("B2 CONTRACT: durable flag evidence ⇒ audit flag_persisted / review flagged — observed", rB.body.audit === "flag_persisted" && rB.body.review === "flagged", "audit=" + rB.body.audit + " review=" + rB.body.review);
check("B2b confirmed flag API outcome remains non-authoritative after revocation", rB.code === 200 && rB.body.ok === true && rB.body.applied === true && rB.body.review === rvB.state && rB.body.audit === "flag_persisted" && rB.body.rebuildRequired === false && JSON.stringify(rB.body.affectedDates) === "[]" && rB.body.postCommitAccess === "revoked_during_commit", JSON.stringify({ok:rB.body.ok,applied:rB.body.applied,dates:rB.body.affectedDates,rebuild:rB.body.rebuildRequired}));
const bPending = { ...rvB }; delete bPending.resolvedAt; delete bPending.resolution; delete bPending.flagAudit; bPending.state = "pending";
const bBefore = { ...sB, review: { ...sB.review, [oid(2)]: bPending }, revision: sB.revision - 1 };
const bTransition = W.applyReviewTransition(bBefore, { tenantId: T, bizId: B, operationId: oid(2), intentDigest: rvB.intentDigest, to: "flagged", resolution: rvB.resolution, now: rvB.resolvedAt });
const bIntended = bTransition.node.review[oid(2)];
check("B3 nested RTDB flag audit key order differs while full canonical content agrees", JSON.stringify(bIntended) !== JSON.stringify(rvB) && JSON.stringify(sortKeys(bIntended)) === JSON.stringify(sortKeys(rvB)) && JSON.stringify(bIntended.flagAudit) !== JSON.stringify(rvB.flagAudit));

// Adverse committed-write readbacks must remain unknown. These distinguish full comparison from RM11.
const makePending = async () => { const pending = { ...sA, revision: sA.revision - 1, review: { ...sA.review, [oid(1)]: pendingLike } }; await real.ref(NODE).set(pending); };
const args = { tenantId: T, bizId: B, operationId: oid(1), intentDigest: rvA.intentDigest, to: "cleared", resolution: rvA.resolution, now: rvA.resolvedAt };
const lostDb = after => ({ ref: p => { const r = real.ref(p); return { transaction: async (...a) => { const x = await r.transaction(...a); if (x.committed) { await after?.(r); throw Error("ack lost after committed transition"); } return x; }, get: () => r.get() }; } });
await makePending();
const changed = await Repo.transitionReview(args, lostDb(async r => r.child(`review/${oid(1)}/resolvedAt`).set(rvA.resolvedAt + 1)));
check("C1 changed complete payload cannot be confirmed after lost ack", changed.status === "outcome_unknown", JSON.stringify(changed));
await makePending();
const corrupt = await Repo.transitionReview(args, lostDb(async r => r.child(`review/${oid(1)}/intentDigest`).set("f".repeat(64))));
check("C2 corrupt evidence cannot be confirmed after lost ack", corrupt.status === "outcome_unknown", JSON.stringify(corrupt));
await makePending();
const unreadable = await Repo.transitionReview(args, { ref: p => { const r = lostDb().ref(p); return { transaction: r.transaction, get: async () => { throw Error("readback down"); } }; } });
check("C3 unavailable readback remains unknown", unreadable.status === "outcome_unknown" && unreadable.detail === "readback_failed", JSON.stringify(unreadable));
await real.ref(NODE).set(bBefore);
const badAudit = await Repo.transitionReview({ tenantId: T, bizId: B, operationId: oid(2), intentDigest: rvB.intentDigest, to: "flagged", resolution: rvB.resolution, now: rvB.resolvedAt }, lostDb(async r => r.child(`review/${oid(2)}/flagAudit/decision`).set("cleared")));
check("C4 invalid flag audit cannot be confirmed after lost ack", badAudit.status === "outcome_unknown", JSON.stringify(badAudit));
// Registry authority is checked after the credit transaction as well; an in-window removal flags.
await real.ref("/").set(null); await seed();
n = 0; lostAt = null;
hook = async (t, a) => { const o = await t.transaction(...a); n++; if (n === 1) await real.ref(`tenants/${T}/app/business`).set(env([])); if (n === 2 && o.committed) { lostAt = { txn: n }; throw Error("ack lost after committed flag"); } return o; };
const rD = await call({ tenantId: T, bizId: B, creditId: cid(3), operationId: oid(3), supplierId: "s1", issueDate: "2026-10-01", amount: "10", documentNumber: "L-3" });
const rvD = (await real.ref(NODE).get()).val().review[oid(3)];
check("D1 business registry removal cannot authorize a clear", rvD.state === "flagged" && !!rvD.flagAudit && rD.body.postCommitAccess === "revoked_during_commit", JSON.stringify({stored:rvD.state,access:rD.body.postCommitAccess}));
check("D2 lost acknowledgement of durable registry flag reports verified persisted outcome", rD.body.review === "flagged" && rD.body.audit === "flag_persisted" && rD.body.rebuildRequired === false && JSON.stringify(rD.body.affectedDates) === "[]", JSON.stringify({review:rD.body.review,audit:rD.body.audit}));
console.log(JSON.stringify({ probe: "r3-finding2-lostack", failures: fails }));
await app.delete();
process.exitCode = fails ? 1 : 0;
