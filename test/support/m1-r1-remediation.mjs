// M1 integration R1 remediation (LOCAL; pending independent Codex review) — the identity of the successor of the REJECTED
// M1 candidate. Never derived from HEAD: every identity below is a literal recorded in m1-r1-remediation.json.
//
//   M1_R1_PARENT   the rejected M1 integration candidate (M1_INTEGRATION_VERDICT: CHANGES_REQUIRED). It is the SOLE parent
//                  of the R1 commit; its tree is held to the M1 pins (M1G-01/02 read it from git objects).
//   M1_R1_PINS     the literal blob of EVERY protected runtime file the R1 commit changes relative to the parent. Every
//                  other protected file keeps its M1 pin.
//   M1_R1_EDITS    the recorded, exact edits that turn each changed parent blob into its R1 pin: an ordered list of
//                  { from, to } replacements, each `from` occurring EXACTLY ONCE in the parent bytes. A new file has no
//                  edits (its pin is its identity). R1G-02 re-derives every pin from the parent's git objects.
//
// A changed pin is a new candidate and inherits no approval.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { M1_PINS } from "./m1-integration-pin.mjs";
import { m1PageVerdict } from "./m1-index-scope.mjs";
// M1 R2 (successor of the rejected R1 candidate): its pins overlay the M1 ⊕ R1 pins on an R2 tree, and its page is the R1 page
// + exactly the recorded R2 page edits (test/support/m1-r2-remediation.mjs).
import { isM1R2Tree, M1_R2_PINS, applyR2Edits } from "./m1-r2-remediation.mjs";
// M1 R3 (successor of the rejected R2 candidate): its pins overlay the M1 ⊕ R1 ⊕ R2 pins on an R3 tree, and its page is the R2
// page + exactly the recorded R3 page edits (test/support/m1-r3-remediation.mjs).
import { isM1R3Tree, M1_R3_PINS, applyR3Edits } from "./m1-r3-remediation.mjs";
// M1 R4 (successor of the rejected R3 candidate): its pins overlay the M1 ⊕ R1 ⊕ R2 ⊕ R3 pins on an R4 tree, and its page is
// the R3 page + exactly the recorded R4 page edits (test/support/m1-r4-remediation.mjs).
import { isM1R4Tree, M1_R4_PINS, applyR4Edits } from "./m1-r4-remediation.mjs";
// M1 R5 (successor of the rejected R4 candidate): its ONE pin (the nightly builder) overlays the M1 ⊕ R1 ⊕ R2 ⊕ R3 ⊕ R4 pins on
// an R5 tree (test/support/m1-r5-remediation.mjs). R5 changes no page byte.
import { isM1R5Tree, M1_R5_PINS } from "./m1-r5-remediation.mjs";
// DE1 (daily e-mail delivery reliability, built on the R1 candidate): its pins overlay the M1 ⊕ R1 pins on a DE1 tree.
// DE1 R1 (its successor) overlays DE1 in turn: de1EffectivePins.
import { isDE1Tree, de1EffectivePins } from "./de1-daily-email.mjs";
// Agent/Daily integration I1 (on the merge of the two lineages): its two pins (the route that consumes buildSnapshotRun, and the
// page that carries the owner-notice UI) overlay everything below on an I1 tree; its page is the M1 R5 page + exactly the
// recorded UI edits (test/support/i1-integration.mjs). Candidate pins, pending independent review.
import { isI1Tree, I1_PINS, applyI1Edits } from "./i1-integration.mjs";
// I2 (Agent/Daily integration I2, PROPOSED page-layer transition): the I2 page layer overlays the I1 page (index.html only).
import { isI2Tree, I2_PINS, applyI2Edits } from "./i2-integration.mjs";
// I3 (Agent/Daily integration I3 — the M1 D-CTRL shared-predicate layer, PROPOSED for the M1 identity owner and the page owner):
// overlays lib/securityContext.js, lib/businessRegistry.js and the page's registry-rule mirror.
import { isI3Tree, I3_PINS, applyI3Edits } from "./i3-integration.mjs";
// I4 (Agent/Daily integration I4 — the M1 D-CTRL application-boundary layer, PROPOSED for the M1 identity / admin-API / P0 / P1
// owners): overlays api/admin.js, lib/helpers.js, lib/businessRegistry.js and lib/bizAccess.js. No page byte.
import { isI4Tree, I4_PINS } from "./i4-integration.mjs";
// I5 (Agent/Daily integration I5 — the exact-identity correction, PROPOSED for the M1 identity / admin-API / P0 / P1 / user-access
// owners): overlays api/admin.js and lib/bizAccess.js. No page byte.
import { isI5Tree, I5_PINS } from "./i5-integration.mjs";
// I6 (Agent/Daily integration I6 — registry binding of grants and consumers, the shared business-slot predicate and the update-user
// ordering, PROPOSED for the M1 identity / user-access / admin-API / P0 / P1 / consumer owners): overlays api/admin.js,
// lib/securityContext.js (+ .d.ts) and the three consumer routes. No page byte.
import { isI6Tree, I6_PINS } from "./i6-integration.mjs";
// I7 (Agent/Daily integration I7 — Admin-local registry binding and update-user Auth alignment, PROPOSED for the P0 / admin-API,
// M1 identity and user-access owners): overlays api/admin.js only. No page byte.
import { isI7Tree, I7_PINS } from "./i7-integration.mjs";
// HR1 (Daily-only delivery hold on I7 — PROPOSED for the delivery-runtime / route, P0 and M1 integration owners): overlays
// api/daily-snapshot/run.ts and lib/emailDelivery.js (+ .d.ts). No page byte.
import { isHR1Tree, HR1_PINS } from "./hr1-daily-hold.mjs";
import { isHR2Tree, HR2_PINS } from "./hr2-daily-hold.mjs";
import { isHR3Tree, HR3_PINS } from "./hr3-daily-hold.mjs";
import { isHR3S1Tree, HR3S1_PINS } from "./hr3-s1-daily-hold.mjs";
import { isHR3S3Tree, HR3S3_PINS } from "./hr3-s3-daily-hold.mjs";
import { isHR3OT1Tree, HR3OT1_PINS } from "./hr3-ot1-daily-hold.mjs";
import { isHR3OT2Tree, HR3OT2_PINS } from "./hr3-ot2-daily-hold.mjs";
import { isHR3S2Tree, HR3S2_PINS } from "./hr3-s2-daily-hold.mjs";

