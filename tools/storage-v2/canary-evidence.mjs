// Storage V2 — CANARY TOOLING: protected LOCAL evidence (bundles, receipts, ledger).
//
// HARD BOUNDARY — this module:
//   • touches the local filesystem ONLY, never RTDB, never the network;
//   • works below ONE canonical evidence root (the operator's --evidence-dir after realpath —
//     an OS-level alias such as macOS /var → /private/var is resolved ONCE at the root and never
//     below it): every descendant component is checked with lstat and must be a real directory
//     or a regular file, never a symlink, and must stay inside the canonical root;
//   • creates every file exclusively (O_EXCL), mode 0600 in 0700 directories, never overwrites,
//     never deletes;
//   • writes COMPLETE.json LAST, after re-reading and re-hashing every file it wrote;
//   • re-validates the WHOLE filesystem state (types, symlinks, modes, containment, hashes, sizes)
//     on every verify — creation-time checks are never trusted later;
//   • has no restore, no repair and no rollback command.

import { openSync, writeSync, closeSync, fsyncSync, readFileSync, mkdirSync, lstatSync, existsSync, readdirSync, realpathSync, constants } from "node:fs";
import { join, resolve, sep, dirname, basename, relative, isAbsolute } from "node:path";
import { sha256Hex, digestV1, CanaryError, EXIT, CONTRACT_VERSION } from "./canary-contract.mjs";

const DIR_MODE = 0o700, FILE_MODE = 0o600;
const NAME_RE = /^[A-Za-z0-9._-]+$/;
const isWin = process.platform === "win32";
const fail = (code, detail) => { throw new CanaryError(code, detail, EXIT.ENV); };

// ── canonical root ───────────────────────────────────────────────────────────
/**
 * Canonicalise the APPROVED ROOT: realpath of the deepest existing ancestor (so an OS alias such as
 * /var → /private/var, or a not-yet-created leaf, is fine) joined with the remaining components.
 * Everything below the returned path is validated with lstat and NEVER canonicalised again.
 */
export function canonicalRoot(root) {
  const abs = resolve(root);
  const parts = abs.split(sep).filter(Boolean);
  for (let i = parts.length; i >= 0; i--) {
    const head = sep + parts.slice(0, i).join(sep);
    if (existsSync(head)) { const real = realpathSync(head); return i === parts.length ? real : join(real, ...parts.slice(i)); }
  }
  return abs;
}
/**
 * A scope = the approved root as the caller spelled it + its canonical form. A path spelled under the
 * requested root (e.g. `/var/folders/…/op/b1` on macOS) has ONLY that approved prefix rewritten to the
 * canonical root (`/private/var/folders/…/op/b1`); nothing below the root is ever resolved through a link.
 */
function scope(root) {
  const requested = resolve(root), canonical = canonicalRoot(root);
  const norm = (p) => { const abs = isAbsolute(p) ? resolve(p) : resolve(canonical, p); if (requested !== canonical && (abs === requested || abs.startsWith(requested + sep))) return canonical + abs.slice(requested.length); return abs; };
  return { requested, canonical, norm };
}
/** `p` (absolute or root-relative) must resolve INSIDE the canonical root; returns the absolute (canonically prefixed) path. */
export function containedPath(root, p) {
  const sc = scope(root); const abs = sc.norm(p);
  const rel = relative(sc.canonical, abs);
  if (abs !== sc.canonical && (rel === "" || rel.startsWith("..") || isAbsolute(rel))) fail("path_outside_root", `${p} is not inside ${sc.canonical}`);
  return abs;
}
const isLinkOrExists = (p) => { try { lstatSync(p); return true; } catch (_) { return false; } };
const modeOf = (st) => st.mode & 0o777;
/** Every EXISTING component strictly below the canonical root must be a real directory (or, for the leaf, a regular file). */
export function assertNoSymlinkBelow(root, p) {
  const croot = canonicalRoot(root);
  const abs = containedPath(root, p);
  const rel = relative(croot, abs); if (!rel) return abs;
  let cur = croot;
  for (const part of rel.split(sep)) {
    cur = join(cur, part);
    if (!isLinkOrExists(cur)) break;
    const st = lstatSync(cur);
    if (st.isSymbolicLink()) fail("symlink_in_path", cur);
    if (cur !== abs && !st.isDirectory()) fail("not_a_directory", cur);
  }
  return abs;
}

