// Marjin — CANARY TOOLING evidence: exclusive create, permissions, no overwrite, symlink refusal,
// COMPLETE last, tamper detection (CT-08 precondition, CT-33), raw `_v` byte exactness, receipts and
// ledger append-only semantics with corrections (CT-23).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, statSync, lstatSync, symlinkSync, mkdirSync, chmodSync, readdirSync, renameSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import * as E from "../../tools/storage-v2/canary-evidence.mjs";
import * as C from "../../tools/storage-v2/canary-contract.mjs";
import { tempEvidenceDir } from "../support/canary-fixtures.mjs";

const HEB = "[{\"id\":\"x\",\"notes\":\"שלום עולם 🙂 \\u2028\",\"sales\":\"1.10\"}]";
const files = () => ({ "manifest.json": { json: { manifestVersion: 1 } }, "environment.json": { json: {} }, "entries.source.json": JSON.stringify({ _v: HEB }), "entries.raw-v.utf8": Buffer.from(HEB, "utf8"), "exceptions.source.json": { json: null }, "context.source.json": { json: {} }, "policy.source.json": { json: {} }, "source-manifest.json": { json: { rowCount: 1 } }, "expected-v2.json": { json: { digest: "d" } }, "reader-baseline.json": { json: { outputs: {} } }, "preflight.json": { json: { aggregate: "PASS" } } });

test("bundle: files exclusive + 0600 in 0700 dirs, COMPLETE.json last with every hash, verify + open round trip", () => {
  const root = tempEvidenceDir();
  const b = E.createBundle({ root, operationId: "op", bundleId: "b1", files: files(), now: "2026-09-25T10:00:00Z" });
  assert.ok(existsSync(join(b.dir, "COMPLETE.json")));
  for (const n of readdirSync(b.dir)) assert.equal(statSync(join(b.dir, n)).mode & 0o777, 0o600, n);
  assert.equal(statSync(b.dir).mode & 0o777, 0o700); assert.equal(statSync(join(root, "op")).mode & 0o777, 0o700);
  const complete = JSON.parse(readFileSync(join(b.dir, "COMPLETE.json"), "utf8"));
  assert.equal(complete.files.length, Object.keys(files()).length); assert.ok(complete.files.every((f) => /^[0-9a-f]{64}$/.test(f.sha256) && f.bytes > 0));
  assert.equal(complete.filesDigest, C.digestV1(complete.files));
  const v = E.verifyBundle(b.dir); assert.equal(v.ok, true, v.problems.join(";"));
  const o = E.openBundle(b.dir); assert.equal(o.rawV.text, HEB); assert.equal(o.rawV.bytes, Buffer.byteLength(HEB, "utf8")); assert.equal(o.rawV.sha256, C.rawVSha256(HEB)); assert.equal(o.sourceManifest.rowCount, 1);
  assert.equal(Buffer.compare(readFileSync(join(b.dir, "entries.raw-v.utf8")), Buffer.from(HEB, "utf8")), 0, "raw _v bytes exact");
  assert.deepEqual(E.listBundles(join(root, "op")), ["b1"]);
});

