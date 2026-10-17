// Marjin — CANARY TOOLING transport: environment gates (CT-25, every row), read-only vs writable vs
// dry-run surfaces, one-business scope, source-bound entries transaction (CT-08/12/13/31), policy io
// adapter, Rules fingerprint without git, REST probe form (emulator `?auth=` only), no legacy-write probe.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import * as T from "../../tools/storage-v2/canary-transport.mjs";
import * as C from "../../tools/storage-v2/canary-contract.mjs";
import { createStoragePolicyControl } from "../../tools/storage-v2/policy.mjs";
import { createStorageV2Upgrader } from "../../tools/storage-v2/upgrade.mjs";
import { loadProductionWindow } from "../../tools/storage-v2/production-window.mjs";
import * as X from "../support/canary-fixtures.mjs";

const H = C.helpersFrom(loadProductionWindow());
const SA = { type: "service_account", project_id: "example-prod-project", client_email: "sa@example", private_key: "-----BEGIN PRIVATE KEY-----\nx\n-----END PRIVATE KEY-----\n" };
const fsOk = { fsExists: () => true, fsStat: () => ({ mode: 0o100600 }), readFile: () => JSON.stringify(SA) };

test("environment gates fail closed on every row (CT-25)", () => {
  const emu = X.manifestFor(), prod = X.manifestFor({ environment: "production" });
  const expectFail = (args, code) => assert.throws(() => T.resolveEnvironment({ adminApps: [], ...args }), (e) => { assert.equal(e.code, code, JSON.stringify(args.envFlag) + " " + e.code); assert.equal(e.exitCode, 14); return true; });
  expectFail({ manifest: emu, envFlag: undefined, processEnv: X.EMU_ENV }, "environment_not_explicit");
  expectFail({ manifest: emu, envFlag: "production", processEnv: X.EMU_ENV }, "environment_mismatch");
  expectFail({ manifest: emu, envFlag: "emulator", processEnv: X.EMU_ENV, adminApps: [{}] }, "foreign_admin_app");
  expectFail({ manifest: emu, envFlag: "emulator", processEnv: {} }, "emulator_host_required");
  expectFail({ manifest: emu, envFlag: "emulator", processEnv: { FIREBASE_DATABASE_EMULATOR_HOST: "10.0.0.5:9000" } }, "emulator_host_required");
  expectFail({ manifest: emu, envFlag: "emulator", processEnv: { FIREBASE_DATABASE_EMULATOR_HOST: X.EMU_HOST } }, "emulator_project_required");
  expectFail({ manifest: emu, envFlag: "emulator", processEnv: { FIREBASE_DATABASE_EMULATOR_HOST: X.EMU_HOST, GCLOUD_PROJECT: "marjin-real" } }, "emulator_project_required");
  expectFail({ manifest: X.diagnosticManifest({ databaseURL: "http://127.0.0.1:9001?ns=demo-marjin-rules-default-rtdb", approved: { rulesBlob: X.DIAGNOSTIC_RULES_BLOB } }, "CT-25 emulator_url_mismatch control"), envFlag: "emulator", processEnv: X.EMU_ENV }, "emulator_url_mismatch");   // RF2: a mis-shaped manifest is diagnostic and never carries the candidate outside its scope
  expectFail({ manifest: emu, envFlag: "emulator", processEnv: { ...X.EMU_ENV, GOOGLE_APPLICATION_CREDENTIALS: "/x" } }, "credentials_forbidden_in_emulator");
  expectFail({ manifest: emu, envFlag: "emulator", processEnv: X.EMU_ENV, credentialsFile: "/x/sa.json" }, "credentials_forbidden_in_emulator");
  const e = T.resolveEnvironment({ manifest: emu, envFlag: "emulator", processEnv: X.EMU_ENV, adminApps: [] }); assert.equal(e.mode, "emulator"); assert.equal(e.credentialsFile, null);
  expectFail({ manifest: prod, envFlag: "production", processEnv: X.EMU_ENV, credentialsFile: "/x" }, "emulator_host_set_in_production");
  expectFail({ manifest: prod, envFlag: "production", processEnv: { GOOGLE_APPLICATION_CREDENTIALS: "/x" }, credentialsFile: "/x" }, "credentials_env_forbidden");
  expectFail({ manifest: prod, envFlag: "production", processEnv: { FIREBASE_SA_JSON: "{}" }, credentialsFile: "/x" }, "credentials_env_forbidden");
  expectFail({ manifest: prod, envFlag: "production", processEnv: { GCLOUD_PROJECT: "other" }, credentialsFile: "/x" }, "project_env_mismatch");
  expectFail({ manifest: prod, envFlag: "production", processEnv: {} }, "credentials_file_required");
  expectFail({ manifest: prod, envFlag: "production", processEnv: {}, credentialsFile: "/x", fsExists: () => false }, "credentials_file_missing");
  expectFail({ manifest: prod, envFlag: "production", processEnv: {}, credentialsFile: "/x", fsExists: () => true, fsStat: () => ({ mode: 0o100644 }) }, "credentials_file_permissions");
  expectFail({ manifest: prod, envFlag: "production", processEnv: {}, credentialsFile: "/x", ...fsOk, readFile: () => "not json" }, "credentials_file_unreadable");
  expectFail({ manifest: prod, envFlag: "production", processEnv: {}, credentialsFile: "/x", ...fsOk, readFile: () => JSON.stringify({ type: "authorized_user" }) }, "credentials_file_shape");
  expectFail({ manifest: prod, envFlag: "production", processEnv: {}, credentialsFile: "/x", ...fsOk, readFile: () => JSON.stringify({ ...SA, project_id: "another" }) }, "credentials_project_mismatch");
  const p = T.resolveEnvironment({ manifest: prod, envFlag: "production", processEnv: {}, credentialsFile: "/x", adminApps: [], ...fsOk }); assert.equal(p.mode, "production"); assert.equal(p.serviceAccount.project_id, "example-prod-project");
  assert.ok(Object.isFrozen(p));
});