/** `dir` must be (or become) a real 0700 directory below the canonical root — never a symlink. */
export function ensurePrivateDir(dir, root = dirname(dir)) {
  const abs = assertNoSymlinkBelow(root, dir);
  if (!isLinkOrExists(abs)) mkdirSync(abs, { recursive: true, mode: DIR_MODE });
  const st = lstatSync(abs);
  if (st.isSymbolicLink()) fail("symlink_in_path", abs);
  if (!st.isDirectory()) fail("not_a_directory", abs);
  if (!isWin && modeOf(st) !== DIR_MODE) fail("dir_permissions_too_open", `${abs} mode ${modeOf(st).toString(8)} (need 0700)`);
  return abs;
}
/** Exclusive create of a regular 0600 file below the canonical root; bytes = Buffer or string (UTF-8). Returns { bytes, sha256 }. */
export function writeExclusive(path, data, root = dirname(path)) {
  const abs = assertNoSymlinkBelow(root, path);
  if (isLinkOrExists(abs)) fail("file_exists", abs);
  const buf = Buffer.isBuffer(data) ? data : Buffer.from(String(data), "utf8");
  const fd = openSync(abs, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | (constants.O_NOFOLLOW || 0), FILE_MODE);
  try { let off = 0; while (off < buf.length) off += writeSync(fd, buf, off, buf.length - off); fsyncSync(fd); } finally { closeSync(fd); }
  const back = readFileSync(abs);
  if (Buffer.compare(back, buf) !== 0) fail("write_readback_mismatch", abs);
  const st = lstatSync(abs); if (st.isSymbolicLink() || !st.isFile()) fail("not_a_regular_file", abs);
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
  const croot = canonicalRoot(root);
  if (!NAME_RE.test(operationId) || !NAME_RE.test(bundleId)) fail("bad_file_name", `${operationId}/${bundleId}`);
  ensurePrivateDir(croot, croot); const opDir = ensurePrivateDir(join(croot, operationId), croot);
  const dir = join(opDir, bundleId);
  if (isLinkOrExists(dir)) fail("bundle_exists", dir);
  mkdirSync(dir, { mode: DIR_MODE });
  const written = [];
  for (const [name, content] of Object.entries(files)) {
    if (!NAME_RE.test(name) || name === "COMPLETE.json") fail("bad_file_name", name);
    const data = content && typeof content === "object" && !Buffer.isBuffer(content) && "json" in content ? jsonBytes(content.json) : content;
    const r = writeExclusive(join(dir, name), data, croot);
    written.push({ name, bytes: r.bytes, sha256: r.sha256, type: "file", mode: FILE_MODE });
  }
  // re-read and re-hash EVERY file before COMPLETE
  for (const w of written) { const back = readFileSync(join(dir, w.name)); if (back.length !== w.bytes || sha256Hex(back) !== w.sha256) fail("bundle_rehash_mismatch", w.name); }
  const complete = { completeVersion: CONTRACT_VERSION, bundleId, operationId, writtenAt: now, dirMode: DIR_MODE, fileMode: FILE_MODE, files: written, filesDigest: digestV1(written), observerAck };
  writeExclusive(join(dir, "COMPLETE.json"), jsonBytes(complete), croot);
  const v = verifyBundle(dir, { root: croot }); if (!v.ok) fail("bundle_verify_after_create", v.problems.join("; "));
  return { dir, bundleId, files: written, complete };
}
export function readJson(path) { return JSON.parse(readFileSync(path, "utf8")); }