test("no overwrite: an existing bundle id, an existing file and a symlinked path are refused; a partial bundle has no COMPLETE (CT-33)", () => {
  const root = tempEvidenceDir();
  E.createBundle({ root, operationId: "op", bundleId: "b1", files: files(), now: "t" });
  assert.throws(() => E.createBundle({ root, operationId: "op", bundleId: "b1", files: files(), now: "t" }), (e) => e.code === "bundle_exists");
  assert.throws(() => E.writeExclusive(join(root, "op", "b1", "manifest.json"), "x"), (e) => e.code === "file_exists");
  assert.equal(readFileSync(join(root, "op", "b1", "manifest.json"), "utf8").includes("manifestVersion"), true, "original untouched");
  const target = tempEvidenceDir(); symlinkSync(target, join(root, "link"));
  assert.throws(() => E.ensurePrivateDir(join(root, "link", "x"), root), (e) => e.code === "symlink_in_path");
  // a symlinked OPERATION directory below the approved root is refused even though its target is a real 0700 directory
  assert.throws(() => E.createBundle({ root, operationId: "link", bundleId: "b2", files: files(), now: "t" }), (e) => e.code === "symlink_in_path");
  const open = join(root, "open"); mkdirSync(open, { mode: 0o755 }); if (process.platform !== "win32") assert.throws(() => E.ensurePrivateDir(open), (e) => e.code === "dir_permissions_too_open");
  assert.throws(() => E.createBundle({ root, operationId: "op", bundleId: "b3", files: { "bad name.json": "x" }, now: "t" }), (e) => e.code === "bad_file_name");
  assert.ok(!existsSync(join(root, "op", "b3", "COMPLETE.json")), "failed bundle has no COMPLETE.json");
  assert.throws(() => E.openBundle(join(root, "op", "b3")), (e) => e.code === "evidence_incomplete");
  assert.throws(() => E.createBundle({ root, operationId: "op", bundleId: "b4", files: { "a.json": { json: { x: NaN } } }, now: "t" }), /unsupported_value|NaN/);
});

test("tamper detection: changed file, missing file, extra file, edited COMPLETE.json (CT-33)", () => {
  const root = tempEvidenceDir(); const b = E.createBundle({ root, operationId: "op", bundleId: "b1", files: files(), now: "t" });
  const p = join(b.dir, "entries.raw-v.utf8"); chmodSync(p, 0o600); writeFileSync(p, HEB.replace("1.10", "1.1"));
  let v = E.verifyBundle(b.dir); assert.equal(v.ok, false); assert.ok(v.problems.some((x) => /raw-v.*(size|sha256)/.test(x)), v.problems.join(";"));
  writeFileSync(p, HEB); assert.equal(E.verifyBundle(b.dir).ok, true);
  writeFileSync(join(b.dir, "extra.json"), "{}"); v = E.verifyBundle(b.dir); assert.equal(v.ok, false); assert.ok(v.problems.some((x) => /extra.json/.test(x)));
  const cp = join(b.dir, "COMPLETE.json"); const c = JSON.parse(readFileSync(cp, "utf8")); c.files = c.files.filter((f) => f.name !== "extra.json").map((f) => ({ ...f })); c.files.push({ name: "extra.json", bytes: 2, sha256: C.sha256Hex("{}") });
  writeFileSync(cp, JSON.stringify(c)); v = E.verifyBundle(b.dir); assert.equal(v.ok, false); assert.ok(v.problems.some((x) => /files digest/.test(x)), "COMPLETE edited without re-digest is detected");
  assert.throws(() => E.openBundle(b.dir), (e) => e.code === "evidence_incomplete");
});

test("receipts and ledger are append-only: identical cycle body is idempotent, a different body is a correction that supersedes (CT-23)", () => {
  const root = tempEvidenceDir(); const op = join(root, "op");
  E.appendReceipt(op, { at: "t1", command: "quiesce", result: "committed" }); E.appendReceipt(op, { at: "t2", command: "capture", result: "captured" });
  const rs = E.readReceipts(op); assert.equal(rs.length, 2); assert.equal(rs[0].receiptVersion, 1); assert.equal(rs[1].command, "capture");
  assert.equal(statSync(join(op, "actions.jsonl")).mode & 0o777, 0o600);
  const rec = (cycle = "COMPLETE") => { const body = { cycleId: "2026-10-01", anchorDate: "2026-10-01", cycle, classification: { level: "OK" } }; return { ...body, bodyDigest: C.digestV1(body) }; };
  const a1 = E.appendLedger(op, rec()); assert.equal(a1.appended, true); assert.equal(a1.reason, "new");
  const a2 = E.appendLedger(op, rec()); assert.equal(a2.appended, false); assert.equal(a2.reason, "identical_record_exists");
  const a3 = E.appendLedger(op, rec("INCOMPLETE")); assert.equal(a3.appended, true); assert.equal(a3.reason, "correction"); assert.equal(a3.record.correction, 1); assert.equal(a3.record.supersedes, rec().bodyDigest);
  const led = E.readLedger(op); assert.equal(led.length, 2); assert.deepEqual(readdirSync(join(op, "ledger")).sort(), ["cycle-2026-10-01-c1.json", "cycle-2026-10-01.json", "ledger.jsonl"]);
  const first = readFileSync(join(op, "ledger", "cycle-2026-10-01.json"), "utf8"); assert.ok(first.includes("\"cycle\": \"COMPLETE\""), "first record never rewritten");
  assert.throws(() => E.writeExclusive(join(op, "ledger", "cycle-2026-10-01.json"), "x"), (e) => e.code === "file_exists");
});

