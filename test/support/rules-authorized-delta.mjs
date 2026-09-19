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
