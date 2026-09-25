// Storage V2 — CANARY TOOLING: protected LOCAL evidence (bundles, receipts, ledger).
//
// HARD BOUNDARY — this module:
//   • touches the local filesystem ONLY, never RTDB, never the network;
//   • creates every file exclusively (O_EXCL), mode 0600 in a 0700 directory, refuses any
//     symlink in the directory chain, never overwrites, never deletes;
//   • writes COMPLETE.json LAST, after re-reading and re-hashing every file it wrote;
//   • has no restore, no repair and no rollback command.

import { openSync, writeSync, closeSync, fsyncSync, readFileSync, mkdirSync, lstatSync, existsSync, readdirSync, statSync, constants } from "node:fs";
import { join, resolve, sep, dirname } from "node:path";
import { sha256Hex, digestV1, CanaryError, EXIT, CONTRACT_VERSION } from "./canary-contract.mjs";

const DIR_MODE = 0o700, FILE_MODE = 0o600;

/** Refuse symlinks anywhere in the resolved chain of `p` (existing components only). */
export function assertNoSymlink(p) {
  const abs = resolve(p); const parts = abs.split(sep).filter(Boolean); let cur = sep;
  for (const part of parts) { cur = join(cur, part); if (!existsSync(cur)) break; if (lstatSync(cur).isSymbolicLink()) throw new CanaryError("symlink_in_path", cur, EXIT.ENV); }
}
export function ensurePrivateDir(dir) {
  assertNoSymlink(dir);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true, mode: DIR_MODE });
  const st = statSync(dir); if (!st.isDirectory()) throw new CanaryError("not_a_directory", dir, EXIT.ENV);
  if (process.platform !== "win32" && (st.mode & 0o077) !== 0) throw new CanaryError("dir_permissions_too_open", `${dir} mode ${(st.mode & 0o777).toString(8)} (need 0700)`, EXIT.ENV);
  return dir;
}
/** Exclusive create; bytes = Buffer or string (UTF-8). Returns { bytes, sha256 }. */
export function writeExclusive(path, data) {
  assertNoSymlink(dirname(path));
  if (existsSync(path)) throw new CanaryError("file_exists", path, EXIT.ENV);
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL, FILE_MODE);
  try { let off = 0; while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off); fsyncSync(fd); } finally { closeSync(fd); }
  const back = readFileSync(path);
  if (Buffer.compare(back, buf) !== 0) throw new CanaryError("write_readback_mismatch", path, EXIT.ENV);
  return { bytes: buf.length, sha256: sha256Hex(back) };
}
// evidence JSON is exact: non-finite numbers and undefined never silently become null
const exactReplacer = (k, v) => { if (typeof v === "number" && !Number.isFinite(v)) throw new CanaryError("unsupported_value", `non-finite number at ${k}`, EXIT.ENV); if (v === undefined) throw new CanaryError("unsupported_value", `undefined at ${k}`, EXIT.ENV); return v; };
const jsonBytes = (v) => Buffer.from(JSON.stringify(v, exactReplacer, 2) + "\n", "utf8");

/**
 * Create a bundle directory `<root>/<operationId>/<bundleId>/` with the given files
 * ({ name: Buffer|string|{json} }) and write COMPLETE.json last. Any failure leaves NO COMPLETE.json.
 */
