// Core/F1 R4 — MARJIN_CANON/1: the ONE canonical serialization + digest procedure, identical in the committed core
// (fincore/v1), the freshly compiled bundle, the compiled server loader and the trusted writer.
//   CN-01 sha256Hex equals node:crypto SHA-256 over UTF-8 for ASCII, Hebrew, emoji, lone surrogates and every
//         padding boundary (0..200 bytes, 55/56/63/64/65 explicitly)
//   CN-02 canonicalJson: recursive key order independence, array order preserved, scalars exactly as JSON.stringify
//   CN-03 the four sites compute identical digests; the writer's attestation digest and the stored review digest
//         are the core's canonicalDigest of the documented payloads
//   CN-04 the core procedure is pure (no Math / Date / Number / parse*, no imports) — the G-S1 forbidden-identifier rule
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { loadCommitted, loadCompiled, REPO } from "../support/fincore-load.mjs";
import { compileServer } from "../support/server-reader-harness.mjs";
import { loadWriter } from "../support/f1-writer-harness.mjs";

const F = await loadCommitted(), BROWSER = await loadCompiled();
const SERVER = compileServer(), SRV = await SERVER.import("src/finance/canonical.js"), SRV_HIST = await SERVER.import("src/finance/costHistory.js");
const W = await loadWriter(REPO);
const C = F.finance.canonical;
const nodeSha = (text) => createHash("sha256").update(Buffer.from(text, "utf8")).digest("hex");

test("CN-01 sha256Hex ≡ node:crypto over UTF-8 at every padding boundary and for non-ASCII input", () => {
  const samples = ["", "abc", "message digest", "שלום עולם — מרג'ין", "😀🍕 cost", "a\ud800b", "\udc00", "ab😀cd",
    "The quick brown fox jumps over the lazy dog", JSON.stringify({ a: [1, 2, { b: null }], c: "x" })];
  for (let n = 0; n <= 200; n += 1) samples.push("x".repeat(n));
  for (const n of [55, 56, 63, 64, 65, 119, 120, 127, 128, 129]) samples.push("א".repeat(Math.ceil(n / 2)).slice(0, n));
  for (const s of samples) {
    const expected = nodeSha(s);
    assert.equal(C.sha256Hex(s), expected, JSON.stringify(s).slice(0, 40));
    assert.equal(BROWSER.finance.canonical.sha256Hex(s), expected);
    assert.equal(SRV.sha256Hex(s), expected);
  }
  assert.throws(() => C.sha256Hex(7)); assert.throws(() => C.sha256Hex(undefined));
  assert.deepEqual(C.utf8Bytes("€"), [0xe2, 0x82, 0xac]); assert.deepEqual(C.utf8Bytes("😀"), [0xf0, 0x9f, 0x98, 0x80]);
  assert.deepEqual(C.utf8Bytes("\ud800"), [0xef, 0xbf, 0xbd], "a lone surrogate encodes as U+FFFD, exactly like TextEncoder");
});

test("CN-02 canonicalJson is key-order independent at every depth, keeps array order and JSON.stringify scalar rules; it refuses unserializable values", () => {
  const a = { z: 1, a: { d: [3, { y: 1, x: 2 }], c: "s" }, m: null, b: true, n: 1.5, big: 1e21, neg: -0 };
  const b = { b: true, m: null, n: 1.5, a: { c: "s", d: [3, { x: 2, y: 1 }] }, z: 1, big: 1e21, neg: -0 };
  assert.equal(C.canonicalJson(a), C.canonicalJson(b));
  assert.equal(C.canonicalJson(a), '{"a":{"c":"s","d":[3,{"x":2,"y":1}]},"b":true,"big":1e+21,"m":null,"n":1.5,"neg":0,"z":1}');
  assert.notEqual(C.canonicalJson([1, 2]), C.canonicalJson([2, 1]), "array order is material");
  assert.equal(C.canonicalJson("3100"), '"3100"'); assert.equal(C.canonicalJson(3100), "3100", "a string amount and a number never collide");
  assert.equal(C.canonicalJson({ a: undefined, b: 1 }), '{"b":1}', "undefined members are omitted exactly like JSON.stringify");
  assert.throws(() => C.canonicalJson(undefined)); assert.throws(() => C.canonicalJson(() => 1));
  const cyc = {}; cyc.self = cyc; assert.throws(() => C.canonicalJson(cyc));
  assert.equal(C.canonicalDigest(a), nodeSha(C.canonicalJson(a)));
  assert.equal(BROWSER.finance.canonical.canonicalJson(b), C.canonicalJson(a)); assert.equal(SRV.canonicalJson(b), C.canonicalJson(a));
  assert.equal(C.CANONICAL_VERSION, "MARJIN_CANON/1"); assert.equal(SRV.CANONICAL_VERSION, "MARJIN_CANON/1"); assert.equal(BROWSER.finance.canonical.CANONICAL_VERSION, "MARJIN_CANON/1");
});

