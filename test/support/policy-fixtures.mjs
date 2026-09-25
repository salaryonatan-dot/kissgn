// Marjin — VERSION FENCE R1: the canonical control-record fixture matrix shared by the parser
// parity unit test (test/security/storage-policy-parity.test.mjs) and the Rules parity emulator
// script (test/emulator/storage-policy-parity.mjs). ONE matrix, two enforcement points.
//
// Every fixture is a value as RTDB would deliver it (no nulls, no empty objects — RTDB stores
// neither; the generator strips them so an "in-memory-only" shape never masquerades as a
// server-deliverable one).

export const MAX = Number.MAX_SAFE_INTEGER;               // 9007199254740991 — the Rules bound literal
const OP = (over = {}) => ({ id: "op-1", kind: "cutover", owner: "operator", startedAt: 1700000000000, ...over });
const REC = (over = {}) => ({ contractVersion: 1, phase: "legacy", policyRevision: 1, allowV2Initialization: false, minStorageProtocol: 1, ...over });
const drop = (rec, key) => { const r = { ...rec }; delete r[key]; return r; };

/** Records the contract accepts. `expect` = server behaviour for a LEGACY-shaped write on a legacy node. */
export const VALID_POLICIES = [
  { name: "legacy minimal", record: REC(), expect: "allow" },
  { name: "legacy + conversionAttempted:false", record: REC({ conversionAttempted: false }), expect: "allow" },
  { name: "legacy + diagnostics (updatedAt/updatedBy/approvedReleaseId)", record: REC({ updatedAt: 1700000000000, updatedBy: "operator", approvedReleaseId: "rel-1" }), expect: "allow" },
  { name: "legacy + diagnostics of the wrong type (ignored, never authorization)", record: REC({ updatedAt: "yesterday", updatedBy: 7, approvedReleaseId: true }), expect: "allow" },
  { name: "legacy at policyRevision MAX_SAFE_INTEGER", record: REC({ policyRevision: MAX }), expect: "allow" },
  { name: "legacy with minStorageProtocol MAX_SAFE_INTEGER (valid; honest clients see update_required)", record: REC({ minStorageProtocol: MAX }), expect: "allow" },
  { name: "legacy with an unknown extra key (ignored)", record: REC({ note: "x" }), expect: "allow" },
  { name: "quiesced + cutover operation", record: REC({ phase: "quiesced", policyRevision: 2, operation: OP() }), expect: "deny_phase" },
  { name: "quiesced + operation + conversionAttempted:true", record: REC({ phase: "quiesced", policyRevision: 3, operation: OP(), conversionAttempted: true }), expect: "deny_phase" },
  { name: "recovery_hold + recovery operation", record: REC({ phase: "recovery_hold", policyRevision: 5, minStorageProtocol: 2, operation: OP({ id: "rec-1", kind: "recovery" }) }), expect: "deny_phase" },
  { name: "v2_active flag=false", record: REC({ phase: "v2_active", policyRevision: 4, minStorageProtocol: 2 }), expect: "deny_shape" },
  { name: "v2_active flag=true (native initialisation window)", record: REC({ phase: "v2_active", policyRevision: 4, minStorageProtocol: 2, allowV2Initialization: true }), expect: "deny_shape" },
  { name: "v2_active + conversionAttempted:true + approvedReleaseId", record: REC({ phase: "v2_active", policyRevision: 4, minStorageProtocol: 2, conversionAttempted: true, approvedReleaseId: "rel-2" }), expect: "deny_shape" },
];

