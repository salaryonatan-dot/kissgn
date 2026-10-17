// BF1 stored-data-script transition, pending independent Claude review. The S0 protected roots and the six-file reader
// allowlist remain unchanged. Only this separately pinned script may be projected after its own identity verdict succeeds.
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { gitIn } from "./git-context.mjs";
// BF2 layering (successor of this commit): see bf1Projection. The BF2 module imports nothing from this one.
import { isBF2Tree, bf2Projection, BF2_PARENT } from "./bf2-backfill-layer.mjs";
const RECORD = JSON.parse(readFileSync(new URL("./bf1-backfill-layer.json", import.meta.url), "utf8"));
export const BF1_PARENT = "5bae812c9fde9f58bd9d1bc359dd3855c4658cf1";
export const BF1_FILE = "scripts/backfill-biz-access.mjs";
export const BF1_PIN = RECORD.pin;
export const BF1_PARENT_BLOB = RECORD.parentBlob;
const blob = (b) => createHash("sha1").update(`blob ${b.length}\0`).update(b).digest("hex");
const rev = (root, spec) => { const r = gitIn(root, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };
export function isBF1Tree(root) {
  return existsSync(join(root, "test/support/bf1-backfill-layer.json")) && gitIn(root, ["merge-base", "--is-ancestor", BF1_PARENT, "HEAD"]).status === 0;
}
export function bf1RecordVerdict(root, record = RECORD) {
  if (record.parent !== BF1_PARENT || record.file !== BF1_FILE) return { ok: false, reason: "record_scope" };
  if (!/^[0-9a-f]{40}$/.test(record.pin) || record.pin === record.parentBlob) return { ok: false, reason: "pin_shape" };
  if (record.pin !== BF1_PIN) return { ok: false, reason: "unknown_pin" };
  if (record.parentBlob !== rev(root, `${BF1_PARENT}:${BF1_FILE}`)) return { ok: false, reason: "parent_blob" };
  return { ok: true };
}
export function bf1Projection(root, paths) {
  const all = [...new Set(paths || [])];
  if (!isBF1Tree(root)) return { ok: true, layered: false, projected: all };
  const rec = bf1RecordVerdict(root);
  if (!rec.ok) return rec;
  // BF2: on a tree carrying the BF2 successor, BF1's pin is judged on the immutable BF1 commit and the checked-out script is handed
  // ONLY to BF2's own fail-closed verdict (record, BF1 chain, committed / staged / checked-out bytes at the BF2 pin).
  if (isBF2Tree(root)) return rev(root, `${BF2_PARENT}:${BF1_FILE}`) === BF1_PIN ? bf2Projection(root, all) : { ok: false, reason: "bf1_history_mismatch" };
  let bytes;
  try { bytes = readFileSync(join(root, BF1_FILE)); } catch { return { ok: false, reason: "script_missing" }; }
  if (blob(bytes) !== BF1_PIN) return { ok: false, reason: "script_content_mismatch" };
  // During preparation HEAD is the immutable parent. The final BF1 guard additionally requires a sole-parent child.
  if (rev(root, "HEAD") !== BF1_PARENT && (rev(root, `HEAD:${BF1_FILE}`) !== BF1_PIN || rev(root, `:${BF1_FILE}`) !== BF1_PIN))
    return { ok: false, reason: "script_history_mismatch" };
  return { ok: true, layered: true, projected: all.filter((f) => f !== BF1_FILE) };
}
