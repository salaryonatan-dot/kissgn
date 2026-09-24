// Marjin — S0 anti-migration guard: the AUTHORIZED RTDB-Rules delta for the entries
// node, pinned EXACTLY. `database.rules.json` is a forbidden path for S0; the ONLY
// change it may carry is the entries storage contract (R10.1 legacy validators + the
// Storage V2 row-keyed contract). This module states that contract as literal
// expressions so the guard compares SEMANTICS (a whitespace-normalized expression
// tree), not the presence of tokens: an inert wrapper such as `true || (…)`, a
// re-ordered predicate, a loosened comparison or a smuggled child rule all differ from
// the pinned expression and are rejected. The emulator mutation probe
// (test/emulator/storage-v2-rules-guard-mutations.mjs) proves each such mutation would
// really weaken enforcement, so a rejection here is never theoretical.
//
// Changing the storage contract therefore REQUIRES changing this file in the same
// reviewed change — that is the point.

export const ENTRIES_KEY = "$dataKey.matches(/^biz:[^:]+:entries$/)";
export const UUID_RE = "/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/";
// R10.1 legacy blob shape (kept verbatim until every business is converted).
export const LEGACY_BLOB_RE = "/^biz:[^:]+:entries$/)) || (root.child('tenants').child($tenantId).child($dataKey).child('schemaVersion').val() === 2 ? newData.val() === data.val() : (newData.isString() && newData.val().length <= 1048576 && newData.val().matches(/^(\\[\\]|\\[\\{(([^}]|\\}[^,]|\\},[^{])*(\\}|\\},)?)\"id\":\"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\"(([^}]|\\}[^,]|\\},[^{])*(\\}|\\},)?)(\\},\\{(([^}]|\\}[^,]|\\},[^{])*(\\}|\\},)?)\"id\":\"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\"(([^}]|\\}[^,]|\\},[^{])*(\\}|\\},)?))*\\}\\])$/";
// R-V2-H1 cutover permanence: appended to the entries AUTHORIZATION branch of `.write`
// because RTDB evaluates `.validate` only for non-null writes — a delete can only be
// constrained here. The authorization predicate itself is untouched.
export const CUTOVER_GUARD = "(!(data.child('schemaVersion').val() === 2) || newData.child('schemaVersion').val() === 2)";

export const EXPECTED_ENTRIES_DELTA = Object.freeze({
  ".validate": "!($dataKey.matches(/^biz:[^:]+:entries$/)) || (newData.child('schemaVersion').val() === 2 ? (newData.hasChildren(['schemaVersion','generation']) && newData.child('schemaVersion').val() === 2 && newData.child('generation').isNumber() && (data.child('schemaVersion').val() === 2 ? (newData.child('generation').val() === data.child('generation').val() || (newData.child('generation').val() === data.child('generation').val() + 1 && !newData.child('rows').exists())) : newData.child('generation').val() === 1) && (!newData.child('rows').exists() || newData.child('rows').hasChildren()) && (!newData.child('_v').exists() || newData.child('_v').isString())) : (!(data.child('schemaVersion').val() === 2) && (newData.hasChildren(['_v']) && newData.child('_v').isString() && newData.child('_v').val().length <= 1048576 && newData.child('_v').val().matches(/^(\\[\\]|\\[\\{(([^}]|\\}[^,]|\\},[^{])*(\\}|\\},)?)\"id\":\"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\"(([^}]|\\}[^,]|\\},[^{])*(\\}|\\},)?)(\\},\\{(([^}]|\\}[^,]|\\},[^{])*(\\}|\\},)?)\"id\":\"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\"(([^}]|\\}[^,]|\\},[^{])*(\\}|\\},)?))*\\}\\])$/))))",
  "_v": { ".validate": "!($dataKey.matches(/^biz:[^:]+:entries$/)) || (root.child('tenants').child($tenantId).child($dataKey).child('schemaVersion').val() === 2 ? newData.val() === data.val() : (newData.isString() && newData.val().length <= 1048576 && newData.val().matches(/^(\\[\\]|\\[\\{(([^}]|\\}[^,]|\\},[^{])*(\\}|\\},)?)\"id\":\"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\"(([^}]|\\}[^,]|\\},[^{])*(\\}|\\},)?)(\\},\\{(([^}]|\\}[^,]|\\},[^{])*(\\}|\\},)?)\"id\":\"[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\"(([^}]|\\}[^,]|\\},[^{])*(\\}|\\},)?))*\\}\\])$/)))" },
  "schemaVersion": { ".validate": "!($dataKey.matches(/^biz:[^:]+:entries$/)) || (newData.val() === 2 && (!data.exists() || data.val() === 2) && newData.parent().child('generation').isNumber())" },
  "generation": { ".validate": "!($dataKey.matches(/^biz:[^:]+:entries$/)) || (newData.isNumber() && (data.exists() ? (newData.val() === data.val() || (newData.val() === data.val() + 1 && !newData.parent().child('rows').exists())) : (newData.parent().child('schemaVersion').val() === 2 && newData.val() === 1)))" },
  "rows": {
    ".validate": "!($dataKey.matches(/^biz:[^:]+:entries$/)) || newData.hasChildren()",
    "$rowId": {
      ".validate": "$dataKey.matches(/^biz:[^:]+:entries$/) && $rowId.matches(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/) && newData.hasChildren(['id','_gen','date']) && newData.child('id').isString() && newData.child('id').val() === $rowId && newData.child('_gen').isNumber() && newData.child('_gen').val() === newData.parent().parent().child('generation').val() && newData.child('date').isString()",
      "id": {
        ".validate": "newData.isString() && newData.val() === $rowId"
      },
      "_gen": {
        ".validate": "newData.isNumber()"
      },
      "date": {
        ".validate": "newData.isString()"
      }
    }
  },
});

