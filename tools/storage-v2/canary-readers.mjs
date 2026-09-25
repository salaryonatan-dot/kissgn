// Storage V2 — CANARY TOOLING: the APPROVED server readers over CAPTURED snapshots.
//
// HARD BOUNDARY — this module:
//   • compiles the real `src/` + `lib/` readers once (reader-sandbox) and runs them against an
//     in-memory database seeded from a captured snapshot — NEVER against RTDB;
//   • the sandbox database DENIES every write (`set/update/remove/transaction` throw), the email
//     seam records and never sends, `fetch` is offline;
//   • imports NO job entry point (no proactive/insights/alerts runner, no snapshot endpoint) —
//     only the pure read computations the readers matrix already proves;
//   • numbers are compared at full precision by the contract (Object.is) and reported alongside
//     their roundtrip strings.

import { compileServer, makeDb, offlineFetch } from "./reader-sandbox.mjs";
import { CanaryError, EXIT, CONTRACT_VERSION } from "./canary-contract.mjs";

export const READER_SET = Object.freeze(["daily", "latestDate", "labor", "purchases", "dailyBuilder", "snapshot", "exceptions", "plannedData"]);
let mods = null;
export async function loadReaders() {
  if (mods) return mods;
  const srv = compileServer();
  const [DBLD, SB, DM, LR, PR, AS, EX] = await Promise.all(["src/analytics/dailyBuilder.js", "src/snapshot/snapshotBuilder.js", "src/repositories/analytics/dailyMetricsRepo.js", "src/repositories/analytics/laborRepo.js", "src/repositories/analytics/purchasesRepo.js", "src/services/analyticsService.js", "lib/repositories/entryExceptionsRepo.js"].map((m) => srv.import(m)));
  mods = { DBLD, SB, DM, LR, PR, AS, EX, compiledDir: srv.dir };
  return mods;
}
/** In-memory database that refuses writes; `set/update/remove/transaction` throw `deny_write`. */
export function denyWriteDb() {
  const raw = makeDb();
  const deny = () => { throw new CanaryError("deny_write", "reader sandbox refused a write", EXIT.STOP); };
  const wrap = (r) => ({ ...r, set: deny, update: deny, remove: deny, transaction: deny,
    child: (c) => wrap(r.child(c)), orderByChild: (k) => wrap(r.orderByChild(k)), orderByKey: () => wrap(r.orderByKey()), startAt: (k) => wrap(r.startAt(k)), endAt: (k) => wrap(r.endAt(k)), limitToLast: (n) => wrap(r.limitToLast(n)) });
  return { ref: (p, q) => wrap(raw.ref(p, q)), seed: raw.seed, read: raw.read, writes: raw.writes, store: raw.store };
}
/**
 * Seed a captured snapshot: { entries, config, fixed, suppliers, exceptions, businessName }.
 * Only the one business is present; `app/business` lists it so builders that consult the list still resolve it.
 */
export function seedSnapshot(db, { tenantId, bizId, snapshot }) {
  const s = snapshot;
  if (s.entries !== null && s.entries !== undefined) db.seed(`tenants/${tenantId}/biz:${bizId}:entries`, s.entries);
  if (s.config) db.seed(`tenants/${tenantId}/biz:${bizId}:config`, s.config);
  if (s.fixed) db.seed(`tenants/${tenantId}/biz:${bizId}:fixed`, s.fixed);
  if (s.suppliers) db.seed(`tenants/${tenantId}/biz:${bizId}:suppliers`, s.suppliers);
  if (s.exceptions) db.seed(`tenants/${tenantId}/entry_exceptions/${bizId}`, s.exceptions);
  db.seed(`tenants/${tenantId}/app/business`, { _v: JSON.stringify([{ id: bizId, name: s.businessName || bizId }]) });
  db.seed(`tenants/${tenantId}/members`, { canary_reader: true });
}
const plain = (v) => JSON.parse(JSON.stringify(v));
const sortRecs = (a) => a.slice().sort((x, y) => JSON.stringify(x).localeCompare(JSON.stringify(y)));
const numStrings = (v, out = {}, path = "$") => { if (typeof v === "number") out[path] = String(v); else if (v && typeof v === "object") for (const k of Object.keys(v)) numStrings(v[k], out, `${path}.${k}`); return out; };
const undefinedPaths = (v, p = "$", acc = []) => { if (v === undefined) acc.push(p); else if (v && typeof v === "object") for (const k of Object.keys(v)) undefinedPaths(v[k], `${p}.${k}`, acc); return acc; };
const stripDoc = (doc) => { const d = plain(doc); if (d && d.meta) { delete d.meta.createdAt; delete d.meta.builtAt; } return d; };
const stripSnap = (s) => { const x = plain(s); delete x.date; return x; };