// ── R1 FINDING 2: every verify re-validates the whole filesystem state ──
test("R1-F2 tamper matrix: chmod bundle 0755 / artifact 0644 / artifact→symlink (same content) / different target / COMPLETE symlink / traversal entry ⇒ invalid; untouched ⇒ valid; migration-time re-verification uses the same path", () => {
  const root = tempEvidenceDir(); const b = E.createBundle({ root, operationId: "op", bundleId: "b1", files: files(), now: "t" });
  const ok = () => E.verifyBundle(b.dir, { root }); assert.equal(ok().ok, true, ok().problems.join(";"));
  // A: bundle directory 0755
  chmodSync(b.dir, 0o755); let v = ok(); assert.equal(v.ok, false); assert.ok(v.problems.some((x) => /bundle directory mode 755/.test(x)), v.problems.join(";")); chmodSync(b.dir, 0o700); assert.equal(ok().ok, true);
  // B: artifact 0644
  chmodSync(join(b.dir, "manifest.json"), 0o644); v = ok(); assert.equal(v.ok, false); assert.ok(v.problems.some((x) => /manifest.json: mode 644/.test(x))); chmodSync(join(b.dir, "manifest.json"), 0o600); assert.equal(ok().ok, true);
  // C: artifact replaced by a symlink to IDENTICAL content
  const twin = join(root, "twin.utf8"); writeFileSync(twin, HEB); chmodSync(twin, 0o600);
  renameSync(join(b.dir, "entries.raw-v.utf8"), join(root, "moved.utf8")); symlinkSync(twin, join(b.dir, "entries.raw-v.utf8"));
  v = ok(); assert.equal(v.ok, false); assert.ok(v.problems.some((x) => /entries.raw-v.utf8: is a symlink/.test(x)), v.problems.join(";"));
  assert.throws(() => E.openBundle(b.dir, { root }), (e) => e.code === "evidence_incomplete", "migration-time open refuses");
  // D: symlink to a DIFFERENT target ⇒ still the symlink refusal (type), and a real file with different content ⇒ hash/size
  renameSync(join(b.dir, "entries.raw-v.utf8"), join(root, "gone-link")); writeFileSync(join(b.dir, "entries.raw-v.utf8"), HEB + "!"); chmodSync(join(b.dir, "entries.raw-v.utf8"), 0o600);
  v = ok(); assert.equal(v.ok, false); assert.ok(v.problems.some((x) => /entries.raw-v.utf8: size/.test(x)) && v.problems.some((x) => /sha256 mismatch/.test(x)), v.problems.join(";"));
  renameSync(join(b.dir, "entries.raw-v.utf8"), join(root, "bad.utf8")); renameSync(join(root, "moved.utf8"), join(b.dir, "entries.raw-v.utf8")); assert.equal(ok().ok, true, "restored ⇒ valid again");
  // E: COMPLETE.json replaced by a symlink to identical content
  const cTwin = join(root, "complete-twin.json"); writeFileSync(cTwin, readFileSync(join(b.dir, "COMPLETE.json"))); chmodSync(cTwin, 0o600);
  renameSync(join(b.dir, "COMPLETE.json"), join(root, "complete-moved.json")); symlinkSync(cTwin, join(b.dir, "COMPLETE.json"));
  v = ok(); assert.equal(v.ok, false); assert.ok(v.problems.some((x) => /COMPLETE.json: is a symlink/.test(x)), v.problems.join(";"));
  renameSync(join(b.dir, "COMPLETE.json"), join(root, "gone-complete-link")); renameSync(join(root, "complete-moved.json"), join(b.dir, "COMPLETE.json")); assert.equal(ok().ok, true);
  // F: manifest entry with path traversal / outside-root target ⇒ invalid (and a fresh COMPLETE cannot even name such a file)
  const c = JSON.parse(readFileSync(join(b.dir, "COMPLETE.json"), "utf8")); c.files.push({ name: "../twin.utf8", bytes: 1, sha256: "0".repeat(64), type: "file", mode: 0o600 }); c.filesDigest = C.digestV1(c.files);
  chmodSync(join(b.dir, "COMPLETE.json"), 0o600); writeFileSync(join(b.dir, "COMPLETE.json"), JSON.stringify(c)); v = ok(); assert.equal(v.ok, false); assert.ok(v.problems.some((x) => /\.\.\/twin\.utf8: not a plain file name/.test(x)), v.problems.join(";"));
  const c2 = JSON.parse(readFileSync(join(root, "complete-twin.json"), "utf8")); c2.files.push({ name: "twin.utf8", bytes: 1, sha256: "0".repeat(64) }); c2.filesDigest = C.digestV1(c2.files);
  writeFileSync(join(b.dir, "COMPLETE.json"), JSON.stringify(c2)); v = ok(); assert.equal(v.ok, false); assert.ok(v.problems.some((x) => /twin.utf8: missing/.test(x)), "an entry naming a file outside the bundle is missing, never followed");
  assert.throws(() => E.createBundle({ root, operationId: "op", bundleId: "b9", files: { "../x.json": "{}" }, now: "t" }), (e) => e.code === "bad_file_name");
  assert.throws(() => E.createBundle({ root, operationId: "../op2", bundleId: "b9", files: files(), now: "t" }), (e) => e.code === "bad_file_name");
  // G: restored original COMPLETE ⇒ valid; symlinked bundle DIRECTORY ⇒ invalid; a bundle reached through a symlinked operation dir ⇒ invalid
  writeFileSync(join(b.dir, "COMPLETE.json"), readFileSync(join(root, "complete-twin.json"))); assert.equal(ok().ok, true);
  symlinkSync(b.dir, join(root, "op", "b1-link")); v = E.verifyBundle(join(root, "op", "b1-link"), { root }); assert.equal(v.ok, false); assert.ok(v.problems.some((x) => /symlink_in_path/.test(x)), v.problems.join(";"));
  symlinkSync(join(root, "op"), join(root, "op-link")); v = E.verifyBundle(join(root, "op-link", "b1"), { root }); assert.equal(v.ok, false); assert.ok(v.problems.some((x) => /symlink_in_path/.test(x)));
  v = E.verifyBundle(join(root, "..", "outside"), { root }); assert.equal(v.ok, false); assert.ok(v.problems.some((x) => /path_outside_root/.test(x)));
});

