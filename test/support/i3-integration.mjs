// Agent/Daily integration I3 — the M1 D-CTRL shared-predicate layer on the integrated candidate (LOCAL author candidate;
// pending independent Codex review and the M1 identity owner's acceptance). Sole parent: I2 (cfe900dd). Implements the
// already-approved owner decision D-CTRL (2026-10-09) at the place the Builder coordination contract §2.3 assigns it:
//   lib/securityContext.js   isValidId        refuses U+0000–U+001F and U+007F (tenant ids and every requireBizContext id)
//   lib/businessRegistry.js  isRegistryBizId  refuses the same characters (business ids: Core, P1, analytics, delivery, Builder)
//   index.html               the page's mirror of the registry rule (C1 registryTargetRegistered, RR-07 browser ≡ server)
//                            refuses the same characters, so the page and the server keep one verdict
// Each change is ONE exact { from, to } edit of the I2 bytes, recorded in i3-integration.json (author tool gen-i3-record.py).
// Nothing is trimmed, replaced, normalized or aliased; every value without such a character keeps its I2 verdict (DC-01).
// A pin here is a candidate pin and inherits no approval.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RECORD = JSON.parse(readFileSync(new URL("./i3-integration.json", import.meta.url), "utf8"));
export const I3_STATUS = "CANDIDATE (Agent/Daily integration I3, M1 D-CTRL layer) — pending independent Codex review; M1 identity-owner and page-owner acceptance PROPOSED";
export const I3_PARENT = RECORD.parent;
export const I3_PINS = Object.freeze({ ...RECORD.pins });
export const I3_NEW_FILES = Object.freeze([...RECORD.newFiles]);
export const I3_EDITS = Object.freeze(RECORD.edits);
export const I3_SCOPE = Object.freeze(["index.html", "lib/businessRegistry.js", "lib/securityContext.js"]);

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
/** The I3 tree: the I2 candidate is a STRICT ancestor of HEAD. */
export function isI3Tree(repo) {
  if (git(repo, ["merge-base", "--is-ancestor", I3_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== I3_PARENT;
}
const parentBytes = (repo, f) => { const r = git(repo, ["cat-file", "blob", `${I3_PARENT}:${f}`], { encoding: "buffer" }); if (r.status !== 0) throw new Error(`${I3_PARENT}:${f}`); return r.stdout; };

/** Apply the recorded I3 edits of `file` to `bytes`; each `from` must occur exactly once when it applies. */
export function applyI3Edits(file, bytes, edits = I3_EDITS) {
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
export function deriveI3(repo, file, edits = I3_EDITS) { return applyI3Edits(file, parentBytes(repo, file), edits); }
