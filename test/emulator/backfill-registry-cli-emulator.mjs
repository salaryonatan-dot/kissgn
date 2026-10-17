// Marjin — BF2 real-process CLI check for the operator biz_access backfill (independent BF1 review BF1-R-01).
// Runs THIS checkout's unchanged entry, `node scripts/backfill-biz-access.mjs …`, as REAL child processes: main() → the real
// firebase-admin module (initializeApp / getDatabase) → project verification → the real Admin SDK transport → the local RTDB
// emulator (demo namespace, synthetic data only). No module, function or database is substituted; the child gets only a demo
// FIREBASE_CONFIG (validated below) and the emulator host. This is the CLI-initialization evidence; BF-01..BF-10 exercise the pure
// planner and runBackfill over an in-memory database and are NOT entry evidence.
//   BFC-00 the entry initializes: dry-run exits 0, prints "project verified" and the plan digest, writes nothing
//   BFC-01 absent / ambiguous / malformed / unregistered registry: dry-run 0 and nothing written; --apply with the printed digest → 5,
//          "APPLY REFUSED", nothing written
//   BFC-02 registered registry: --apply with the printed digest → 0 and exactly the planned leaf is added; a re-apply is a no-op
//   BFC-03 --apply without a digest / with a foreign digest → 5; without --confirm-production → dry-run 0; --reconcile → 0; nothing written
//   BFC-04 project mismatch → 4 before any summary is printed, nothing written; with an unreachable database it still exits 4 promptly
//          (no database contact before verification)
//   BFC-05 malformed tenant → 3 ("STOP: malformed"); --allow-malformed dry-run 0; its --apply with its own digest → 5; nothing written
//   BFC-06 argument errors (no --env / no --project / --apply with --cleanup) → 2 before initialization, nothing written
//
// Deliberately NOT named *.test.mjs (it needs the emulator). Run:
//   bash test/support/p1-r7-emu-run.sh <checkout> <abs logs> bf-cli=test/emulator/backfill-registry-cli-emulator.mjs
import admin from "firebase-admin";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { validateFirebaseConfig } from "./rtdb-authorization-matrix.mjs";

const PROJECT = "demo-marjin-rules", NAMESPACE = "demo-marjin-rules-default-rtdb";
const EMU = "127.0.0.1:9000", DB_URL = `http://${EMU}?ns=${NAMESPACE}`;
const DEAD = "127.0.0.1:9";   // a closed local port (discard): never a listener in this harness
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ENTRY = join(ROOT, "scripts", "backfill-biz-access.mjs");
const fail = (m) => { console.error(`SAFETY ABORT: ${m}`); process.exit(2); };
if (process.env.GCLOUD_PROJECT !== PROJECT) fail(`GCLOUD_PROJECT must be ${PROJECT}`);
if (process.env.GOOGLE_CLOUD_PROJECT !== PROJECT) fail(`GOOGLE_CLOUD_PROJECT must be ${PROJECT}`);
if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== EMU) fail(`FIREBASE_DATABASE_EMULATOR_HOST must be ${EMU}`);
if (process.env.GOOGLE_APPLICATION_CREDENTIALS) fail("GOOGLE_APPLICATION_CREDENTIALS must be absent");
const CHILD_CONFIG = JSON.stringify({ projectId: PROJECT, databaseURL: DB_URL });
const fc = validateFirebaseConfig(CHILD_CONFIG);
if (!fc.ok) fail(`child FIREBASE_CONFIG rejected: ${fc.reason}`);
const childEnv = () => {
  const e = { ...process.env, FIREBASE_CONFIG: CHILD_CONFIG };
  for (const k of ["GOOGLE_APPLICATION_CREDENTIALS", "FIREBASE_DATABASE_URL", "UPSTASH_REDIS_REST_URL", "UPSTASH_REDIS_REST_TOKEN"]) delete e[k];
  if (e.FIREBASE_DATABASE_EMULATOR_HOST !== EMU || e.GCLOUD_PROJECT !== PROJECT) fail("child environment is not the demo emulator");
  return e;
};
/** The real entry as a child process (cwd = this checkout). */
const cli = (args, envOverride = {}, timeout = 60000) => {
  const r = spawnSync(process.execPath, [ENTRY, ...args], { cwd: ROOT, env: { ...childEnv(), ...envOverride }, encoding: "utf8", timeout });
  return { code: r.status, signal: r.signal, out: (r.stdout || "") + (r.stderr || "") };
};