test("read surface has no write method; writable dry-run throws before any write; scope is ONE business", async () => {
  const db = X.fakeRtdb(); X.seedBusiness(db); X.seedBusiness(db, { bizId: "bizB", businessName: "Other" });
  const m = X.manifestFor();
  const ro = T.createTransport({ app: X.fakeApp(db), manifest: m });
  assert.equal(ro.boundTransactNode, undefined); await assert.rejects(() => ro.policyIo.transactControl(X.T, X.B, () => null), (e) => e.code === "read_only_transport");
  const en = await ro.readEntries(); assert.equal(en.ok, true); assert.equal(typeof en.value._v, "string");
  const ctl = await ro.readControl(); assert.equal(ctl.value.phase, "legacy");
  const ctx = await ro.readContext(); assert.equal(JSON.parse(ctx.config.value._v).businessName, X.NAME);
  assert.deepEqual(Object.keys(ro.paths).filter((k) => typeof ro.paths[k] === "string").every((k) => ro.paths[k].includes("bizA") || ro.paths[k].includes("tenantA")), true);
  const dry = T.createTransport({ app: X.fakeApp(db), manifest: m, writable: true, dryRun: true });
  await assert.rejects(() => dry.policyIo.transactControl(X.T, X.B, () => null), (e) => e.code === "dry_run");
  await assert.rejects(() => dry.boundTransactNode({ expectedDigest: "x" }).transactNode(X.T, `biz:${X.B}:entries`, () => null), (e) => e.code === "dry_run");
  const w = T.createTransport({ app: X.fakeApp(db), manifest: m, writable: true });
  await assert.rejects(() => w.policyIo.transactControl(X.T, "bizB", () => null), (e) => e.code === "target_mismatch");
  await assert.rejects(() => w.boundTransactNode({ expectedDigest: "x" }).transactNode(X.T, "biz:bizB:entries", () => null), (e) => e.code === "target_mismatch");
  assert.equal(db.writes.length, 0);
  db.hooks.failReads = (p) => p.endsWith(":entries"); const denied = await ro.readEntries(); assert.equal(denied.ok, false); assert.equal(denied.error, "permission_denied");
  ro.detach(); w.detach();
});

