// RF3 — the Rules-owner acceptance RECORD validator (closes the independent RF2 review's RF2-R-03 for the validator; T-RF3-RECORD).
// The proposed publication re-pin (a PACKAGE artifact, never applied here) gives canary-fixtures.mjs a structured
// RULES_OWNER_ACCEPTANCE record (P-1) and moves APPROVED_RULES_BLOB to its rulesBlob. RF2's proposed RV-G01 iterated only the fields
// that EXIST, accepted any 64-hex rulesSha256 and validated acceptedAt by shape and string order. This module is the committed,
// tested contract a P-2 successor's RV-G01 calls instead:
//   - every one of the eight reviewed fields is REQUIRED, a non-empty string and no placeholder (<…>, TBD, TODO, placeholder);
//   - rulesBlob names a git blob that is PRESENT, and rulesSha256 equals the SHA-256 of THAT blob's exact bytes;
//   - acceptedAt is a real calendar date (YYYY-MM-DD, round-trips through Date.UTC) and not after `today` (UTC date, as proposed);
//   - the independent reviewer is not the acceptor (compared trimmed, case-folded, whitespace-collapsed);
//   - the scope names the accepted blob (its first eight hex digits), as proposed.
// It checks the SHAPE and the BYTES of a record. It cannot establish that a person accepted anything: the identity and authority of
// acceptedBy / reviewedBy and the existence of recordRef / reviewRef are for the independent reviewer of the P-2 successor to verify
// against the actual record (RELEASE_GATES P-1). No record is filled in this repository; nothing here is an acceptance, and
// publication stays pending (acceptanceRecordStatus never reports publication).
import { createHash } from "node:crypto";
import { spawnSync } from "node:child_process";

/** The reviewed record schema (RF2's proposed RULES_OWNER_ACCEPTANCE), all REQUIRED. */
export const ACCEPTANCE_FIELDS = Object.freeze(["rulesBlob", "rulesSha256", "acceptedBy", "acceptedAt", "scope", "recordRef", "reviewedBy", "reviewRef"]);
export const PLACEHOLDER = /[<>]|TBD|TODO|placeholder/i;

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const gitBlobId = (bytes) => createHash("sha1").update(Buffer.concat([Buffer.from(`blob ${bytes.length}\0`), bytes])).digest("hex");
const person = (s) => s.trim().replace(/\s+/g, " ").toLowerCase();

/** A blob reader over a git repository: the exact bytes of `id`, or null when the object is absent / not a blob. */
export function gitBlobReader(repo) {
  return (id) => {
    const t = spawnSync("git", ["-C", repo, "cat-file", "-t", id], { encoding: "utf8" });
    if (t.status !== 0 || t.stdout.trim() !== "blob") return null;
    const r = spawnSync("git", ["-C", repo, "cat-file", "blob", id], { maxBuffer: 1 << 28 });
    return r.status === 0 ? r.stdout : null;
  };
}

/** Strict calendar date: YYYY-MM-DD that round-trips (rejects 2026-02-31, 2025-02-29, month 00 / 13, day 00). */
export function isCalendarDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const t = new Date(Date.UTC(y, mo - 1, d));
  return t.getUTCFullYear() === y && t.getUTCMonth() === mo - 1 && t.getUTCDate() === d;
}

/**
 * Validate a Rules-owner acceptance record. `readBlob(id)` returns the exact bytes of a git blob or null; `today` is "YYYY-MM-DD"
 * (default: the current UTC date, as RF2's proposal used). Returns { ok: true } or { ok: false, problems: [{ field, code }] } —
 * every problem, not only the first.
 */
export function validateRulesOwnerAcceptance(record, { readBlob, today = new Date().toISOString().slice(0, 10) } = {}) {
  if (typeof readBlob !== "function") throw new TypeError("validateRulesOwnerAcceptance: readBlob is required (the accepted bytes are checked)");
  if (!isCalendarDate(today)) throw new TypeError("validateRulesOwnerAcceptance: today must be a calendar date");
  const problems = [];
  const bad = (field, code) => problems.push({ field, code });
  if (!record || typeof record !== "object" || Array.isArray(record)) return { ok: false, problems: [{ field: "*", code: "not_a_record" }] };
  const usable = {};
  for (const f of ACCEPTANCE_FIELDS) {
    if (!Object.hasOwn(record, f)) { bad(f, "missing"); continue; }
    const v = record[f];
    if (typeof v !== "string") { bad(f, "not_a_string"); continue; }
    if (!v.trim()) { bad(f, "empty"); continue; }
    if (PLACEHOLDER.test(v)) { bad(f, "placeholder"); continue; }
    usable[f] = v;
  }
  let bytes = null;
  if (usable.rulesBlob !== undefined) {
    if (!/^[0-9a-f]{40}$/.test(usable.rulesBlob)) bad("rulesBlob", "not_a_blob_id");
    else if ((bytes = readBlob(usable.rulesBlob)) === null) bad("rulesBlob", "blob_unavailable");
    else if (gitBlobId(bytes) !== usable.rulesBlob) { bad("rulesBlob", "blob_bytes_mismatch"); bytes = null; }
  }
  if (usable.rulesSha256 !== undefined) {
    if (!/^[0-9a-f]{64}$/.test(usable.rulesSha256)) bad("rulesSha256", "not_a_sha256");
    else if (bytes !== null && sha256(bytes) !== usable.rulesSha256) bad("rulesSha256", "sha256_mismatch");
    else if (bytes === null && usable.rulesBlob !== undefined) bad("rulesSha256", "unverifiable");   // never accepted unverified
  }
  if (usable.acceptedAt !== undefined) {
    if (!isCalendarDate(usable.acceptedAt)) bad("acceptedAt", "not_a_calendar_date");
    else if (usable.acceptedAt > today) bad("acceptedAt", "in_the_future");
  }
  if (usable.acceptedBy !== undefined && usable.reviewedBy !== undefined && person(usable.acceptedBy) === person(usable.reviewedBy)) bad("reviewedBy", "same_as_acceptor");
  if (usable.scope !== undefined && usable.rulesBlob !== undefined && !usable.scope.includes(usable.rulesBlob.slice(0, 8))) bad("scope", "does_not_name_the_blob");
  return problems.length ? { ok: false, problems } : { ok: true };
}

/**
 * The status of the acceptance record a canary-fixtures module namespace carries — NEVER a publication verdict:
 *   "absent"        no RULES_OWNER_ACCEPTANCE (this repository today: publication pending, the release pin unchanged)
 *   "invalid"       a record that fails validateRulesOwnerAcceptance (problems listed) — an incomplete proposal, not ready for P-2
 *   "pin_mismatch"  a valid record but APPROVED_RULES_BLOB is not its rulesBlob
 *   "complete"      a valid record and the source pin is its rulesBlob: a SOURCE fact only. Whether a person with the authority
 *                   accepted it is verified by the independent reviewer against the actual record; whether the served Rules are this
 *                   blob is observed only by Gate 0 / the hosted canary (RELEASE_GATES). Publication is a separate, authorized act.
 */
export function acceptanceRecordStatus(fixtures, opts) {
  const publication = "pending (not established by any source fact)";
  const A = fixtures && fixtures.RULES_OWNER_ACCEPTANCE;
  if (A === undefined) return { status: "absent", publication };
  const v = validateRulesOwnerAcceptance(A, opts);
  if (!v.ok) return { status: "invalid", problems: v.problems, publication };
  if (fixtures.APPROVED_RULES_BLOB !== A.rulesBlob) return { status: "pin_mismatch", publication };
  return { status: "complete", publication };
}
