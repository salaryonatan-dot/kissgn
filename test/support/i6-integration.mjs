// Agent/Daily integration I6 — the registry-binding successor on the integrated candidate (LOCAL author candidate; pending
// independent Codex review and the M1 identity / user-access / admin-API / P0 / P1 / audit / consumer owners' acceptance). Sole
// parent: I5 (59b87a6a). It answers the independent I5 review (2026-10-12, CHANGES_REQUIRED, I5-R-01..04) with the APPROVED M1
// contract only — the business predicate lib/businessRegistry.js isRegistryBizId and the authoritative target-scoped registry rule
// classifyRegistryTarget / readRegistryTarget; no new normalization, no new product policy:
//   api/admin.js              create-user / update-user / roles grant a business ONLY when ONE registry snapshot classifies the
//                             exact requested id `registered` (ambiguous / not_registered / unreadable / unavailable refused with
//                             the approved registry mapping) — before Auth creation / the Auth e-mail change / any write;
//                             update-user prepares its whole RTDB update (incl. the actual-grant read) BEFORE the Auth e-mail
//                             change; create-user reads app/users before creating the Auth user
//   lib/securityContext.js    requireBizContext judges the business slot by isRegistryBizId (tenant slot unchanged); new
//                             requireRegisteredBizContext = requireBizContext + the authoritative registration (one read)
//   lib/securityContext.d.ts  its declaration
//   api/alerts/run.ts, api/agent/ask.ts, api/proactive/run.ts   inject / call requireRegisteredBizContext (Cost History and the
//                             Daily manual send keep requireBizContext: each already applies the same registry rule itself)
// Each file's change is a list of exact { from, to } edits of the I5 bytes recorded in i6-integration.json (author tool
// gen-i6-record.py). A pin here is a candidate pin and inherits no approval.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RECORD = JSON.parse(readFileSync(new URL("./i6-integration.json", import.meta.url), "utf8"));
export const I6_STATUS = "CANDIDATE (Agent/Daily integration I6, registry binding + shared business gate + update-user ordering) — pending independent Codex review; M1 identity / user-access / admin-API / P0 / P1 / audit / consumer owner acceptance PROPOSED";
export const I6_PARENT = RECORD.parent;
export const I6_PINS = Object.freeze({ ...RECORD.pins });
export const I6_NEW_FILES = Object.freeze([...RECORD.newFiles]);
export const I6_EDITS = Object.freeze(RECORD.edits);
export const I6_SCOPE = Object.freeze(["api/admin.js", "api/agent/ask.ts", "api/alerts/run.ts", "api/proactive/run.ts", "lib/securityContext.d.ts", "lib/securityContext.js"]);

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
/** The I6 tree: the I5 candidate is a STRICT ancestor of HEAD. */
export function isI6Tree(repo) {
  if (git(repo, ["merge-base", "--is-ancestor", I6_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== I6_PARENT;
}
const parentBytes = (repo, f) => { const r = git(repo, ["cat-file", "blob", `${I6_PARENT}:${f}`], { encoding: "buffer" }); if (r.status !== 0) throw new Error(`${I6_PARENT}:${f}`); return r.stdout; };

/** Apply the recorded I6 edits of `file` to `bytes`, in order; each `from` must occur exactly once when it applies. */
export function applyI6Edits(file, bytes, edits = I6_EDITS) {
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
export function deriveI6(repo, file, edits = I6_EDITS) { return applyI6Edits(file, parentBytes(repo, file), edits); }