const RECORD = JSON.parse(readFileSync(new URL("./m1-r1-remediation.json", import.meta.url), "utf8"));
export const M1_R1_PARENT = RECORD.parent;
export const M1_R1_STATUS = "CANDIDATE (M1 integration R1 remediation) — pending independent Codex review";
export const M1_R1_PINS = Object.freeze({ ...RECORD.pins });
export const M1_R1_NEW_FILES = Object.freeze([...RECORD.newFiles]);
export const M1_R1_EDITS = Object.freeze(RECORD.edits);

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
/** The R1 successor tree: the rejected candidate is a STRICT ancestor of HEAD. */
export function isM1R1Tree(repo) {
  if (git(repo, ["merge-base", "--is-ancestor", M1_R1_PARENT, "HEAD"]).status !== 0) return false;
  return git(repo, ["rev-parse", "HEAD"]).stdout.trim() !== M1_R1_PARENT;
}
/** The pins that hold the tree under test: the M1 pins, with the R1 pins (and new files) overlaid on an R1 tree, the R2
 *  pins overlaid on an R2 tree (an R2 tree is always an R1 tree), and the R3 pins overlaid on an R3 tree (always an R2 tree).
 *  INTEGRATION (I1, merge of delivery R8 onto the M1 R5 lineage): the DE1 lineage forks from M1 R1, so a tree that carries
 *  both lineages overlays the M1 R2..R5 pins (page, registry, analytics builder, admin) AND the DE1 pins (the delivery
 *  files). The two pin sets are disjoint by path (the delivery files are not M1 R2..R5 pins and vice versa), so the order
 *  of the overlay cannot hide a pin of either lineage. */
/** `withI3: false` = the effective table of the tree WITHOUT the I3 D-CTRL overlay (the I1 / I2 commits' own tables, I3 layering);
 *  it also drops every later overlay. `withI4: false` = WITHOUT the I4 boundary overlay (the I3 commit's own table, I4 layering);
 *  `withI5: false` = WITHOUT the I5 exact-identity overlay (the I4 commit's own table, I5 layering); `withI6: false` = WITHOUT the
 *  I6 registry-binding overlay (the I5 commit's own table, I6 layering); `withI7: false` = WITHOUT the I7 overlay (the I6 commit's
 *  own table, I7 layering); `withHR1: false` = WITHOUT the HR1 overlay (the I7 commit's own table, HR1 layering). */