/**
 * Verify the WHOLE filesystem state of a bundle against COMPLETE.json — never trusting creation-time
 * checks: containment under the canonical root, no symlink on the way, real 0700 directory, every listed
 * artifact a real 0600 regular file inside the bundle with matching size and sha256, COMPLETE.json itself a
 * real 0600 file whose files digest verifies, and no unlisted entries. Returns { ok, complete, problems }.
 */
export function verifyBundle(dir, { root = dirname(dir) } = {}) {
  const problems = [];
  let abs;
  try { abs = assertNoSymlinkBelow(root, dir); } catch (e) { return { ok: false, complete: null, problems: [`${e.code}: ${e.detail}`] }; }
  if (!isLinkOrExists(abs)) return { ok: false, complete: null, problems: ["bundle directory missing"] };
  const dst = lstatSync(abs);
  if (dst.isSymbolicLink()) return { ok: false, complete: null, problems: ["bundle directory is a symlink"] };
  if (!dst.isDirectory()) return { ok: false, complete: null, problems: ["bundle path is not a directory"] };
  if (!isWin && modeOf(dst) !== DIR_MODE) problems.push(`bundle directory mode ${modeOf(dst).toString(8)} ≠ 0700`);
  const checkFile = (name) => {
    if (typeof name !== "string" || !NAME_RE.test(name)) { problems.push(`${String(name)}: not a plain file name`); return null; }
    let p; try { p = containedPath(abs, name); } catch (e) { problems.push(`${name}: ${e.code}`); return null; }
    if (dirname(p) !== abs || basename(p) !== name) { problems.push(`${name}: not directly inside the bundle`); return null; }
    if (!isLinkOrExists(p)) { problems.push(`${name}: missing`); return null; }
    const st = lstatSync(p);
    if (st.isSymbolicLink()) { problems.push(`${name}: is a symlink`); return null; }
    if (!st.isFile()) { problems.push(`${name}: not a regular file`); return null; }
    if (!isWin && modeOf(st) !== FILE_MODE) problems.push(`${name}: mode ${modeOf(st).toString(8)} ≠ 0600`);
    return { p, st };
  };
  const cp = checkFile("COMPLETE.json");
  if (!cp) return { ok: false, complete: null, problems: [...problems, "COMPLETE.json missing or invalid — bundle is INCOMPLETE"] };
  let complete; try { complete = readJson(cp.p); } catch (e) { return { ok: false, complete: null, problems: [...problems, "COMPLETE.json unreadable: " + e.message] }; }
  if (!complete || !Array.isArray(complete.files)) return { ok: false, complete, problems: [...problems, "COMPLETE.json malformed"] };
  if (digestV1(complete.files) !== complete.filesDigest) problems.push("COMPLETE.json files digest mismatch");
  const listed = new Set();
  for (const f of complete.files) {
    if (!f || typeof f.name !== "string") { problems.push("COMPLETE.json entry without a name"); continue; }
    listed.add(f.name);
    const r = checkFile(f.name); if (!r) continue;
    if (f.type !== undefined && f.type !== "file") problems.push(`${f.name}: type ${f.type} ≠ file`);
    if (r.st.size !== f.bytes) problems.push(`${f.name}: size ${r.st.size} ≠ ${f.bytes}`);
    const back = readFileSync(r.p);
    if (back.length !== f.bytes) problems.push(`${f.name}: read ${back.length} bytes ≠ ${f.bytes}`);
    if (sha256Hex(back) !== f.sha256) problems.push(`${f.name}: sha256 mismatch`);
  }
  for (const name of readdirSync(abs)) if (name !== "COMPLETE.json" && !listed.has(name)) problems.push(`${name}: not listed in COMPLETE.json`);
  return { ok: problems.length === 0, complete, problems };
}
/** Load a verified bundle into the structure the contract expects. */
export function openBundle(dir, opts = {}) {
  const v = verifyBundle(dir, opts);
  if (!v.ok) throw new CanaryError("evidence_incomplete", v.problems.join("; "), EXIT.BLOCKER);
  dir = containedPath(opts.root === undefined ? dirname(dir) : opts.root, dir);
  const j = (n) => readJson(join(dir, n));
  const has = (n) => v.complete.files.some((f) => f.name === n);
  const rawVPath = join(dir, "entries.raw-v.utf8");
  const manifest = j("manifest.json");
  return { dir, complete: v.complete, manifest, environment: j("environment.json"), source: j("entries.source.json"),
    rawV: has("entries.raw-v.utf8") ? { present: true, text: readFileSync(rawVPath, "utf8"), bytes: lstatSync(rawVPath).size, sha256: sha256Hex(readFileSync(rawVPath)) } : { present: false },
    exceptions: j("exceptions.source.json"), context: j("context.source.json"), policy: j("policy.source.json"), sourceManifest: j("source-manifest.json"), expectedV2: j("expected-v2.json"), readerBaseline: j("reader-baseline.json"), preflight: j("preflight.json"),
    drain: has("drain.json") ? j("drain.json") : null, deployment: has("deployment-evidence.json") ? j("deployment-evidence.json") : null };
}

