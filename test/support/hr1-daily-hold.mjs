// HR1 — the Daily-only delivery hold (LOCAL author candidate; pending independent Codex review and the delivery-runtime / route,
// P0, Rules, test and M1 integration owners' technical acceptance, T-HR1-*). Sole parent: I7 (5bae812c, preserved unchanged; itself
// under independent review). It implements the owner-approved Daily-only stop mechanism (2026-10-14: complete it before pilot;
// no automatic sending of held-day summaries after release) on the operational r2 specification, corrected for the independent
// findings OP-R1..R3. The DE1 receipt contract (MARJIN_EMAIL_RECEIPT/1) is unchanged: no new receipt state, no format change.
//   lib/emailDelivery.js (+ .d.ts)   (protected: lib/) the hold record (one node, one transaction per change, fail closed), the
//                                    scheduled gate G0 / G3 inside deliverWithReceipt (no attempt consumed), the held-date marker,
//                                    deliverManualDaily (G3 + the durable manual-attempt record before the hand-off)
//   api/daily-snapshot/run.ts        (protected: api/) G1 after the read-only build, the per-message gate, the "held" settlement and
//                                    run status, G2 before the manual build, the manual 503 mappings; the authorization section
//                                    is byte-identical (the P0 bytes)
// Outside the protected set: tools/daily-delivery/hold.mjs (the operator tool: status / evidence / init / hold / release).
// Each protected file's change is a list of exact { from, to } edits of the I7 bytes recorded in hr1-daily-hold.json (author tool
// gen-hr1-record.py). A pin here is a candidate pin and inherits no approval.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";

const RECORD = JSON.parse(readFileSync(new URL("./hr1-daily-hold.json", import.meta.url), "utf8"));
export const HR1_STATUS = "CANDIDATE (Daily-only delivery hold HR1 on I7) — pending independent Codex review; delivery / route / P0 / Rules / test / M1 integration owner acceptance (T-HR1-*) PROPOSED";
export const HR1_PARENT = RECORD.parent;
export const HR1_PINS = Object.freeze({ ...RECORD.pins });
export const HR1_NEW_FILES = Object.freeze([...RECORD.newFiles]);
export const HR1_EDITS = Object.freeze(RECORD.edits);
export const HR1_SCOPE = Object.freeze(["api/daily-snapshot/run.ts", "lib/emailDelivery.d.ts", "lib/emailDelivery.js"]);
/** Outside the protected set, the only non-test file HR1 adds. */
export const HR1_UNPROTECTED = Object.freeze(["tools/daily-delivery/hold.mjs"]);

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
/** The HR1 tree: the I7 candidate is a STRICT ancestor of HEAD. */
export function isHR1Tree(repo) {
  if (git(repo, ["merge-base", "--is-ancestor", HR1_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== HR1_PARENT;
}
const parentBytes = (repo, f) => { const r = git(repo, ["cat-file", "blob", `${HR1_PARENT}:${f}`], { encoding: "buffer" }); if (r.status !== 0) throw new Error(`${HR1_PARENT}:${f}`); return r.stdout; };

/** Apply the recorded HR1 edits of `file` to `bytes`, in order; each `from` must occur exactly once when it applies. */
export function applyHR1Edits(file, bytes, edits = HR1_EDITS) {
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
export function deriveHR1(repo, file, edits = HR1_EDITS) { return applyHR1Edits(file, parentBytes(repo, file), edits); }