const app = admin.initializeApp({ databaseURL: DB_URL, projectId: PROJECT }, "bf-cli-observer-" + process.pid);
const db = app.database();
const env = (v) => ({ _v: JSON.stringify(v) });
const REGS = {
  absent: undefined,
  ambiguous: env([{ id: "bizA" }, { id: " bizA" }]),
  malformed: { _v: "[{" },
  unregistered: env([{ id: "bizQ" }]),
  registered: env([{ id: "bizA" }]),
};
const state = (reg) => ({ tenants: { tA: {
  roles: { sub1: "viewer", own: "owner" }, members: { sub1: true, own: true },
  app: { users: env([{ firebaseUid: "sub1", role: "viewer", allowedBizIds: ["bizA"] }, { firebaseUid: "own", role: "owner" }]), ...(reg === undefined ? {} : { business: reg }) },
  "biz:bizA:entries": { _v: "[]" }, unrelated: { keep: [1, "two", { three: 3 }] },
} } });
const GRANT = "tenants/tA/biz_access/bizA/sub1";
const all = async () => (await db.ref("/").once("value")).val();
const canon = (v) => Array.isArray(v) ? v.map(canon) : v && typeof v === "object" ? Object.fromEntries(Object.keys(v).sort().map((k) => [k, canon(v[k])])) : v;
const same = (a, b) => JSON.stringify(canon(a)) === JSON.stringify(canon(b));
const digestOf = (out) => (out.match(/"planDigest": "([0-9a-f]{64})"/) || [])[1] || null;
const BASE = ["--env=emu", `--project=${PROJECT}`];
const APPLY = (digest) => [...BASE, "--apply", `--confirm-production=${PROJECT}`, ...(digest === undefined ? [] : [`--expect-plan=${digest}`])];
const first = (out) => out.split("\n").find((l) => l.trim()) || "";

const results = []; let failures = 0;
async function run(id, description, fn) {
  try { const notes = await fn(); results.push({ id, status: "PASS", description, notes: notes ?? "" }); }
  catch (e) { failures++; results.push({ id, status: "FAIL", description, notes: (e && e.stack) || String(e) }); }
}
const ok = (c, m) => { if (!c) throw new Error(m); };
const exitIs = (r, code, m) => ok(r.code === code, `${m}: expected exit ${code}, got ${r.code}${r.signal ? " / " + r.signal : ""} — ${first(r.out)}`);

await run("BFC-00", "the real entry initializes the Admin SDK and verifies the project before reading; dry-run writes nothing", async () => {
  await db.ref("/").set(state(REGS.registered)); const before = await all();
  const r = cli(BASE);
  exitIs(r, 0, "dry-run");
  ok(!/is not a function/.test(r.out), "no initialization TypeError");
  ok(r.out.includes(`project verified: ${PROJECT}`), "project verified line printed");
  ok(r.out.indexOf("project verified") < r.out.indexOf("biz_access backfill summary"), "verification precedes the read");
  ok(digestOf(r.out), "plan digest printed"); ok(/DRY-RUN — NO WRITES/.test(r.out), "dry-run banner");
  ok(same(await all(), before), "nothing written");
  return first(r.out);
});

for (const name of ["absent", "ambiguous", "malformed", "unregistered"]) {
  await run(`BFC-01/${name}`, `${name} registry: dry-run 0, --apply with the printed digest → 5, nothing written`, async () => {
    await db.ref("/").set(state(REGS[name])); const before = await all();
    const dry = cli(BASE); exitIs(dry, 0, "dry-run");
    const digest = digestOf(dry.out); ok(digest, "digest printed"); ok(/REFUSED \(not written\)/.test(dry.out), "the refused target is listed");
    ok(same(await all(), before), "dry-run wrote nothing");
    const ap = cli(APPLY(digest)); exitIs(ap, 5, "apply");
    ok(/APPLY REFUSED — /.test(ap.out), "refusal line");
    ok((await db.ref(GRANT).once("value")).val() === null, "no grant"); ok(same(await all(), before), "nothing written");
    return (ap.out.match(/APPLY REFUSED[^\n]*/) || [""])[0].slice(0, 160);
  });
}

await run("BFC-02", "registered registry: --apply with the printed digest → 0 and exactly the planned leaf is added; re-apply is a no-op", async () => {
  await db.ref("/").set(state(REGS.registered)); const before = await all();
  const dry = cli(BASE); exitIs(dry, 0, "dry-run"); const digest = digestOf(dry.out); ok(digest, "digest");
  const ap = cli(APPLY(digest)); exitIs(ap, 0, "apply"); ok(/\ndone\.\n?/.test(ap.out), "done line");
  const after = await all();
  ok(after.tenants.tA.biz_access?.bizA?.sub1 === true, "the grant is written");
  ok(!after.tenants.tA.biz_access?.bizA?.own, "the owner is skipped");
  const expected = structuredClone(before); expected.tenants.tA.biz_access = { bizA: { sub1: true } };
  ok(same(after, expected), "exactly the planned leaf differs; everything else is preserved");
  const again = cli(APPLY(digest)); exitIs(again, 0, "re-apply"); ok(same(await all(), expected), "re-apply is a no-op");
});

