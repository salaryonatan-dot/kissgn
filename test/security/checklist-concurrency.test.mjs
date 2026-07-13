// Deterministic tests for checklist optimistic-concurrency (version token +
// single-node transaction) and the client confirmation flow. Pure JS; no network:
// the RTDB transaction body is exercised via an in-memory node; auth/validation via
// the real domain; client behavior via static-src assertions.
//   Run: node test/security/checklist-concurrency.test.mjs
import assert from "node:assert";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { canonicalizeChecklistDocument, checklistVersionToken, hasForbiddenKeys } from "../../lib/checklistVersion.js";

const REPO = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const admin = readFileSync(join(REPO, "api", "admin.js"), "utf8");
const idx = readFileSync(join(REPO, "index.html"), "utf8");
let pass = 0, fail = 0;
const T = (n, fn) => { try { fn(); console.log("PASS " + n); pass++; } catch (e) { console.log("FAIL " + n + " — " + (e && e.message)); fail++; } };

// ── canonical token ──
T("TOKEN same object, different key order → same token", () => {
  assert.strictEqual(checklistVersionToken({ a: 1, b: 2 }), checklistVersionToken({ b: 2, a: 1 }));
});
T("TOKEN nested key-order difference → same token", () => {
  assert.strictEqual(checklistVersionToken({ x: { p: 1, q: 2 } }), checklistVersionToken({ x: { q: 2, p: 1 } }));
});
T("TOKEN array order change → different token", () => {
  assert.notStrictEqual(checklistVersionToken({ a: [1, 2, 3] }), checklistVersionToken({ a: [3, 2, 1] }));
});
T("TOKEN null / undefined / nonexistent → one deterministic token", () => {
  assert.strictEqual(checklistVersionToken(null), checklistVersionToken(undefined));
  assert.ok(/^[a-f0-9]{64}$/.test(checklistVersionToken(null)));
});
T("TOKEN value change → different token; type distinction", () => {
  assert.notStrictEqual(checklistVersionToken({ a: 1 }), checklistVersionToken({ a: 2 }));
  assert.notStrictEqual(checklistVersionToken({ a: 1 }), checklistVersionToken({ a: "1" }));   // number vs string
  assert.notStrictEqual(checklistVersionToken({ a: null }), checklistVersionToken({ a: [] }));  // null vs array
  assert.notStrictEqual(checklistVersionToken([]), checklistVersionToken({}));                  // array vs object
});
T("TOKEN unsupported/cyclic/non-finite/forbidden-key input rejected", () => {
  const cyc = {}; cyc.self = cyc;
  assert.throws(() => canonicalizeChecklistDocument(cyc));
  assert.throws(() => canonicalizeChecklistDocument({ f: () => {} }));
  assert.throws(() => canonicalizeChecklistDocument({ n: NaN }));
  assert.throws(() => canonicalizeChecklistDocument(JSON.parse('{"__proto__":1}')), (e) => e.code === "forbidden_key");
  assert.throws(() => canonicalizeChecklistDocument(JSON.parse('{"constructor":1}')), (e) => e.code === "forbidden_key");
  assert.ok(hasForbiddenKeys(JSON.parse('{"a":{"prototype":1}}')));
});

// ── transaction body (in-memory node mirror of setBizDocGuarded) ──
function makeNode(doc) { return { value: doc == null ? null : { _v: JSON.stringify(doc) } }; }
function unwrap(raw) { if (raw && typeof raw === "object" && typeof raw._v === "string") { try { return JSON.parse(raw._v); } catch { return null; } } return raw ?? null; }
function guardedSet(node, doc, expectedToken) {
  // mirrors setBizDocGuarded's transaction body
  const currentDoc = unwrap(node.value);
  const currentToken = checklistVersionToken(currentDoc);
  if (currentToken !== expectedToken) return { conflict: true, currentToken }; // abort — no write
  node.value = { _v: JSON.stringify(doc) };
  return { ok: true, versionToken: checklistVersionToken(doc) };
}
T("TXN matching token writes; returned token matches stored doc", () => {
  const node = makeNode({ a: 1 });
  const tok = checklistVersionToken({ a: 1 });
  const r = guardedSet(node, { a: 2 }, tok);
  assert.ok(r.ok); assert.strictEqual(r.versionToken, checklistVersionToken({ a: 2 }));
  assert.strictEqual(r.versionToken, checklistVersionToken(unwrap(node.value)));
});
T("TXN stale token → 409-conflict, writes NOTHING", () => {
  const node = makeNode({ a: 1 });
  const before = JSON.stringify(node.value);
  const r = guardedSet(node, { a: 2 }, checklistVersionToken({ a: 999 })); // stale
  assert.ok(r.conflict); assert.strictEqual(JSON.stringify(node.value), before);
});
T("TXN concurrent writers: first succeeds, second conflicts (last-write-wins prevented)", () => {
  const node = makeNode({ v: 0 });
  const shared = checklistVersionToken({ v: 0 }); // both read the same baseline token
  const r1 = guardedSet(node, { v: 1 }, shared);  // writer 1 commits
  const r2 = guardedSet(node, { v: 2 }, shared);  // writer 2 uses stale baseline → conflict
  assert.ok(r1.ok); assert.ok(r2.conflict);
  assert.deepStrictEqual(unwrap(node.value), { v: 1 }); // writer 1 preserved, not silently overwritten
});
T("TXN new-document creation uses the null-document token", () => {
  const node = makeNode(null);
  const r = guardedSet(node, { created: true }, checklistVersionToken(null));
  assert.ok(r.ok);
});