export function m1EffectivePins(repo, { withI3 = true, withI4 = withI3, withI5 = withI4, withI6 = withI5, withI7 = withI6,
  withHR1 = withI7, withHR2 = withHR1, withHR3 = withHR2, withHR3S1 = withHR3, withHR3S2 = withHR3S1, withHR3S3 = withHR3S2, withHR3OT1 = withHR3S3, withHR3OT2 = withHR3OT1 } = {}) {
  if (!isM1R1Tree(repo)) return { ...M1_PINS.blobs };
  const de1 = isDE1Tree(repo) ? de1EffectivePins(repo) : {};
  const i1 = isI1Tree(repo) ? { ...I1_PINS, ...(isI2Tree(repo) ? I2_PINS : {}), ...(withI3 && isI3Tree(repo) ? I3_PINS : {}), ...(withI3 && withI4 && isI4Tree(repo) ? I4_PINS : {}), ...(withI3 && withI4 && withI5 && isI5Tree(repo) ? I5_PINS : {}), ...(withI3 && withI4 && withI5 && withI6 && isI6Tree(repo) ? I6_PINS : {}), ...(withI3 && withI4 && withI5 && withI6 && withI7 && isI7Tree(repo) ? I7_PINS : {}), ...(withI3 && withI4 && withI5 && withI6 && withI7 && withHR1 && isHR1Tree(repo) ? HR1_PINS : {}),
    ...(withI3 && withI4 && withI5 && withI6 && withI7 && withHR1 && withHR2 && isHR2Tree(repo) ? HR2_PINS : {}),
    ...(withI3 && withI4 && withI5 && withI6 && withI7 && withHR1 && withHR2 && withHR3 && isHR3Tree(repo) ? HR3_PINS : {}),
    ...(withI3 && withI4 && withI5 && withI6 && withI7 && withHR1 && withHR2 && withHR3 && withHR3S1 && isHR3S1Tree(repo) ? HR3S1_PINS : {}),
    ...(withI3 && withI4 && withI5 && withI6 && withI7 && withHR1 && withHR2 && withHR3 && withHR3S1 && withHR3S2 && isHR3S2Tree(repo) ? HR3S2_PINS : {}),
    ...(withI3 && withI4 && withI5 && withI6 && withI7 && withHR1 && withHR2 && withHR3 && withHR3S1 && withHR3S2 && withHR3S3 && isHR3S3Tree(repo) ? HR3S3_PINS : {}),
    ...(withI3 && withI4 && withI5 && withI6 && withI7 && withHR1 && withHR2 && withHR3 && withHR3S1 && withHR3S2 && withHR3S3 && withHR3OT1 && isHR3OT1Tree(repo) ? HR3OT1_PINS : {}),
    ...(withI3 && withI4 && withI5 && withI6 && withI7 && withHR1 && withHR2 && withHR3 && withHR3S1 && withHR3S2 && withHR3S3 && withHR3OT1 && withHR3OT2 && isHR3OT2Tree(repo) ? HR3OT2_PINS : {}) } : {};   // each successor overlays only its own protected files
  if (!isM1R2Tree(repo)) return { ...M1_PINS.blobs, ...M1_R1_PINS, ...de1, ...i1 };
  if (!isM1R3Tree(repo)) return { ...M1_PINS.blobs, ...M1_R1_PINS, ...M1_R2_PINS, ...de1, ...i1 };
  if (isM1R5Tree(repo)) return { ...M1_PINS.blobs, ...M1_R1_PINS, ...M1_R2_PINS, ...M1_R3_PINS, ...M1_R4_PINS, ...M1_R5_PINS, ...de1, ...i1 };
  return isM1R4Tree(repo) ? { ...M1_PINS.blobs, ...M1_R1_PINS, ...M1_R2_PINS, ...M1_R3_PINS, ...M1_R4_PINS, ...de1, ...i1 } : { ...M1_PINS.blobs, ...M1_R1_PINS, ...M1_R2_PINS, ...M1_R3_PINS, ...de1, ...i1 };
}
/** The pins of the R5 commit itself (M1 ⊕ R1 … ⊕ R5), whatever later layer is checked out (CF-04 layering, I1). */
export function m1R5Pins() { return { ...M1_PINS.blobs, ...M1_R1_PINS, ...M1_R2_PINS, ...M1_R3_PINS, ...M1_R4_PINS, ...M1_R5_PINS }; }
/** The pins of the R4 commit itself (M1 ⊕ R1 ⊕ R2 ⊕ R3 ⊕ R4), whatever later layer is checked out. */
export function m1R4Pins() { return { ...M1_PINS.blobs, ...M1_R1_PINS, ...M1_R2_PINS, ...M1_R3_PINS, ...M1_R4_PINS }; }
/** The pins of the R3 commit itself (M1 ⊕ R1 ⊕ R2 ⊕ R3), whatever later layer is checked out. */
export function m1R3Pins() { return { ...M1_PINS.blobs, ...M1_R1_PINS, ...M1_R2_PINS, ...M1_R3_PINS }; }
/** The pins of the R2 commit itself (M1 ⊕ R1 ⊕ R2), whatever later layer is checked out. */
export function m1R2Pins() { return { ...M1_PINS.blobs, ...M1_R1_PINS, ...M1_R2_PINS }; }
/** The pins of the R1 commit itself (M1 ⊕ R1), whatever later layer is checked out. */
export function m1R1Pins() { return { ...M1_PINS.blobs, ...M1_R1_PINS }; }
export const gitBlobId = (buf) => { const h = createHash("sha1"); h.update(`blob ${buf.length}\0`); h.update(buf); return h.digest("hex"); };
const parentBytes = (repo, f) => { const r = git(repo, ["cat-file", "blob", `${M1_R1_PARENT}:${f}`], { encoding: "buffer" }); if (r.status !== 0) throw new Error(`${M1_R1_PARENT}:${f}`); return r.stdout; };

