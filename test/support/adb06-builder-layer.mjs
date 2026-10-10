// ADB-06 successor layer (Agent/Daily integration I1) — the Builder / Agent runtime bytes carried from the Builder chain
// cfa7e801 → eb9f9008 → 02575273 → 690a07d9 onto the approved M1 R5 entry base. PROPOSED TRANSITION RECORD, NOT AN APPROVAL:
// the B2/Builder owner, the Agent / D-E package owner, the S0 scope owner and the M1 integration owner must each confirm it
// on the exact integrated SHA (integration-gate-resolution PROPOSED_RECORDS §2/§3). Nothing here is derived from HEAD: every
// identity is a literal in adb06-builder-layer.json, recorded from git objects by the author tool gen-i1-records.py.
//
//   ADB06_ENTRY        the approved M1 R5 entry base cfa7e801 (APPROVED_FOR_AGENT_DAILY_ENTRY)
//   ADB06_SOURCE       the reviewed Builder CF5-01 successor 690a07d9 (CF5_01_CORRECTION_VERIFIED — NOT_AN_INTEGRATION_BASE)
//   ADB06_PINS         every runtime file (src/**) the chain changes, pinned to its blob AT ADB06_SOURCE
//   ADB06_ENTRY_BLOBS  the entry-base blob of each ("ABSENT" for a new file) — a pin equal to it would not be a change
//
// How the historical proofs stay intact (never a blanket exclusion, never "HEAD is clean"):
//   • the six-file server-reader table (server-reader-authorized-delta.mjs) is NOT widened: it still refuses any src/agent/**
//     entry (S0 test H). Its literal approved pins are unchanged; only its EFFECTIVE table overlays the ONE B2-owned file
//     src/snapshot/snapshotBuilder.ts with its ADB-06 pin on a tree that carries this layer (as M1 R2..R5 did for
//     src/analytics/dailyBuilder.ts);
//   • the S0-protected Agent files are authorized by THIS layer's own verdict, by exact identity (working-tree bytes = the pin
//     = the blob at 690a07d9), and only the paths that verdict validated are projected out of the reader layer's protected
//     set — exactly as the Rules version-fence delta is validated first and projected out (vat-invariant Layer B);
//   • B1 / B2 / S0 / M1 historical proofs keep reading their own git objects (B2 3fd28e7c, the M1 R5 commit, the core).
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";