// The entries authorization branch must be EXACTLY the base branch, wrapped once with
// the cutover guard: `(<base branch> && <CUTOVER_GUARD>)`.
export function expectedWriteRule(baseWrite) {
  const head = ENTRIES_KEY + " ? ";
  const i0 = baseWrite.indexOf(head); if (i0 < 0) return null;
  const i1 = baseWrite.indexOf(" : $dataKey.matches(/^biz:[^:]+:config$/)", i0); if (i1 < 0) return null;
  const branch = baseWrite.slice(i0 + head.length, i1);
  return baseWrite.slice(0, i0 + head.length) + "(" + branch + " && " + CUTOVER_GUARD + ")" + baseWrite.slice(i1);
}

const norm = (v) => {
  if (typeof v === "string") return v.replace(/\s+/g, " ").trim();
  if (Array.isArray(v)) return v.map(norm);
  if (v && typeof v === "object") { const o = {}; for (const k of Object.keys(v).sort()) o[k] = norm(v[k]); return o; }
  return v;
};
const same = (a, b) => JSON.stringify(norm(a)) === JSON.stringify(norm(b));

// before/after: PARSED rules documents. Returns { ok, reason }.
export function authorizedEntriesRulesDelta(before, after) {
  let a; try { a = JSON.parse(JSON.stringify(after)); } catch { return { ok: false, reason: "after_unserializable" }; }
  const bdk = before?.rules?.tenants?.["$tenantId"]?.["$dataKey"];
  const adk = a?.rules?.tenants?.["$tenantId"]?.["$dataKey"];
  if (!bdk || !adk) return { ok: false, reason: "dataKey_missing" };
  if (typeof bdk[".write"] !== "string" || typeof adk[".write"] !== "string") return { ok: false, reason: "write_rule_missing" };
  const expectedWrite = expectedWriteRule(bdk[".write"]);
  if (expectedWrite === null) return { ok: false, reason: "base_write_shape_unknown" };
  if (adk[".write"] !== expectedWrite) return { ok: false, reason: "write_rule_not_base_plus_cutover_guard" };
  adk[".write"] = bdk[".write"];
  for (const key of Object.keys(EXPECTED_ENTRIES_DELTA)) {
    if (!(key in adk)) return { ok: false, reason: "authorized_rule_missing:" + key };
    if (!same(adk[key], EXPECTED_ENTRIES_DELTA[key])) return { ok: false, reason: "authorized_rule_differs:" + key };
    delete adk[key];
  }
  try { if (JSON.stringify(norm(a)) !== JSON.stringify(norm(before))) return { ok: false, reason: "unauthorized_change_outside_entries_contract" }; }
  catch { return { ok: false, reason: "compare_failed" }; }
  return { ok: true };
}