// ── R1 FINDING 5: OS-level root alias (macOS /var → /private/var) is canonicalised at the ROOT only ──
test("R1-F5 canonical root: an aliased root (a symlink ABOVE the approved root) is accepted; symlinks below the canonical root are still refused; default os.tmpdir() works", () => {
  // simulate /var → /private/var: real directory `private/var`, alias `var` → `private/var`, root requested THROUGH the alias
  const base = tempEvidenceDir(); mkdirSync(join(base, "private", "var"), { recursive: true, mode: 0o700 }); chmodSync(join(base, "private"), 0o700); symlinkSync(join(base, "private", "var"), join(base, "var"));
  const requested = join(base, "var", "folders", "canary-ev"); const canonical = E.canonicalRoot(requested);
  assert.equal(canonical, join(realpathSync(base), "private", "var", "folders", "canary-ev"), "root canonicalised through the alias, leaf may not exist yet");
  // A: the aliased root is a safe valid root — bundles create and verify through it
  const b = E.createBundle({ root: requested, operationId: "op", bundleId: "b1", files: files(), now: "t" });
  assert.ok(b.dir.startsWith(canonical), b.dir); assert.equal(E.verifyBundle(b.dir, { root: canonical }).ok, true);
  const spelled = E.verifyBundle(join(requested, "op", "b1"), { root: canonical }); assert.equal(spelled.ok, false); assert.ok(spelled.problems.some((x) => /path_outside_root/.test(x)), "with the CANONICAL root as scope, an alias-spelled descendant is outside it: nothing below the root is ever resolved through a link");
  assert.equal(E.verifyBundle(join(requested, "op", "b1"), { root: requested }).ok, true, "with the REQUESTED (aliased) root as scope, only that approved prefix is rewritten to the canonical root — the macOS default-TMPDIR case");
  assert.equal(E.openBundle(join(requested, "op", "b1"), { root: requested }).complete.bundleId, "b1");
  E.appendReceipt(join(requested, "op"), { a: 1 }, requested); assert.ok(existsSync(join(canonical, "op", "actions.jsonl")), "receipts through the alias land under the canonical root");
  assert.equal(statSync(canonical).mode & 0o777, 0o700);
  // B: the bundle itself is a symlink ⇒ rejected
  symlinkSync(b.dir, join(canonical, "op", "b1-alias")); const vb = E.verifyBundle(join(canonical, "op", "b1-alias"), { root: canonical }); assert.equal(vb.ok, false); assert.ok(vb.problems.some((x) => /symlink_in_path/.test(x)));
  assert.throws(() => E.createBundle({ root: requested, operationId: "op", bundleId: "b1-alias", files: files(), now: "t" }), (e) => e.code === "bundle_exists");
  // C: artifact symlink inside the canonical root ⇒ rejected
  const b2 = E.createBundle({ root: requested, operationId: "op", bundleId: "b2", files: files(), now: "t" });
  renameSync(join(b2.dir, "policy.source.json"), join(canonical, "op", "policy-moved.json")); symlinkSync(join(canonical, "op", "policy-moved.json"), join(b2.dir, "policy.source.json"));
  const vc = E.verifyBundle(b2.dir, { root: canonical }); assert.equal(vc.ok, false); assert.ok(vc.problems.some((x) => /policy.source.json: is a symlink/.test(x)));
  // D: a symlink descendant that escapes the root ⇒ rejected (as a directory component and as a bundle target)
  const outside = tempEvidenceDir(); symlinkSync(outside, join(canonical, "op", "escape"));
  assert.throws(() => E.ensurePrivateDir(join(canonical, "op", "escape", "x"), canonical), (e) => e.code === "symlink_in_path");
  assert.throws(() => E.writeExclusive(join(canonical, "op", "escape", "f.json"), "{}", canonical), (e) => e.code === "symlink_in_path");
  assert.throws(() => E.writeExclusive(join(outside, "f.json"), "{}", canonical), (e) => e.code === "path_outside_root");
  assert.throws(() => E.appendReceipt(join(canonical, "op", "escape"), { a: 1 }, canonical), (e) => e.code === "symlink_in_path");
  // E / F: an ordinary real temp dir and the machine's DEFAULT os.tmpdir() (whatever it aliases to) are accepted without any TMPDIR override
  const plain = tempEvidenceDir(); assert.equal(E.verifyBundle(E.createBundle({ root: plain, operationId: "op", bundleId: "b1", files: files(), now: "t" }).dir, { root: E.canonicalRoot(plain) }).ok, true);
  const def = tmpdir(); const r = E.canonicalRoot(join(def, "canary-default-check")); assert.ok(r.startsWith(realpathSync(def)), `${r} under realpath(${def})`);
  const bd = E.createBundle({ root: join(def, "canary-default-" + process.pid), operationId: "op", bundleId: "b1", files: files(), now: "t" }); assert.equal(E.verifyBundle(bd.dir, { root: E.canonicalRoot(join(def, "canary-default-" + process.pid)) }).ok, true);
  assert.equal(lstatSync(bd.dir).isSymbolicLink(), false);
});