const RECORD = JSON.parse(readFileSync(new URL("./adb06-builder-layer.json", import.meta.url), "utf8"));
export const ADB06_STATUS = "PROPOSED (ADB-06 Builder / Agent successor layer, Agent/Daily integration I1) — owner confirmations pending: B2/Builder, Agent D/E, S0 scope, M1 integration";
export const ADB06_ENTRY = RECORD.entryBase;
export const ADB06_SOURCE = RECORD.source;
export const ADB06_CHAIN = Object.freeze([...RECORD.chain]);
export const ADB06_PINS = Object.freeze({ ...RECORD.pins });
export const ADB06_ENTRY_BLOBS = Object.freeze({ ...RECORD.entryBlobs });
export const ADB06_FILES = Object.freeze(Object.keys(ADB06_PINS).sort());
/** The S0-protected roots (server-reader-authorized-delta.mjs PROTECTED_ROOTS, restated for the layer's own scope check). */
const S0_ROOT = /^src\/(?:analytics|repositories|agent|snapshot|forecast)\//;
/** The Agent files this layer authorizes under the S0-protected roots (the reader table keeps the snapshot files). */
export const ADB06_AGENT_FILES = Object.freeze(ADB06_FILES.filter((f) => /^src\/agent\//.test(f)));

const git = (repo, args, opts = {}) => spawnSync("git", ["-C", repo, ...args], { encoding: "utf8", maxBuffer: 1 << 28, ...opts });
const blobSha = (buf) => createHash("sha1").update(`blob ${buf.length}\0`).update(buf).digest("hex");
const rev = (repo, spec) => { const r = git(repo, ["rev-parse", "--verify", "-q", spec]); return r.status === 0 ? r.stdout.trim() : null; };

/** A tree that carries the layer: the reviewed Builder successor is an ancestor of (or is) HEAD. */
export function isADB06Tree(repo) {
  return git(repo, ["merge-base", "--is-ancestor", ADB06_SOURCE, "HEAD"]).status === 0;
}

/** The record itself, checked against git OBJECTS only: chain, pins = blobs at the source, entry blobs = blobs at the entry.
 *  `rec` defaults to this module's record (mutation tests pass forged copies to prove each check bites). */
export function adb06RecordVerdict(repo, rec = { entryBase: ADB06_ENTRY, source: ADB06_SOURCE, chain: ADB06_CHAIN, pins: ADB06_PINS, entryBlobs: ADB06_ENTRY_BLOBS }) {
  if (rec.entryBase !== "cfa7e8016e9d1b7440485de7911d133d9340f1e6") return { ok: false, reason: "entry_base" };
  if (rec.source !== "690a07d9e3aabc82821975e097e1135417eb20c1") return { ok: false, reason: "source" };
  const chain = git(repo, ["rev-list", "--reverse", `${rec.entryBase}..${rec.source}`]).stdout.trim().split("\n").filter(Boolean);
  if (JSON.stringify(chain) !== JSON.stringify([...rec.chain])) return { ok: false, reason: "chain", detail: chain };
  const files = Object.keys(rec.pins).sort();
  const changed = git(repo, ["diff", "--name-only", rec.entryBase, rec.source, "--", "src"]).stdout.trim().split("\n").filter(Boolean).sort();
  if (JSON.stringify(changed) !== JSON.stringify(files)) return { ok: false, reason: "file_set", detail: changed };
  for (const f of files) {
    if (!/^[0-9a-f]{40}$/.test(rec.pins[f])) return { ok: false, reason: "pin_shape", detail: f };
    if (rev(repo, `${rec.source}:${f}`) !== rec.pins[f]) return { ok: false, reason: "pin_not_source_blob", detail: f };
    const entry = rev(repo, `${rec.entryBase}:${f}`) ?? "ABSENT";
    if (entry !== rec.entryBlobs[f]) return { ok: false, reason: "entry_blob", detail: f };
    if (entry === rec.pins[f]) return { ok: false, reason: "pin_equals_entry", detail: f };
  }
  return { ok: true };
}

/**
 * The layer's verdict over a list of changed S0-protected paths (relative to the S0 core), BEFORE the reader layer runs: every
 * changed path under src/agent/ must be a layer file whose WORKING-TREE bytes are its pin; the record must hold against git
 * objects. Returns { ok, projected } — `projected` is the input minus exactly the Agent paths validated here (nothing else).
 * On a tree without the layer the input is returned unchanged (the reader layer then refuses any Agent path, as before).
 */
export function adb06Projection(root, changedProtectedPaths) {
  const paths = Array.from(new Set(changedProtectedPaths || []));
  if (!isADB06Tree(root)) return { ok: true, layered: false, projected: paths };
  const rec = adb06RecordVerdict(root);
  if (!rec.ok) return { ok: false, reason: "record_" + rec.reason, detail: rec.detail };
  const validated = [];
  for (const rel of paths.filter((p) => /^src\/agent\//.test(p))) {
    if (!ADB06_AGENT_FILES.includes(rel)) continue;                      // not a layer file: left for the reader layer to refuse
    let bytes = null; try { bytes = readFileSync(join(root, rel)); } catch { bytes = null; }
    if (bytes === null) return { ok: false, reason: "layer_file_missing", detail: rel };
    if (blobSha(bytes) !== ADB06_PINS[rel]) return { ok: false, reason: "layer_content_mismatch", detail: { file: rel, expected: ADB06_PINS[rel], actual: blobSha(bytes) } };
    validated.push(rel);
  }
  return { ok: true, layered: true, validated: validated.sort(), projected: paths.filter((p) => !validated.includes(p)) };
}

/** The ADB-06 pins that overlay the B2-owned entries of the reader table (the snapshot builder) on a layer tree. */
export function adb06ReaderOverlay(root) {
  if (!isADB06Tree(root)) return {};
  const out = {};
  for (const f of ADB06_FILES) if (/^src\/snapshot\//.test(f)) out[f] = ADB06_PINS[f];
  return out;
}
export { S0_ROOT as ADB06_S0_ROOT };