// ── VERSION FENCE (P0-DATA-01, CTO D-VF2): the AUTHORIZED fence delta over the approved
// Storage V2 core Rules, pinned EXACTLY. Two additions and nothing else:
//   (1) the server-owned control root `/storage_v2_control/$tenantId/$bizId` — scoped member
//       read, client write=false at every level (Admin SDK bypasses Rules as usual);
//   (2) FENCE_GUARD appended to the entries AUTHORIZATION branch of `.write` (the granting
//       node, so child writes, transactions, multipath updates and null deletions are all
//       covered): with NO control record only legacy-shaped results onto non-V2 data;
//       with a VALID record — contractVersion 1, numeric policyRevision ≥ 1, boolean
//       allowV2Initialization, numeric minStorageProtocol ≥ 1, recognised phase — 'legacy'
//       behaves the same, 'v2_active' allows only a V2 result (existing V2, or genuinely
//       absent with allowV2Initialization === true) with the frozen `_v` unchanged;
//       'quiesced', 'recovery_hold' and ANY malformed present record deny everything.
// Changing the fence therefore REQUIRES changing this file in the same reviewed change.
export const FENCE_GUARD = "(((!root.child('storage_v2_control').child($tenantId).child($dataKey.replace('biz:','').replace(':entries','')).exists() || ((root.child('storage_v2_control').child($tenantId).child($dataKey.replace('biz:','').replace(':entries','')).child('contractVersion').val() === 1 && root.child('storage_v2_control').child($tenantId).child($dataKey.replace('biz:','').replace(':entries','')).child('policyRevision').isNumber() && root.child('storage_v2_control').child($tenantId).child($dataKey.replace('biz:','').replace(':entries','')).child('policyRevision').val() >= 1 && root.child('storage_v2_control').child($tenantId).child($dataKey.replace('biz:','').replace(':entries','')).child('allowV2Initialization').isBoolean() && root.child('storage_v2_control').child($tenantId).child($dataKey.replace('biz:','').replace(':entries','')).child('minStorageProtocol').isNumber() && root.child('storage_v2_control').child($tenantId).child($dataKey.replace('biz:','').replace(':entries','')).child('minStorageProtocol').val() >= 1 && (root.child('storage_v2_control').child($tenantId).child($dataKey.replace('biz:','').replace(':entries','')).child('phase').val() === 'legacy' || root.child('storage_v2_control').child($tenantId).child($dataKey.replace('biz:','').replace(':entries','')).child('phase').val() === 'quiesced' || root.child('storage_v2_control').child($tenantId).child($dataKey.replace('biz:','').replace(':entries','')).child('phase').val() === 'v2_active' || root.child('storage_v2_control').child($tenantId).child($dataKey.replace('biz:','').replace(':entries','')).child('phase').val() === 'recovery_hold')) && root.child('storage_v2_control').child($tenantId).child($dataKey.replace('biz:','').replace(':entries','')).child('phase').val() === 'legacy')) && !(newData.child('schemaVersion').val() === 2) && !(data.child('schemaVersion').val() === 2)) || ((root.child('storage_v2_control').child($tenantId).child($dataKey.replace('biz:','').replace(':entries','')).child('contractVersion').val() === 1 && root.child('storage_v2_control').child($tenantId).child($dataKey.replace('biz:','').replace(':entries','')).child('policyRevision').isNumber() && root.child('storage_v2_control').child($tenantId).child($dataKey.replace('biz:','').replace(':entries','')).child('policyRevision').val() >= 1 && root.child('storage_v2_control').child($tenantId).child($dataKey.replace('biz:','').replace(':entries','')).child('allowV2Initialization').isBoolean() && root.child('storage_v2_control').child($tenantId).child($dataKey.replace('biz:','').replace(':entries','')).child('minStorageProtocol').isNumber() && root.child('storage_v2_control').child($tenantId).child($dataKey.replace('biz:','').replace(':entries','')).child('minStorageProtocol').val() >= 1 && (root.child('storage_v2_control').child($tenantId).child($dataKey.replace('biz:','').replace(':entries','')).child('phase').val() === 'legacy' || root.child('storage_v2_control').child($tenantId).child($dataKey.replace('biz:','').replace(':entries','')).child('phase').val() === 'quiesced' || root.child('storage_v2_control').child($tenantId).child($dataKey.replace('biz:','').replace(':entries','')).child('phase').val() === 'v2_active' || root.child('storage_v2_control').child($tenantId).child($dataKey.replace('biz:','').replace(':entries','')).child('phase').val() === 'recovery_hold')) && root.child('storage_v2_control').child($tenantId).child($dataKey.replace('biz:','').replace(':entries','')).child('phase').val() === 'v2_active' && newData.child('schemaVersion').val() === 2 && (data.exists() ? data.child('schemaVersion').val() === 2 : root.child('storage_v2_control').child($tenantId).child($dataKey.replace('biz:','').replace(':entries','')).child('allowV2Initialization').val() === true) && (!data.child('_v').exists() || newData.child('_v').val() === data.child('_v').val())))";
export const EXPECTED_STORAGE_V2_CONTROL_RULES = Object.freeze({".read":false,".write":false,"$tenantId":{".read":false,".write":false,"$bizId":{".read":"auth !== null && root.child('tenants').child($tenantId).child('members').child(auth.uid).val() === true && (root.child('tenants').child($tenantId).child('roles').child(auth.uid).val() === 'owner' || root.child('tenants').child($tenantId).child('roles').child(auth.uid).val() === 'super_owner' || root.child('tenants').child($tenantId).child('biz_access').child($bizId).child(auth.uid).val() === true)",".write":false}}});