/** Records the contract rejects. `parser` = expected parsePolicyRecord status; Rules must deny EVERYTHING. */
export const INVALID_POLICIES = [
  // whole record
  { name: "scalar whole policy (number)", record: 7, parser: "malformed" },
  { name: "scalar whole policy (string)", record: "legacy", parser: "malformed" },
  { name: "scalar whole policy (boolean)", record: true, parser: "malformed" },
  { name: "array whole policy", record: ["legacy"], parser: "malformed" },
  // partial
  { name: "partial: phase only", record: { phase: "legacy" }, parser: "malformed" },
  { name: "partial: policyRevision only", record: { policyRevision: 7 }, parser: "malformed" },
  { name: "partial: contractVersion only", record: { contractVersion: 1 }, parser: "malformed" },
  { name: "partial: missing phase", record: drop(REC(), "phase"), parser: "malformed" },
  { name: "partial: missing policyRevision", record: drop(REC(), "policyRevision"), parser: "malformed" },
  { name: "partial: missing allowV2Initialization", record: drop(REC(), "allowV2Initialization"), parser: "malformed" },
  { name: "partial: missing minStorageProtocol", record: drop(REC(), "minStorageProtocol"), parser: "malformed" },
  { name: "partial: missing contractVersion", record: drop(REC(), "contractVersion"), parser: "malformed" },
  // phase
  { name: "unknown phase", record: REC({ phase: "active" }), parser: "malformed" },
  { name: "phase case-variant", record: REC({ phase: "Legacy" }), parser: "malformed" },
  { name: "phase empty string", record: REC({ phase: "" }), parser: "malformed" },
  { name: "phase number", record: REC({ phase: 1 }), parser: "malformed" },
  { name: "phase boolean", record: REC({ phase: true }), parser: "malformed" },
  { name: "phase object", record: REC({ phase: { v: "legacy" } }), parser: "malformed" },
  // contractVersion
  { name: "contractVersion 0", record: REC({ contractVersion: 0 }), parser: "malformed" },
  { name: "contractVersion string '1'", record: REC({ contractVersion: "1" }), parser: "malformed" },
  { name: "contractVersion 1.5", record: REC({ contractVersion: 1.5 }), parser: "malformed" },
  { name: "contractVersion 2 (well-formed newer contract)", record: REC({ contractVersion: 2 }), parser: "unsupported_contract" },
  { name: "contractVersion true", record: REC({ contractVersion: true }), parser: "malformed" },
  // policyRevision
  { name: "fractional revision 1.5", record: REC({ policyRevision: 1.5 }), parser: "malformed" },
  { name: "fractional revision 2.0000001", record: REC({ policyRevision: 2.0000001 }), parser: "malformed" },
  { name: "unsafe revision MAX_SAFE_INTEGER+1", record: REC({ policyRevision: MAX + 1 }), parser: "malformed" },
  { name: "unsafe revision 1e16", record: REC({ policyRevision: 1e16 }), parser: "malformed" },
  { name: "unsafe revision 1e300", record: REC({ policyRevision: 1e300 }), parser: "malformed" },
  { name: "revision zero", record: REC({ policyRevision: 0 }), parser: "malformed" },
  { name: "revision negative", record: REC({ policyRevision: -1 }), parser: "malformed" },
  { name: "revision -0.5", record: REC({ policyRevision: -0.5 }), parser: "malformed" },
  { name: "revision string '1'", record: REC({ policyRevision: "1" }), parser: "malformed" },
  { name: "revision boolean", record: REC({ policyRevision: true }), parser: "malformed" },
  { name: "revision object", record: REC({ policyRevision: { n: 1 } }), parser: "malformed" },
  // minStorageProtocol
  { name: "fractional protocol 2.5", record: REC({ minStorageProtocol: 2.5 }), parser: "malformed" },
  { name: "protocol zero", record: REC({ minStorageProtocol: 0 }), parser: "malformed" },
  { name: "protocol negative", record: REC({ minStorageProtocol: -2 }), parser: "malformed" },
  { name: "unsafe protocol MAX_SAFE_INTEGER+1", record: REC({ minStorageProtocol: MAX + 1 }), parser: "malformed" },
  { name: "protocol string '2'", record: REC({ minStorageProtocol: "2" }), parser: "malformed" },
  { name: "protocol boolean", record: REC({ minStorageProtocol: true }), parser: "malformed" },
  // allowV2Initialization × phase
  { name: "legacy + allowV2Initialization=true", record: REC({ allowV2Initialization: true }), parser: "malformed" },
  { name: "quiesced + allowV2Initialization=true", record: REC({ phase: "quiesced", operation: OP(), allowV2Initialization: true }), parser: "malformed" },
  { name: "recovery_hold + allowV2Initialization=true", record: REC({ phase: "recovery_hold", operation: OP({ kind: "recovery" }), allowV2Initialization: true }), parser: "malformed" },
  { name: "allowV2Initialization string 'false'", record: REC({ allowV2Initialization: "false" }), parser: "malformed" },
  { name: "allowV2Initialization string 'true' on v2_active", record: REC({ phase: "v2_active", minStorageProtocol: 2, allowV2Initialization: "true" }), parser: "malformed" },
  { name: "allowV2Initialization number 0", record: REC({ allowV2Initialization: 0 }), parser: "malformed" },
  { name: "allowV2Initialization number 1 on v2_active", record: REC({ phase: "v2_active", minStorageProtocol: 2, allowV2Initialization: 1 }), parser: "malformed" },
  // operation
  { name: "operation scalar string", record: REC({ phase: "quiesced", operation: "op-1" }), parser: "malformed" },
  { name: "operation scalar number", record: REC({ phase: "quiesced", operation: 7 }), parser: "malformed" },
  { name: "operation scalar boolean", record: REC({ phase: "quiesced", operation: true }), parser: "malformed" },
  { name: "operation array", record: REC({ phase: "quiesced", operation: ["op-1", "cutover", "operator", 1] }), parser: "malformed" },
  { name: "operation missing id", record: REC({ phase: "quiesced", operation: drop(OP(), "id") }), parser: "malformed" },
  { name: "operation empty id", record: REC({ phase: "quiesced", operation: OP({ id: "" }) }), parser: "malformed" },
  { name: "operation id number", record: REC({ phase: "quiesced", operation: OP({ id: 12 }) }), parser: "malformed" },
  { name: "operation missing kind", record: REC({ phase: "quiesced", operation: drop(OP(), "kind") }), parser: "malformed" },
  { name: "operation unknown kind", record: REC({ phase: "quiesced", operation: OP({ kind: "cutover_v9" }) }), parser: "malformed" },
  { name: "operation kind number", record: REC({ phase: "quiesced", operation: OP({ kind: 1 }) }), parser: "malformed" },
  { name: "operation missing owner", record: REC({ phase: "quiesced", operation: drop(OP(), "owner") }), parser: "malformed" },
  { name: "operation empty owner", record: REC({ phase: "quiesced", operation: OP({ owner: "" }) }), parser: "malformed" },
  { name: "operation owner object", record: REC({ phase: "quiesced", operation: OP({ owner: { uid: "x" } }) }), parser: "malformed" },
  { name: "operation missing startedAt", record: REC({ phase: "quiesced", operation: drop(OP(), "startedAt") }), parser: "malformed" },
  { name: "operation startedAt fractional", record: REC({ phase: "quiesced", operation: OP({ startedAt: 1.5 }) }), parser: "malformed" },
  { name: "operation startedAt zero", record: REC({ phase: "quiesced", operation: OP({ startedAt: 0 }) }), parser: "malformed" },
  { name: "operation startedAt unsafe", record: REC({ phase: "quiesced", operation: OP({ startedAt: MAX + 1 }) }), parser: "malformed" },
  { name: "operation startedAt string", record: REC({ phase: "quiesced", operation: OP({ startedAt: "1700000000000" }) }), parser: "malformed" },
  { name: "malformed operation on a LEGACY phase record", record: REC({ operation: OP({ kind: "bogus" }) }), parser: "malformed" },
  { name: "malformed operation on a v2_active record", record: REC({ phase: "v2_active", minStorageProtocol: 2, operation: OP({ startedAt: 2.5 }) }), parser: "malformed" },
  // conversionAttempted
  { name: "conversionAttempted string 'true'", record: REC({ conversionAttempted: "true" }), parser: "malformed" },
  { name: "conversionAttempted string 'false'", record: REC({ conversionAttempted: "false" }), parser: "malformed" },
  { name: "conversionAttempted number 1", record: REC({ conversionAttempted: 1 }), parser: "malformed" },
  { name: "conversionAttempted number 0", record: REC({ conversionAttempted: 0 }), parser: "malformed" },
  { name: "conversionAttempted object", record: REC({ conversionAttempted: { v: true } }), parser: "malformed" },
  { name: "conversionAttempted array", record: REC({ conversionAttempted: [true] }), parser: "malformed" },
  { name: "nonboolean conversionAttempted on v2_active", record: REC({ phase: "v2_active", minStorageProtocol: 2, conversionAttempted: "yes" }), parser: "malformed" },
  // combinations
  { name: "fractional revision + fractional protocol", record: REC({ policyRevision: 1.5, minStorageProtocol: 1.5 }), parser: "malformed" },
  { name: "valid quiesced record with revision string", record: REC({ phase: "quiesced", operation: OP(), policyRevision: "2" }), parser: "malformed" },
  { name: "valid v2_active record with unsafe revision", record: REC({ phase: "v2_active", minStorageProtocol: 2, policyRevision: 2 ** 60 }), parser: "malformed" },
];