/**
 * Apply the recorded R1 edits of `file` to `bytes` (Buffer|string). Every `from` must occur exactly once at application time.
 * Returns { ok:true, bytes } or { ok:false, reason, detail }.
 */
export function applyR1Edits(file, bytes, edits = M1_R1_EDITS) {
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
/** Re-derive the R1 blob of `file` from the parent's git objects. */
export function deriveR1(repo, file, edits = M1_R1_EDITS) {
  return applyR1Edits(file, parentBytes(repo, file), edits);
}

/**
 * The page contract of the tree under test. On a plain M1 tree: the M1 contract (m1PageVerdict). On an R1 tree: the parent page
 * must satisfy the M1 contract (it is the recorded derivation, with both lines' invariants), and the candidate bytes must be
 * EXACTLY that page with the recorded R1 page edits applied — nothing else.
 */
/** `withLaterLayers: false` judges a HISTORICAL page (the R4 / R5 commit's own) against the M1 derivation without the I1 page
 *  edits — the layered positive controls of the M1 guards (I1 layering transition). */
export function m1EffectivePageVerdict(repo, candidateBytes, edits = M1_R1_EDITS, { withLaterLayers = true } = {}) {
  if (!isM1R1Tree(repo)) return m1PageVerdict(repo, candidateBytes);
  const parent = parentBytes(repo, "index.html");
  const base = m1PageVerdict(repo, parent);
  if (!base.ok) return { ok: false, reason: "r1_parent_page_not_m1", detail: base };
  const d = applyR1Edits("index.html", parent, edits);
  if (!d.ok) return d;
  // R2 tree: the candidate page is the R1 page + exactly the recorded R2 page edits
  let want = d.bytes;
  if (isM1R2Tree(repo)) { const d2 = applyR2Edits("index.html", d.bytes); if (!d2.ok) return d2; want = d2.bytes; }
  // R3 tree: … + exactly the recorded R3 page edits on top of the R2 page
  if (isM1R3Tree(repo)) { const d3 = applyR3Edits("index.html", want); if (!d3.ok) return d3; want = d3.bytes; }
  // R4 tree: … + exactly the recorded R4 page edits on top of the R3 page
  if (isM1R4Tree(repo)) { const d4 = applyR4Edits("index.html", want); if (!d4.ok) return d4; want = d4.bytes; }
  // I1 tree: … + exactly the recorded owner-notice UI edits (carried with the route they depend on); R5 changed no page byte
  if (withLaterLayers && isI1Tree(repo)) { const di = applyI1Edits("index.html", want); if (!di.ok) return di; want = di.bytes; }
  // I2 tree: … + exactly the recorded I2 page edit (the entries hydration defined before its listener is registered)
  if (withLaterLayers && isI2Tree(repo)) { const d2 = applyI2Edits("index.html", want); if (!d2.ok) return d2; want = d2.bytes; }
  // I3 tree: … + exactly the recorded I3 page edit (the registry-rule mirror refuses control characters, = isRegistryBizId)
  if (withLaterLayers && isI3Tree(repo)) { const d3 = applyI3Edits("index.html", want); if (!d3.ok) return d3; want = d3.bytes; }
  const B = Buffer.isBuffer(candidateBytes) ? candidateBytes : Buffer.from(String(candidateBytes), "utf8");
  if (!want.equals(B)) return { ok: false, reason: "not_the_recorded_derivation" };
  return { ok: true };
}