// ── API static: token surface + validation + transaction target + authz-before-txn ──
T("API GET checklist returns document + versionToken", () => {
  assert.ok(admin.includes("res.status(200).json({ ok: true, document, versionToken })"));
});
T("API SET requires expectedVersionToken; conflict → 409 checklist_conflict", () => {
  assert.ok(admin.includes("validVersionToken(expectedVersionToken)"));
  assert.ok(admin.includes('res.status(409).json({ ok: false, error: "checklist_conflict" })'));
});
T("API SET transacts only the exact document node (setBizDocGuarded), not root/tenant", () => {
  assert.ok(admin.includes("setBizDocGuarded(ctx.tenantId, ctx.bizId,"));
  const repo = readFileSync(join(REPO, "lib", "repositories", "bizDataRepo.js"), "utf8");
  assert.ok(repo.includes("getAdminDb().ref(`tenants/${tenantId}/biz:${bizId}:${suffix}`)"));
  assert.ok(!/\.ref\("tenants"\)\.transaction|\.ref\(\)\.transaction/.test(repo));
});
T("API authorization runs BEFORE the transaction (bizDataAuthWrite precedes setBizDocGuarded)", () => {
  const seg = admin.slice(admin.indexOf("async function handleSetChecklistRun"), admin.indexOf("async function handleGetChecklistSimpleRun"));
  assert.ok(seg.indexOf("bizDataAuthWrite(req, res") < seg.indexOf("setBizDocGuarded"));
});
T("API doc validation: UTF-8 byte limit + prototype-pollution + no top-level array + no arbitrary path", () => {
  assert.ok(admin.includes('Buffer.byteLength(str, "utf8") > BIZDATA_MAX_DOC'));
  assert.ok(admin.includes("canonicalizeChecklistDocument(doc)"));
  assert.ok(admin.includes("Array.isArray(doc)")); // top-level array rejected
  assert.ok(admin.includes("`checklist_runs:${businessDate}`")); // path constructed from validated ids
});

// ── client static: confirm-then-display + token + conflict ──
T("CLIENT no optimistic pre-save mutation (setRuns/setSimpleRun before persist removed)", () => {
  assert.ok(!/setRuns\(newRuns\);\s*\n\s*(closeItemEditor\(\);\s*\n\s*)?try \{ await apiSetChecklistDoc/.test(idx));
  assert.ok(!idx.includes("setSimpleRun(next); // optimistic"));
});
T("CLIENT all three checklist families send expectedVersionToken", () => {
  assert.ok(idx.includes('apiSetChecklistDoc("run", bizId, { businessDate: todayKey, doc: newRuns, expectedVersionToken: runsTokenRef.current })'));
  assert.ok(idx.includes("expectedVersionToken: itToken"));
  assert.ok(idx.includes('apiSetChecklistDoc("simple-run", bizId, { businessDate: todayKey, templateId: tplId, doc: next, expectedVersionToken: simpleRunTokenRef.current })'));
});
T("CLIENT success replaces state with server document + stores token", () => {
  assert.ok(idx.includes("setRuns(document); runsTokenRef.current = versionToken;"));
  assert.ok(idx.includes("setSimpleRun(document); simpleRunTokenRef.current = versionToken;"));
  assert.ok(idx.includes("itemsTokenRef.current = setR.versionToken;"));
});
T("CLIENT conflict shows the reload message and preserves/reloads (no auto-overwrite)", () => {
  assert.ok(idx.includes("הנתונים השתנו על ידי משתמש אחר. יש לטעון מחדש לפני שמירה נוספת."));
  assert.ok(idx.includes("if (e.conflict)"));
});
T("CLIENT load effects capture the version token; switching keeps cancellation guard", () => {
  assert.ok(idx.includes("runsTokenRef.current = versionToken;"));
  assert.ok(idx.includes("itemsTokenRef.current = versionToken;"));
  assert.ok(idx.includes("simpleRunTokenRef.current = versionToken;"));
  assert.ok(idx.includes("return () => { cancelled = true; };"));
});

console.log(`\nTotal: ${pass + fail}  Passed: ${pass}  Failed: ${fail}`);
process.exit(fail === 0 ? 0 : 1);