// The entries authorization branch of the FENCED rules must be EXACTLY the core branch
// (`(<base branch> && CUTOVER_GUARD)`) with FENCE_GUARD appended INSIDE that wrapper:
// `(<base branch> && CUTOVER_GUARD && FENCE_GUARD)`.
export function expectedFencedWriteRule(coreWrite) {
  const head = ENTRIES_KEY + " ? ";
  const i0 = coreWrite.indexOf(head); if (i0 < 0) return null;
  const i1 = coreWrite.indexOf(" : $dataKey.matches(/^biz:[^:]+:config$/)", i0); if (i1 < 0) return null;
  const branch = coreWrite.slice(i0 + head.length, i1);
  const tail = " && " + CUTOVER_GUARD + ")";
  if (!branch.startsWith("(") || !branch.endsWith(tail)) return null;
  return coreWrite.slice(0, i0 + head.length) + branch.slice(0, -1) + " && " + FENCE_GUARD + ")" + coreWrite.slice(i1);
}

// core/live: PARSED rules documents (core = the approved Storage V2 core Rules, which
// themselves must satisfy authorizedEntriesRulesDelta against the S0 base). Returns
// { ok, reason }. The live tree minus the two authorized additions must be deep-equal to
// the core tree: any other change — a widened role branch, an altered validator, an
// unexpected child, a control root that grants writes — is rejected.
export function authorizedVersionFenceRulesDelta(core, live) {
  let a; try { a = JSON.parse(JSON.stringify(live)); } catch { return { ok: false, reason: "live_unserializable" }; }
  const cdk = core?.rules?.tenants?.["$tenantId"]?.["$dataKey"];
  const adk = a?.rules?.tenants?.["$tenantId"]?.["$dataKey"];
  if (!cdk || !adk) return { ok: false, reason: "dataKey_missing" };
  if (typeof cdk[".write"] !== "string" || typeof adk[".write"] !== "string") return { ok: false, reason: "write_rule_missing" };
  const expected = expectedFencedWriteRule(cdk[".write"]);
  if (expected === null) return { ok: false, reason: "core_write_shape_unknown" };
  if (adk[".write"] !== expected) return { ok: false, reason: "write_rule_not_core_plus_fence_guard" };
  adk[".write"] = cdk[".write"];
  const ctrl = a?.rules?.storage_v2_control;
  if (ctrl === undefined) return { ok: false, reason: "control_root_missing" };
  if (JSON.stringify(ctrl) !== JSON.stringify(EXPECTED_STORAGE_V2_CONTROL_RULES)) return { ok: false, reason: "control_root_differs" };
  delete a.rules.storage_v2_control;
  try { if (JSON.stringify(norm(a)) !== JSON.stringify(norm(core))) return { ok: false, reason: "unauthorized_change_outside_fence_delta" }; }
  catch { return { ok: false, reason: "compare_failed" }; }
  return { ok: true };
}

// Exact content identity of the reviewed fenced Rules file (git blob SHA-1). The emulator
// mirror must be byte-identical. Re-pinning is an explicit reviewed change; a guard never
// derives this value from the live file under test.
export const APPROVED_FENCE_RULES_BLOB = "11799bd7e0560caf8d6b5512b4694f6ee865fa6b";
