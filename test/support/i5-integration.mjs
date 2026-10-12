// Agent/Daily integration I5 — the exact-identity correction on the integrated candidate (LOCAL author candidate; pending
// independent Codex review and the M1 identity / admin-API / P0 / P1 / user-access owners' acceptance). Sole parent: I4 (e1c432f3).
// It answers the independent I4 review (2026-10-12, CHANGES_REQUIRED, I4-R-01..03) with the APPROVED identity contract only —
// the tenant predicate lib/securityContext.js isValidId (":" allowed) and the business predicate lib/businessRegistry.js
// isRegistryBizId (":" refused); no new normalization, no new policy:
//   lib/bizAccess.js  normalizeAllowedBizIds judges each non-empty entry EXACTLY by isRegistryBizId and keeps it byte for byte
//                     (" bizB " is never trimmed into "bizB"; "biz:B" is refused); "" skipped; exact duplicates collapse
//   api/admin.js      edit-client / delete-client / resend-invite: a present tenant id that isValidId refuses (array, object,
//                     number, forbidden character, control character, >128) → 400 before the super_owner lookup, any reference,
//                     Auth change or e-mail; update-user refuses an invalid scope entry before Phase 4 and revokes from the
//                     user's ACTUAL biz_access entries (stored-scope inputs); eeValidIds' business slot = isRegistryBizId
// Each file's change is a list of exact { from, to } edits of the I4 bytes recorded in i5-integration.json (author tool
// gen-i5-record.py). A pin here is a candidate pin and inherits no approval.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RECORD = JSON.parse(readFileSync(new URL("./i5-integration.json", import.meta.url), "utf8"));
export const I5_STATUS = "CANDIDATE (Agent/Daily integration I5, exact-identity correction) — pending independent Codex review; M1 identity / admin-API / P0 / P1 / user-access owner acceptance PROPOSED";
export const I5_PARENT = RECORD.parent;
export const I5_PINS = Object.freeze({ ...RECORD.pins });
export const I5_NEW_FILES = Object.freeze([...RECORD.newFiles]);
export const I5_EDITS = Object.freeze(RECORD.edits);
export const I5_SCOPE = Object.freeze(["api/admin.js", "lib/bizAccess.js"]);

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
/** The I5 tree: the I4 candidate is a STRICT ancestor of HEAD. */
export function isI5Tree(repo) {
  if (git(repo, ["merge-base", "--is-ancestor", I5_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== I5_PARENT;
}
const parentBytes = (repo, f) => { const r = git(repo, ["cat-file", "blob", `${I5_PARENT}:${f}`], { encoding: "buffer" }); if (r.status !== 0) throw new Error(`${I5_PARENT}:${f}`); return r.stdout; };

/** Apply the recorded I5 edits of `file` to `bytes`, in order; each `from` must occur exactly once when it applies. */
export function applyI5Edits(file, bytes, edits = I5_EDITS) {
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
export function deriveI5(repo, file, edits = I5_EDITS) { return applyI5Edits(file, parentBytes(repo, file), edits); }
