// Agent/Daily integration I7 — the successor required by the independent I6 review (2026-10-13, CHANGES_REQUIRED, I6-R-01 / 02 / 04) on
// the integrated candidate (LOCAL author candidate; pending independent Codex review and the P0 / admin-API, M1 identity / registry,
// user-access and production-readiness audit owners' acceptance). Sole parent: I6 (224a00a6). The APPROVED contracts only — the
// business predicate isRegistryBizId, the authoritative registry rule classifyRegistryTarget / readRegistryTarget with the P1 response
// mapping (scRequireRegisteredBusiness), and update-user's existing compensation; no new policy:
//   api/admin.js   (protected) the Admin-local business-data authorizations — list-entry-exceptions, eeAuthorizeWrite (set / clear),
//                  bizDataAuthRead / bizDataAuthWrite (checklist template / run / simple run, analytics / insights daily) — require the
//                  exact business to be registered (ONE registry read) after the tenant / role / biz_access decision and before any
//                  business data; update-user ESTABLISHES the Auth outcome after an Auth error (getUser) and undoes an applied change with
//                  the existing revert, and recognises a revert that applied despite an error — unconfirmed outcomes are logged, their
//                  recovery is the owner decision D-I7-01
//   docs/production-readiness/lib/biz-access-model.mjs   (outside the protected set) the audit classifies the ORIGINAL raw registry node
// NOT in I7: the operator backfill (I6-R-03). scripts/backfill-biz-access.mjs is a stored-data script under the S0 server-reader /
// VAT-invariant protection and NEXT_WORK item 3 leaves the gate to the P1 / user-access / operations owners — its bounded successor
// is a separate proposed lane (package proposed/backfill-registry-gate.patch); I7G-04 holds the script at its I6 bytes.
// Each protected file's change is a list of exact { from, to } edits of the I6 bytes recorded in i7-integration.json (author tool
// gen-i7-record.py). A pin here is a candidate pin and inherits no approval.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RECORD = JSON.parse(readFileSync(new URL("./i7-integration.json", import.meta.url), "utf8"));
export const I7_STATUS = "CANDIDATE (Agent/Daily integration I7, Admin-local registry binding + audit parity + update-user Auth alignment) — pending independent Codex review; P0 / admin-API / M1 identity / user-access / audit owner acceptance PROPOSED";
export const I7_PARENT = RECORD.parent;
export const I7_PINS = Object.freeze({ ...RECORD.pins });
export const I7_NEW_FILES = Object.freeze([...RECORD.newFiles]);
export const I7_EDITS = Object.freeze(RECORD.edits);
export const I7_SCOPE = Object.freeze(["api/admin.js"]);
/** Outside the protected set, the only non-test files I7 changes (each with its own transition). */
export const I7_UNPROTECTED = Object.freeze(["docs/production-readiness/lib/biz-access-model.mjs", "docs/production-readiness/test/biz-access-audit.test.mjs"]);

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
/** The I7 tree: the I6 candidate is a STRICT ancestor of HEAD. */
export function isI7Tree(repo) {
  if (git(repo, ["merge-base", "--is-ancestor", I7_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== I7_PARENT;
}
const parentBytes = (repo, f) => { const r = git(repo, ["cat-file", "blob", `${I7_PARENT}:${f}`], { encoding: "buffer" }); if (r.status !== 0) throw new Error(`${I7_PARENT}:${f}`); return r.stdout; };

/** Apply the recorded I7 edits of `file` to `bytes`, in order; each `from` must occur exactly once when it applies. */
export function applyI7Edits(file, bytes, edits = I7_EDITS) {
  const list = edits[file];
  if (!Array.isArray(list) || list.length === 0) return { ok: false, reason: "no_recorded_edits", detail: file };
  let s = Buffer.isBuffer(bytes) ? bytes.toString("utf8") : String(bytes);
  for (const [k, e] of list.entries()) {
    if (typeof e.from !== "string" || typeof e.to !== "string" || e.from === "") return { ok: false, reason: "edit_shape", detail: `${file}#${k}` };
    if (s.split(e.from).length !== 2) return { ok: false, reason: "edit_anchor_not_unique", detail: `${file}#${k}` };
    s = s.replace(e.from, () => e.to);
  }
  return { ok: true, bytes: Buffer.from(s, "utf8") };
}
export function deriveI7(repo, file, edits = I7_EDITS) { return applyI7Edits(file, parentBytes(repo, file), edits); }