/** Systematic type mutants of every required field of every valid record (deduplicated). All must be rejected. */
export function generatedMutants() {
  const MUTANT_VALUES = { string: "x", number: 0.5, boolean: true, object: { k: 1 }, array: [1], negative: -1, unsafe: MAX + 1, fraction: 1.5, empty: "" };
  const REQUIRED = ["contractVersion", "phase", "policyRevision", "allowV2Initialization", "minStorageProtocol"];
  const seen = new Set(); const out = [];
  for (const base of VALID_POLICIES) {
    for (const field of REQUIRED) {
      for (const [kind, val] of Object.entries(MUTANT_VALUES)) {
        const rec = { ...base.record, [field]: val };
        // skip mutants that are actually valid under the contract
        if (field === "allowV2Initialization" && val === true && rec.phase === "v2_active") continue;
        if ((field === "policyRevision" || field === "minStorageProtocol") && val === true) { /* boolean → invalid, keep */ }
        const key = JSON.stringify(rec); if (seen.has(key)) continue; seen.add(key);
        out.push({ name: `mutant: ${base.name} / ${field} := ${kind}`, record: rec, parser: field === "contractVersion" && val === 2 ? "unsupported_contract" : "malformed" });
      }
      const missing = { ...base.record }; delete missing[field];
      const key = JSON.stringify(missing); if (!seen.has(key)) { seen.add(key); out.push({ name: `mutant: ${base.name} / ${field} missing`, record: missing, parser: "malformed" }); }
    }
  }
  return out;
}

/** RTDB storage normalisation: drop nulls/undefined and empty objects recursively (what the server would actually hold). */
export function rtdbNormalize(v) {
  if (v === null || v === undefined) return undefined;
  if (Array.isArray(v)) { const o = {}; v.forEach((x, i) => { const n = rtdbNormalize(x); if (n !== undefined) o[i] = n; }); return Object.keys(o).length ? o : undefined; }
  if (typeof v === "object") { const o = {}; for (const [k, x] of Object.entries(v)) { const n = rtdbNormalize(x); if (n !== undefined) o[k] = n; } return Object.keys(o).length ? o : undefined; }
  return v;
}