test("source-bound entries transaction: drift ⇒ abort with the node preserved, absent ⇒ no core run, warm cache ⇒ exactly one core call (CT-08/12/13/31)", async () => {
  const db = X.fakeRtdb(); X.seedBusiness(db, { control: X.QUIESCED() });
  const m = X.manifestFor(); const w = T.createTransport({ app: X.fakeApp(db), manifest: m, writable: true });
  const raw = X.entriesOf(db); const digest = C.digestV1(raw);
  const { upgradeBusinessToV2 } = createStorageV2Upgrader({ preflightLegacyNode: H.preflightLegacyNode, isV2Node: H.isV2Node, stampRow: H.stampRow, generationFirst: H.GENERATION_FIRST });
  let coreCalls = 0; const spy = async (io, ids) => { coreCalls++; return upgradeBusinessToV2(io, ids); };
  // drift: the node changed between capture and the callback
  db.seed(`tenants/${X.T}/biz:${X.B}:entries`, { _v: JSON.stringify([...X.LEGACY_ROWS(), X.row("z", "2026-09-09")]) });
  const b1 = w.boundTransactNode({ expectedDigest: digest });
  const r1 = await spy({ transactNode: b1.transactNode }, { tenantId: X.T, bizId: X.B });
  assert.equal(r1.status, "failed"); assert.equal(b1.stats.drift, true); assert.equal(b1.stats.coreRuns, 0); assert.equal(X.entriesOf(db).schemaVersion, undefined);
  // absent: null callback ⇒ abort, never "convert an empty business by accident"
  db.seed(`tenants/${X.T}/biz:${X.B}:entries`, null);
  const b2 = w.boundTransactNode({ expectedDigest: digest }); const r2 = await spy({ transactNode: b2.transactNode }, { tenantId: X.T, bizId: X.B });
  assert.equal(r2.status, "failed"); assert.equal(b2.stats.nullRuns, 1); assert.equal(b2.stats.coreRuns, 0); assert.equal(X.entriesOf(db), null);
  // happy path with a cold first run: the bound callback still runs the core exactly once
  db.seed(`tenants/${X.T}/biz:${X.B}:entries`, raw); await w.warmEntries(); db.hooks.coldCacheOnce = true;
  const b3 = w.boundTransactNode({ expectedDigest: digest }); const r3 = await spy({ transactNode: b3.transactNode }, { tenantId: X.T, bizId: X.B });
  assert.equal(r3.status, "committed", JSON.stringify(r3)); assert.equal(b3.stats.coreRuns, 1); assert.equal(X.entriesOf(db).schemaVersion, 2); assert.equal(X.entriesOf(db)._v, raw._v);
  assert.equal(coreCalls, 3, "spy counts calls; each bound run invoked the unchanged core adapter at most once");
  // policy io adapter round trip through the real control plane
  const P = createStoragePolicyControl(w.policyIo);
  const q = await P.inspect(X.T, X.B); assert.equal(q.parsed.record.phase, "quiesced"); assert.equal(q.entriesMode, "v2");
  const act = await P.activateV2(X.T, X.B, { expectedRevision: 2, operator: "alice", operationId: "canary-op-1" }); assert.equal(act.record.phase, "v2_active"); assert.equal(act.record.policyRevision, 3);
  await assert.rejects(() => P.activateV2(X.T, X.B, { expectedRevision: 2, operator: "alice", operationId: "canary-op-1" }), (e) => e.code === "stale_revision");
  // listeners: awaitEntriesChange resolves on a write and times out otherwise
  const p = w.awaitEntriesChange(300); await db.ref(`tenants/${X.T}/biz:${X.B}:entries/rows/${X.uuid("c1")}/sales`).set("7"); assert.equal((await p).changed, true);
  assert.equal((await w.awaitEntriesChange(50)).changed, false);
  w.detach();
});