export function createBundle({ root, operationId, bundleId, files, observerAck = null, now }) {
  const opDir = ensurePrivateDir(join(ensurePrivateDir(root), operationId));
  const dir = join(opDir, bundleId);
  if (existsSync(dir)) throw new CanaryError("bundle_exists", dir, EXIT.ENV);
  mkdirSync(dir, { mode: DIR_MODE });
  const written = [];
  for (const [name, content] of Object.entries(files)) {
    if (!/^[A-Za-z0-9._-]+$/.test(name)) throw new CanaryError("bad_file_name", name, EXIT.ENV);
    const data = content && typeof content === "object" && !Buffer.isBuffer(content) && "json" in content ? jsonBytes(content.json) : content;
    const r = writeExclusive(join(dir, name), data);
    written.push({ name, bytes: r.bytes, sha256: r.sha256 });
  }
  // re-read and re-hash EVERY file before COMPLETE
  for (const w of written) { const back = readFileSync(join(dir, w.name)); if (back.length !== w.bytes || sha256Hex(back) !== w.sha256) throw new CanaryError("bundle_rehash_mismatch", w.name, EXIT.ENV); }
  const complete = { completeVersion: CONTRACT_VERSION, bundleId, operationId, writtenAt: now, files: written, filesDigest: digestV1(written), observerAck };
  writeExclusive(join(dir, "COMPLETE.json"), jsonBytes(complete));
  return { dir, bundleId, files: written, complete };
}
export function readJson(path) { return JSON.parse(readFileSync(path, "utf8")); }
/** Verify every hash in COMPLETE.json against the files on disk; returns { ok, complete, problems }. */
export function verifyBundle(dir) {
  const problems = [];
  assertNoSymlink(dir);
  const cp = join(dir, "COMPLETE.json");
  if (!existsSync(cp)) return { ok: false, complete: null, problems: ["COMPLETE.json missing — bundle is INCOMPLETE"] };
  let complete; try { complete = readJson(cp); } catch (e) { return { ok: false, complete: null, problems: ["COMPLETE.json unreadable: " + e.message] }; }
  if (!complete || !Array.isArray(complete.files)) return { ok: false, complete, problems: ["COMPLETE.json malformed"] };
  if (digestV1(complete.files) !== complete.filesDigest) problems.push("COMPLETE.json files digest mismatch");
  for (const f of complete.files) {
    const p = join(dir, f.name);
    if (!existsSync(p)) { problems.push(`${f.name}: missing`); continue; }
    const back = readFileSync(p);
    if (back.length !== f.bytes) problems.push(`${f.name}: size ${back.length} ≠ ${f.bytes}`);
    if (sha256Hex(back) !== f.sha256) problems.push(`${f.name}: sha256 mismatch`);
  }
  const listed = new Set(complete.files.map((f) => f.name));
  for (const name of readdirSync(dir)) if (name !== "COMPLETE.json" && !listed.has(name)) problems.push(`${name}: not listed in COMPLETE.json`);
  return { ok: problems.length === 0, complete, problems };
}
/** Load a verified bundle into the structure the contract expects. */
export function openBundle(dir) {
  const v = verifyBundle(dir);
  if (!v.ok) throw new CanaryError("evidence_incomplete", v.problems.join("; "), EXIT.BLOCKER);
  const j = (n) => readJson(join(dir, n));
  const rawVPath = join(dir, "entries.raw-v.utf8");
  const manifest = j("manifest.json");
  return { dir, complete: v.complete, manifest, environment: j("environment.json"), source: j("entries.source.json"), rawV: existsSync(rawVPath) ? { present: true, text: readFileSync(rawVPath, "utf8"), bytes: statSync(rawVPath).size, sha256: sha256Hex(readFileSync(rawVPath)) } : { present: false },
    exceptions: j("exceptions.source.json"), context: j("context.source.json"), policy: j("policy.source.json"), sourceManifest: j("source-manifest.json"), expectedV2: j("expected-v2.json"), readerBaseline: j("reader-baseline.json"), preflight: j("preflight.json"),
    deployment: existsSync(join(dir, "deployment-evidence.json")) ? j("deployment-evidence.json") : null };
}

// ── append-only receipts and ledger ──────────────────────────────────────────
function appendLine(path, obj) {
  assertNoSymlink(dirname(path));
  const fd = openSync(path, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND, FILE_MODE);
  try { writeSync(fd, JSON.stringify(obj) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
}
export function appendReceipt(opDir, receipt) { ensurePrivateDir(opDir); const rec = { receiptVersion: CONTRACT_VERSION, ...receipt }; appendLine(join(opDir, "actions.jsonl"), rec); return rec; }
export function readReceipts(opDir) { const p = join(opDir, "actions.jsonl"); if (!existsSync(p)) return []; return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); }
/**
 * Ledger append: one immutable file per record (`cycle-<cycleId>[-cN].json`) + `ledger.jsonl`.
 * Same cycle + identical body ⇒ no new record (idempotent). Same cycle + different body ⇒ a CORRECTION
 * record that references the prior record's digest. Never overwrites.
 */
export function appendLedger(opDir, record) {
  const dir = ensurePrivateDir(join(ensurePrivateDir(opDir), "ledger"));
  const existing = readLedger(opDir).filter((r) => r.cycleId === record.cycleId);
  const prior = existing[existing.length - 1] || null;
  if (prior && prior.bodyDigest === record.bodyDigest) return { appended: false, record: prior, reason: "identical_record_exists" };
  const stored = prior ? { ...record, correction: existing.length, supersedes: prior.bodyDigest } : record;
  const name = prior ? `cycle-${record.cycleId}-c${existing.length}.json` : `cycle-${record.cycleId}.json`;
  writeExclusive(join(dir, name), jsonBytes(stored));
  appendLine(join(dir, "ledger.jsonl"), stored);
  return { appended: true, record: stored, reason: prior ? "correction" : "new" };
}
export function readLedger(opDir) { const p = join(opDir, "ledger", "ledger.jsonl"); if (!existsSync(p)) return []; return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); }
export function listBundles(opDir) { if (!existsSync(opDir)) return []; return readdirSync(opDir).filter((n) => n !== "ledger" && n !== "reports" && statSync(join(opDir, n)).isDirectory()).sort(); }