test("CN-03 committed core ≡ compiled bundle ≡ compiled server ≡ writer: review digest, flag identity and attestation digest are canonicalDigest of the documented payloads", () => {
  const T = "tenantA", B = "bizA", A = "00000000-0000-4000-8000-0000000000a1";
  const wire = { versionId: A, schema: "MARJIN_COSTV/1", effectiveFrom: "2026-10-02", recordedAt: 1759395600000, recordedBy: "owner", basis: "recorded",
    globalEmployeesCount: 1, fixedItemsCount: 1, rent: { mode: "none" }, royalty: { mode: "none" }, predecessorVersionId: "none",
    globalEmployees: [{ employeeKey: "g1", monthlyEmployerCost: "10000" }], fixedItems: [{ itemKey: "f1", monthlyAmount: "3100" }] };
  const { recordedAt: _r, ...version } = wire;
  const expectedDigest = nodeSha(C.canonicalJson({ schema: "MARJIN_COST_INTENT/2", tenantId: T, bizId: B, version }));
  assert.equal(F.costHistory.intentDigestOf(T, B, wire), expectedDigest, "committed core");
  assert.equal(BROWSER.costHistory.intentDigestOf(T, B, wire), expectedDigest, "compiled bundle");
  assert.equal(SRV_HIST.intentDigestOf(T, B, wire), expectedDigest, "compiled server");
  const flag = { tenantId: T, bizId: B, versionId: A, intentDigest: expectedDigest, outcome: "revoked_during_commit" };
  const expectedFlag = nodeSha(C.canonicalJson({ schema: "MARJIN_COST_AUDIT/3", ...flag }));
  assert.equal(F.costHistory.flagOperationIdOf(flag), expectedFlag); assert.equal(BROWSER.costHistory.flagOperationIdOf(flag), expectedFlag); assert.equal(SRV_HIST.flagOperationIdOf(flag), expectedFlag);
  const body = { versionId: A, expectedHead: null, effectiveFrom: "2026-10-01", basis: "attested_retroactive", globalEmployees: wire.globalEmployees, fixedItems: wire.fixedItems, rent: wire.rent, royalty: wire.royalty, attestationReason: "invoice" };
  const att = { effectiveFrom: body.effectiveFrom, basis: body.basis, globalEmployees: body.globalEmployees, fixedItems: body.fixedItems, rent: body.rent, royalty: body.royalty, attestationReason: body.attestationReason };
  assert.equal(W.attestationDigest(body), C.canonicalDigest(att), "the writer's attestation digest is the core's canonical digest");
  assert.equal(W.attestationDigest(body), nodeSha(C.canonicalJson(att)));
  assert.deepEqual(F.costHistory.contract, { review: "MARJIN_COSTR/4", flagAudit: "MARJIN_COST_AUDIT/3", decisionAudit: "MARJIN_COST_DECISION/1", intent: "MARJIN_COST_INTENT/2", states: ["pending", "cleared", "flagged", "rejected"], decisions: ["accepted", "rejected"] });
  assert.deepEqual(BROWSER.costHistory.contract, F.costHistory.contract);
});

test("CN-04 the canonical procedure is pure core code: no imports, no Math / Date / Number / parseFloat / parseInt / toFixed, and the generated bundle carries it byte-for-byte from the compiled source", () => {
  const src = readFileSync(join(REPO, "src/finance/canonical.ts"), "utf8");
  assert.doesNotMatch(src, /^\s*import\s/m, "no imports");
  for (const bad of ["Math.", ".toFixed(", "parseFloat", "parseInt", "Date.now", "new Date(", "Number(", "crypto", "require("]) assert.ok(!src.includes(bad), "forbidden in the core: " + bad);
  const gen = readFileSync(join(REPO, "fincore/v1/finance/canonical.js"), "utf8");
  for (const bad of ["Math.", ".toFixed(", "parseFloat", "parseInt", "Date.now", "new Date(", "Number(", "crypto", "require("]) assert.ok(!gen.includes(bad), "forbidden in the bundle: " + bad);
  assert.ok(gen.includes('export const CANONICAL_VERSION = "MARJIN_CANON/1"'));
  const manifest = JSON.parse(readFileSync(join(REPO, "fincore/v1/MANIFEST.json"), "utf8"));
  assert.ok(manifest.sources.includes("src/finance/canonical.ts"), "the manifest closure names the canonical source");
  const entry = manifest.files.find((f) => f.path === "finance/canonical.js");
  assert.ok(entry, "the manifest lists the generated canonical module");
  assert.equal(entry.sha256, createHash("sha256").update(readFileSync(join(REPO, "fincore/v1/finance/canonical.js"))).digest("hex"), "manifest digest equals the generated bytes");
});