/**
 * Run every approved reader over the snapshot. `dates` = representative business dates for
 * dailyBuilder. Returns { outputs, meta } — outputs keyed by READER_SET, with `errors` typed.
 */
export async function runReaders({ tenantId, bizId, snapshot, dates = [], range = { from: "2000-01-01", to: "2099-12-31" }, nowIso = new Date().toISOString() }) {
  const M = await loadReaders();
  const db = denyWriteDb();
  seedSnapshot(db, { tenantId, bizId, snapshot });
  const prevDb = globalThis.__DB, prevEmails = globalThis.__EMAILS, prevFetch = globalThis.fetch;
  globalThis.__DB = db; globalThis.__EMAILS = []; offlineFetch();
  const outputs = {}, errors = {};
  const attempt = async (name, fn) => { try { outputs[name] = await fn(); } catch (e) { errors[name] = { name: e && e.name, code: e && (e.code || e.status), message: e && e.message }; outputs[name] = { error: errors[name] }; } };
  try {
    await attempt("daily", async () => sortRecs(plain(await M.DM.getDailyMetrics(tenantId, range.from, range.to, bizId))));
    await attempt("latestDate", async () => await M.DM.getLatestDailyDate(tenantId, bizId));
    await attempt("labor", async () => sortRecs(plain(await M.LR.getLaborMetrics(tenantId, range.from, range.to, bizId))));
    await attempt("purchases", async () => sortRecs(plain(await M.PR.getPurchaseMetrics(tenantId, range.from, range.to, bizId))));
    // undefined paths are reported, not judged: the sandbox is OFFLINE by design, so weather/oref
    // enrichment is absent here exactly as it is absent in the readers matrix (parity is what matters)
    await attempt("dailyBuilder", async () => { const out = {}; for (const d of dates) { const doc = await M.DBLD.buildAnalyticsForBiz(tenantId, bizId, d); out[d] = { doc: stripDoc(doc), undefinedPaths: undefinedPaths(doc) }; } return out; });
    await attempt("snapshot", async () => stripSnap(await M.SB.buildSnapshotForBiz(tenantId, bizId)));
    await attempt("exceptions", async () => plain(await M.EX.listEntryExceptions({ tenantId, bizId, fromDate: range.from, toDate: range.to })));
    await attempt("plannedData", async () => { const plan = { intent: "canary-verify", metrics: ["daily", "labor", "purchases"], dimensions: [], filters: {}, timeRange: { start: range.from, end: range.to }, requiresBaseline: false, requiresComparison: false, requiresAnomalyDetection: false };
      const r = plain(await M.AS.fetchPlannedData(plan, { tenantId, bizId, timezone: "Asia/Jerusalem", locale: "he", nowIso, userQuestion: "canary" })); if (r && r.metrics && r.metrics.daily) r.metrics.daily = sortRecs(r.metrics.daily); if (r && r.metrics && r.metrics.labor) r.metrics.labor = sortRecs(r.metrics.labor); if (r && r.metrics && r.metrics.purchases) r.metrics.purchases = sortRecs(r.metrics.purchases); delete r.fetchedAt; return r; });
  } finally { globalThis.__DB = prevDb; globalThis.__EMAILS = prevEmails; globalThis.fetch = prevFetch; }
  if (db.writes.length) throw new CanaryError("reader_wrote", JSON.stringify(db.writes[0]), EXIT.STOP);
  return { readerSetVersion: CONTRACT_VERSION, outputs, errors, numberStrings: numStrings(outputs), meta: { compiledDir: M.compiledDir, dates, range, nowIso, emails: (globalThis.__EMAILS || []).length } };
}
