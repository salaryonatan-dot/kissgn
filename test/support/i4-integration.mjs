// Agent/Daily integration I4 — the M1 D-CTRL application-boundary layer on the integrated candidate (LOCAL author candidate;
// pending independent Codex review and the M1 identity / admin-API / P0 / P1 owners' acceptance). Sole parent: I3 (40b8a8a6).
// It answers the independent I3 review (2026-10-12, CHANGES_REQUIRED, I3-R-01): the approved owner decision D-CTRL (2026-10-09)
// — refuse U+0000–U+001F and U+007F in tenant / business identifiers before constructing database references; never trim,
// sanitize, replace or alias — was implemented by I3 in the two shared predicates only. I4 applies the same rule at the
// application boundaries that validate with their own local rules:
//   api/admin.js            edit-client / delete-client / resend-invite (super_owner; presence-only tenant checks): a control
//                           tenant id → 400 after authentication, before the super_owner lookup or any reference;
//                           roles: control tenant id or raw allowedBizIds entry → 400 before the rate limiter or any database call;
//                           create-user / update-user: raw allowedBizIds entry with a control character → 400 before any database
//                           or Auth call; the local tenant checks of delete-user / update-user / bootstrap-self and eeValidIds
//                           (entry exceptions, business-data and analytics/insights reads) gain the control clause (prepared
//                           option B, I3 package)
//   lib/helpers.js          requireTenantAccess: a control tenant id → 400 before any reference (option B)
//   lib/businessRegistry.js readRegistryTarget: a control tenant key → invalid_request before any reference (never `unavailable`)
//   lib/bizAccess.js        normalizeAllowedBizIds: a RAW entry with a control character → 400 BEFORE the trim (no alias)
// Only those characters are added; every other verdict, message, status and ordering is unchanged (DB-14 parity with I3).
// Each file's change is a list of exact { from, to } edits of the I3 bytes recorded in i4-integration.json (author tool
// gen-i4-record.py). A pin here is a candidate pin and inherits no approval.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RECORD = JSON.parse(readFileSync(new URL("./i4-integration.json", import.meta.url), "utf8"));
export const I4_STATUS = "CANDIDATE (Agent/Daily integration I4, M1 D-CTRL application-boundary layer) — pending independent Codex review; M1 identity / admin-API / P0 / P1 owner acceptance PROPOSED";
export const I4_PARENT = RECORD.parent;
export const I4_PINS = Object.freeze({ ...RECORD.pins });
export const I4_NEW_FILES = Object.freeze([...RECORD.newFiles]);
export const I4_EDITS = Object.freeze(RECORD.edits);
export const I4_SCOPE = Object.freeze(["api/admin.js", "lib/bizAccess.js", "lib/businessRegistry.js", "lib/helpers.js"]);

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
/** The I4 tree: the I3 candidate is a STRICT ancestor of HEAD. */
export function isI4Tree(repo) {
  if (git(repo, ["merge-base", "--is-ancestor", I4_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== I4_PARENT;
}
const parentBytes = (repo, f) => { const r = git(repo, ["cat-file", "blob", `${I4_PARENT}:${f}`], { encoding: "buffer" }); if (r.status !== 0) throw new Error(`${I4_PARENT}:${f}`); return r.stdout; };

/** Apply the recorded I4 edits of `file` to `bytes`, in order; each `from` must occur exactly once when it applies. */
export function applyI4Edits(file, bytes, edits = I4_EDITS) {
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
export function deriveI4(repo, file, edits = I4_EDITS) { return applyI4Edits(file, parentBytes(repo, file), edits); }
