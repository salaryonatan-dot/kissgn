// Marjin — CANARY TOOLING evidence: exclusive create, permissions, no overwrite, symlink refusal,
// COMPLETE last, tamper detection (CT-08 precondition, CT-33), raw `_v` byte exactness, receipts and
// ledger append-only semantics with corrections (CT-23).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readFileSync, writeFileSync, statSync, symlinkSync, mkdirSync, chmodSync, readdirSync } from "node:fs";
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
  assert.throws(() => E.ensurePrivateDir(join(root, "link", "x")), (e) => e.code === "symlink_in_path");
  assert.throws(() => E.createBundle({ root: join(root, "link"), operationId: "op", bundleId: "b2", files: files(), now: "t" }), (e) => e.code === "symlink_in_path");
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