await run("BFC-03", "--apply without / with a foreign digest → 5; without --confirm-production → dry-run 0; --reconcile → 0; nothing written", async () => {
  await db.ref("/").set(state(REGS.registered)); const before = await all();
  const none = cli(APPLY()); exitIs(none, 5, "no digest"); ok(/missing --expect-plan/.test(none.out), "missing-digest reason");
  const foreign = cli(APPLY("f".repeat(64))); exitIs(foreign, 5, "foreign digest"); ok(/plan drift/.test(foreign.out), "drift reason");
  const unconfirmed = cli([...BASE, "--apply", "--expect-plan=" + "f".repeat(64)]); exitIs(unconfirmed, 0, "unconfirmed apply"); ok(/DRY-RUN — NO WRITES/.test(unconfirmed.out), "stays a dry-run");
  const rec = cli([...BASE, "--reconcile"]); exitIs(rec, 0, "reconcile"); ok(/reconcile: 1 missing/.test(rec.out), "reconcile reports the missing grant");
  ok(same(await all(), before), "nothing written");
});

await run("BFC-04", "project mismatch → 4 before any read; nothing written", async () => {
  await db.ref("/").set(state(REGS.registered)); const before = await all();
  const r = cli(["--env=emu", "--project=demo-other", "--apply", "--confirm-production=demo-other", "--expect-plan=" + "0".repeat(64)]);
  exitIs(r, 4, "mismatch"); ok(/ABORT \(project verification\): project mismatch/.test(r.out), "mismatch reason");
  ok(!r.out.includes("biz_access backfill summary"), "no snapshot summary (no read)");
  ok(same(await all(), before), "nothing written");
  // no database contact at all before verification: the child's database is a closed local port, so any read before the project
  // check would hang until the timeout; the entry must exit 4 promptly
  const deadUrl = `http://${DEAD}?ns=${NAMESPACE}`;
  ok(validateFirebaseConfig(JSON.stringify({ projectId: PROJECT, databaseURL: deadUrl })).ok, "dead-port config is demo/local");
  const t0 = Date.now();
  const d = cli(["--env=emu", "--project=demo-other"], { FIREBASE_DATABASE_EMULATOR_HOST: DEAD, FIREBASE_CONFIG: JSON.stringify({ projectId: PROJECT, databaseURL: deadUrl }) }, 20000);
  exitIs(d, 4, "mismatch with an unreachable database"); ok(Date.now() - t0 < 15000, "exits before any database round-trip");
  return `unreachable-database mismatch exit ${d.code} in ${Date.now() - t0} ms`;
});

await run("BFC-05", "malformed tenant → 3; --allow-malformed dry-run 0; its --apply with its own digest → 5; nothing written", async () => {
  const s = state(REGS.registered); s.tenants.tBad = { app: { users: { _v: "{" } } };
  await db.ref("/").set(s); const before = await all();
  const stop = cli(BASE); exitIs(stop, 3, "malformed stop"); ok(/STOP: malformed tenant data \(tBad\)/.test(stop.out), "stop reason");
  const allow = cli([...BASE, "--allow-malformed"]); exitIs(allow, 0, "allow-malformed dry-run");
  const digest = digestOf(allow.out); ok(digest, "digest");
  const ap = cli([...APPLY(digest), "--allow-malformed"]); exitIs(ap, 5, "allow-malformed apply");
  ok(/malformed tenant data — report only/.test(ap.out), "report-only reason");
  ok(same(await all(), before), "nothing written");
});

await run("BFC-06", "argument errors → 2 before initialization; nothing written", async () => {
  await db.ref("/").set(state(REGS.registered)); const before = await all();
  exitIs(cli([`--project=${PROJECT}`]), 2, "no --env");
  exitIs(cli(["--env=emu"]), 2, "no --project");
  exitIs(cli([...BASE, "--apply", "--cleanup", `--confirm-production=${PROJECT}`]), 2, "--apply with --cleanup");
  ok(same(await all(), before), "nothing written");
});

await db.ref("/").set(null);
await app.delete();
console.log(JSON.stringify({ entry: "scripts/backfill-biz-access.mjs", node: process.version, results }, null, 1));
console.log(failures ? `FAILED ${failures}` : `ALL ${results.length} BFC CASES PASSED`);
process.exit(failures ? 1 : 0);