test("Rules fingerprint: byte / structural / mismatch / UNKNOWN without invoking git; repo identity hashes blobs itself", () => {
  // RF1 (T-RF1-GATE): the local gate expectation is CANDIDATE_RULES_BLOB (the checked-out integration Rules); the release pin
  // APPROVED_RULES_BLOB is unchanged and is held apart by test/storage-v2/rf1-rules-gate.test.mjs (RF-01 / RF-02).
  const text = readFileSync(new URL("../../database.rules.json", import.meta.url), "utf8");
  assert.equal(T.gitBlobId(text), X.CANDIDATE_RULES_BLOB, "the checked-out Rules are the local gate's candidate expectation");
  assert.equal(T.rulesFingerprint({ text, approvedBlob: X.CANDIDATE_RULES_BLOB, root: X.ROOT }).match, "byte");
  assert.equal(T.rulesFingerprint({ text: JSON.stringify(JSON.parse(text), null, 4), approvedBlob: X.CANDIDATE_RULES_BLOB, root: X.ROOT }).match, "structural");
  const mm = T.rulesFingerprint({ text: text.replace("storage_v2_control", "storage_v2_controL"), approvedBlob: X.CANDIDATE_RULES_BLOB, root: X.ROOT }); assert.equal(mm.match, "mismatch"); assert.notEqual(mm.deployedRulesBlob, X.CANDIDATE_RULES_BLOB);
  assert.equal(T.rulesFingerprint({ text: null, approvedBlob: X.CANDIDATE_RULES_BLOB, root: X.ROOT }).match, "UNKNOWN");
  const id = T.repoIdentity(X.ROOT); assert.equal(id.blobs["database.rules.json"], X.CANDIDATE_RULES_BLOB); assert.equal(typeof id.nodeVersion, "string");
});

test("REST probe: emulator uses the `?auth=` query form (Bearer is admin-equivalent there), production uses Bearer; only control same-value PUT and reads exist", async () => {
  const emu = T.createRestProbe({ manifest: X.manifestFor(), token: "x".repeat(40) }); assert.equal(emu.form, "query");
  const prod = T.createRestProbe({ manifest: X.manifestFor({ environment: "production" }), token: "x".repeat(40) }); assert.equal(prod.form, "bearer");
  assert.throws(() => T.createRestProbe({ manifest: X.manifestFor(), token: "short" }), (e) => e.code === "token_invalid");
  assert.deepEqual(Object.keys(emu).sort(), ["authenticatedRead", "controlSameValueWrite", "form"]);
  const calls = []; const prev = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => { calls.push({ url: String(url), method: init.method || "GET", auth: init.headers && init.headers.Authorization }); return { status: 401, text: async () => "{\"error\":\"Permission denied\"}" }; };
  try {
    const r = await emu.authenticatedRead(); assert.equal(r.outcome, "DENIED"); assert.ok(calls[0].url.includes("auth=") && !calls[0].auth, "query form, no Bearer on the emulator");
    const wr = await emu.controlSameValueWrite("legacy"); assert.equal(wr.outcome, "DENIED"); assert.equal(calls[1].method, "PUT"); assert.ok(calls[1].url.includes("storage_v2_control/tenantA/bizA/phase.json"));
    await prod.authenticatedRead(); assert.ok(calls[2].auth.startsWith("Bearer ") && !calls[2].url.includes("auth="));
    globalThis.fetch = async () => ({ status: 200, text: async () => "\"legacy\"" }); assert.equal((await emu.controlSameValueWrite("legacy")).outcome, "ACCEPTED");
    globalThis.fetch = async () => ({ status: 500, text: async () => "boom" }); assert.equal((await emu.controlSameValueWrite("legacy")).outcome, "INCONCLUSIVE");
  } finally { globalThis.fetch = prev; }
  assert.ok(!calls.some((c) => /entries/.test(c.url) && c.method !== "GET"), "no write ever targets the entries node");
});
