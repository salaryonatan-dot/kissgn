// DP2 emulator worker: ONE delivery attempt in its OWN process (own Admin SDK app, own connection) against the local emulator.
// argv: <route scheduled|manual> <businessDate> <startAtMs> <mode accept|exit-after-handoff|exit-after-admission> [clockMs]
// Prints one JSON line { route, outcome, code, handed } (unless it exits on purpose). Local only; fake send; no e-mail.
import admin from "firebase-admin";
import * as E from "../../lib/emailDelivery.js";
const PROJECT = "demo-marjin-rules", DB_URL = "http://127.0.0.1:9000?ns=demo-marjin-rules-default-rtdb";
if (process.env.FIREBASE_DATABASE_EMULATOR_HOST !== "127.0.0.1:9000" || process.env.GCLOUD_PROJECT !== PROJECT || process.env.GOOGLE_APPLICATION_CREDENTIALS) {
  console.error("SAFETY ABORT"); process.exit(2);
}
const [route, date, startAt, mode = "accept", clockArg] = process.argv.slice(2);
const db = admin.initializeApp({ databaseURL: DB_URL }, "w" + process.pid).database();
const clock = clockArg ? () => Number(clockArg) : () => Date.now();
const T = "tA", B = "bA", TO = "owner-a@example.test";
let handed = 0;
const send = async () => {
  const a = E.currentDeliveryAttempt();
  if (mode === "exit-after-admission") {   // stop inside the hand-off boundary, right after the admission transaction commits
    const orig = db.ref.bind(db);
    db.ref = (p) => { const x = orig(p); if (String(p).startsWith(E.MANUAL_ATTEMPT_ROOT + "/") || String(p).startsWith(E.RECEIPT_ROOT + "/")) { const t = x.transaction.bind(x); x.transaction = async (fn, ...r) => { if (await admissionHeld()) process.exit(0); return t(fn, ...r); }; } return x; };
  }
  await a.beforeTransport();
  handed++;
  if (mode === "exit-after-handoff") process.exit(0);   // the provider has the message; the process is gone
  await new Promise((r) => setTimeout(r, 50));
  a.info = { accepted: [TO], rejected: [], response: "250 2.0.0 OK" };
};
const admissionHeld = async () => ((await admin.app("w" + process.pid).database().ref(E.admissionPath("daily_snapshot", T, B, date)).once("value")).val() || {}).state === "in_flight";
while (Date.now() < Number(startAt)) await new Promise((r) => setTimeout(r, 2));
const r = route === "scheduled"
  ? await E.deliverWithReceipt({ db, tenantId: T, bizId: B, businessDate: date, recipient: TO, send, clock, gate: E.makeDailyDeliveryGate(db, date, { clock }) })
  : await E.deliverManualDaily({ db, tenantId: T, bizId: B, businessDate: date, recipient: TO, recipientSelection: "owner", actorRole: "owner", send, clock });
console.log(JSON.stringify({ route, outcome: r.outcome, code: r.code ?? null, handed }));
await admin.app("w" + process.pid).delete();
process.exit(0);