// ── append-only receipts and ledger ──────────────────────────────────────────
function appendLine(path, obj, root) {
  const abs = assertNoSymlinkBelow(root, path);
  if (isLinkOrExists(abs)) { const st = lstatSync(abs); if (st.isSymbolicLink() || !st.isFile()) fail("not_a_regular_file", abs); if (!isWin && modeOf(st) !== FILE_MODE) fail("file_permissions_too_open", abs); }
  const fd = openSync(abs, constants.O_WRONLY | constants.O_CREAT | constants.O_APPEND | (constants.O_NOFOLLOW || 0), FILE_MODE);
  try { writeSync(fd, JSON.stringify(obj) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
}
export function appendReceipt(opDir, receipt, root = dirname(opDir)) { const d = ensurePrivateDir(opDir, root); const rec = { receiptVersion: CONTRACT_VERSION, ...receipt }; appendLine(join(d, "actions.jsonl"), rec, root); return rec; }
export function readReceipts(opDir) { const p = join(opDir, "actions.jsonl"); if (!existsSync(p)) return []; return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); }
/**
 * Ledger append: one immutable file per record (`cycle-<cycleId>[-cN].json`) + `ledger.jsonl`.
 * Same cycle + identical body ⇒ no new record (idempotent). Same cycle + different body ⇒ a CORRECTION
 * record that references the prior record's digest. Never overwrites.
 */
export function appendLedger(opDir, record, root = dirname(opDir)) {
  const dir = ensurePrivateDir(join(ensurePrivateDir(opDir, root), "ledger"), root);
  const existing = readLedger(dirname(dir)).filter((r) => r.cycleId === record.cycleId);
  const prior = existing[existing.length - 1] || null;
  if (prior && prior.bodyDigest === record.bodyDigest) return { appended: false, record: prior, reason: "identical_record_exists" };
  const stored = prior ? { ...record, correction: existing.length, supersedes: prior.bodyDigest } : record;
  const name = prior ? `cycle-${record.cycleId}-c${existing.length}.json` : `cycle-${record.cycleId}.json`;
  writeExclusive(join(dir, name), jsonBytes(stored), root);
  appendLine(join(dir, "ledger.jsonl"), stored, root);
  return { appended: true, record: stored, reason: prior ? "correction" : "new" };
}
export function readLedger(opDir) { const p = join(opDir, "ledger", "ledger.jsonl"); if (!existsSync(p)) return []; return readFileSync(p, "utf8").split("\n").filter(Boolean).map((l) => JSON.parse(l)); }
export function listBundles(opDir) { if (!existsSync(opDir)) return []; return readdirSync(opDir).filter((n) => n !== "ledger" && n !== "reports" && n !== "live" && lstatSync(join(opDir, n)).isDirectory()).sort(); }
