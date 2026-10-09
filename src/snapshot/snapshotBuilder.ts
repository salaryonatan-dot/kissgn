import { getDb } from "../firebase/admin.js";
import { loadCanonicalInputs } from "../finance-server/canonicalInputs.js";
import { canonicalMonthProjection, canonicalMonthReport } from "../finance-server/canonicalMetrics.js";
import type { SnapshotFinancials, SnapshotInsight } from "./snapshotEmail.js";
import { buildSnapshotView, snapshotInsights } from "./snapshotEmail.js";
import { classifyRegistryTarget, decodeRegistryNode, isRegistryBizId, resolveRegistryTarget } from "../../lib/businessRegistry.js";
import { isValidId } from "../../lib/securityContext.js";

// Financial Core B2: the morning snapshot is ONE canonical month report (Actual = completed
// days through D-1) plus the ONE canonical projection (REV_FORECAST/v2 → MARJIN_PROJ/2), both
// from the server API, captured on ONE clock. This file orchestrates only: discovery, the
// business name, the two server-API calls and the legacy field names for
// `api/daily-snapshot/run.ts`. It imports no core module (it is B2's server-API consumer; the
// view model is encoded by the e-mail module, B2's core consumer) and computes no value: every
// legacy `number` below is COPIED from the view's one conversion. A figure the core does not
// state as complete is `null`, never 0.
export interface SnapshotData {
  tenantId: string;
  bizId: string;
  bizName: string;
  date: string; // the Israel business date of the run (the as-of date; never part of Actual)
  month: string; // YYYY-MM of the reported month

  /** VD-45 (owner default, not an owner choice): the 1st of a month has no completed day ⇒ no figures. */
  presentation: SnapshotFinancials["presentation"];

  // P&L Metrics — legacy names; `null` = unavailable (incomplete / invalid / missing), never 0
  totalSales: number | null;
  totalFood: number | null;
  totalPayroll: number | null;
  totalOtherExpense: number | null;
  fixedRegular: number | null;
  // Rent as the core states it: the fixed part and the percentage-of-revenue part (no B2 sum)
  rentFixedAmount: number | null;
  rentPctAmount: number | null;
  royaltyAmount: number | null;
  netProfit: number | null;

  // Percentages (ratio of totals from the core)
  foodCostPct: number | null;
  laborPct: number | null;

  // Time metrics — calendar days (D-1), not entry-row counts and not closure-adjusted
  daysPassed: number;
  presentDays: number;
  daysInMonth: number;
  daysLeft: number;

  // Projection (REV_FORECAST/v2 revenue; MARJIN_PROJ/2 profit) — null ⇒ unavailable;
  // `financials.projection.*.state` says whether a value is complete or partial
  forecast: number | null;
  paceRevenue: number | null;

  // Targets (food/labor from config.targets.* or labelled compat defaults; sales = legacy key or 700,000)
  targetSales: number;
  targetFoodCost: number;
  targetLabor: number;

  // Insights (retained rules; suppressed when their input is not complete — VD-44)
  insights: SnapshotInsight[];

  /** The exact, typed view model the e-mail renders (strings, states, coverage, closures, provenance). */
  financials: SnapshotFinancials;
}

interface Business {
  id: string;
  name: string;
}

export interface SnapshotBusinessIdentity {
  readonly tenantId: string;
  readonly bizId: string;
  readonly businessDate: string;
}

export interface SnapshotBuildFailure extends SnapshotBusinessIdentity {
  readonly code: "snapshot_build_failed" | "business_name_unavailable" | "ambiguous_business_identity" |
    "invalid_business_identity" | "business_not_registered" | "registry_unreadable" | "registry_unavailable";
}

type SnapshotRefusalCode = Exclude<SnapshotBuildFailure["code"], "snapshot_build_failed">;
class SnapshotIdentityRefusal extends Error {
  constructor(readonly code: SnapshotRefusalCode) { super(code); }
}

export interface SnapshotExclusion extends SnapshotBusinessIdentity {
  readonly reason: "explicit_inactive" | "index_only" | "legacy_self";
}

export interface SnapshotDiscoveryFailure {
  readonly source: "proactive_biz_index" | "app_business";
  readonly code: "read_failed" | "malformed_source" | "malformed_entry";
}

/** One run's accounting. Every expected business has exactly one snapshot or failure. */
export interface SnapshotBuildRun {
  readonly version: "MARJIN_SNAPSHOT_BUILD_RUN/1";
  readonly businessDate: string;
  readonly status: "complete" | "incomplete";
  readonly discovery: { readonly status: "complete" | "failed"; readonly failures: readonly SnapshotDiscoveryFailure[] };
  readonly expectedBusinesses: readonly SnapshotBusinessIdentity[];
  readonly snapshots: readonly SnapshotData[];
  readonly failedBuilds: readonly SnapshotBuildFailure[];
  readonly exclusions: readonly SnapshotExclusion[];
}

function registryRows(value: unknown): readonly unknown[] | null {
  if (value === null || value === undefined) return null;
  const decoded = decodeRegistryNode(value);
  if (!decoded.ok) throw new Error("registry_unreadable");
  return decoded.list;
}

// Compose the approved M1 R5 identity predicates with the RTDB key restriction in
// D-CTRL. This only rules out control characters; it does not trim or reinterpret ids.
const RTDB_CONTROL_CHARS = /[\u0000-\u001f\u007f]/;
const isAddressableTenant = (id: unknown): id is string => typeof id === "string" && isValidId(id) && !RTDB_CONTROL_CHARS.test(id);
const isAddressableBusiness = (id: unknown): id is string => typeof id === "string" && isRegistryBizId(id) && !RTDB_CONTROL_CHARS.test(id);
const usableName = (name: unknown): name is string => typeof name === "string" && name.trim() !== "";

export async function buildSnapshotForBiz(
  tenantId: string,
  bizId: string,
  opts?: { readonly nowMs?: number }
): Promise<SnapshotData> {
  if (!isAddressableTenant(tenantId) || !isAddressableBusiness(bizId)) throw new SnapshotIdentityRefusal("invalid_business_identity");
  const db = getDb();
  // ONE clock read for the whole snapshot: the same instant fixes the business date of the
  // loader (Actual = D-1) and the projection's engine run.
  const nowMs = opts?.nowMs ?? Date.now();

  // Resolve the exact registered identity before constructing a business-scoped
  // financial path. A malformed twin is a refusal, never a name or authority.
  let businessSnap;
  try { businessSnap = await db.ref(`tenants/${tenantId}/app/business`).once("value"); }
  catch { throw new SnapshotIdentityRefusal("registry_unavailable"); }
  const selected = resolveRegistryTarget(businessSnap.val(), bizId);
  if (selected.state === "ambiguous") throw new SnapshotIdentityRefusal("ambiguous_business_identity");
  if (selected.state === "not_registered") throw new SnapshotIdentityRefusal("business_not_registered");
  if (selected.state === "unreadable") throw new SnapshotIdentityRefusal("registry_unreadable");
  if (selected.state !== "registered" || !selected.record) throw new SnapshotIdentityRefusal("ambiguous_business_identity");
  const business = selected.record;
  if (!usableName(business.name)) throw new SnapshotIdentityRefusal("business_name_unavailable");
  const bizName = business.name;
  const inputs = await loadCanonicalInputs(db, tenantId, bizId, {
    site: "snapshotBuilder", nowMs, need: { config: true, fixed: true, exceptions: true },
  });

  const month = inputs.asOfBusinessDate.slice(0, 7);
  const { report, provenance } = canonicalMonthReport(inputs, { kind: "open_month", month });
  const projection = report.window.state === "actual" ? canonicalMonthProjection(inputs, report, { nowMs }) : null;
  const financials = buildSnapshotView({
    report,
    projection,
    provenance,
    config: inputs.config.state === "present" ? inputs.config.value : null,
  });
  const f = financials;
  // A legacy `number` field carries a COMPLETE value only: it has no room for the "partial" label,
  // so a partial or unavailable value is `null` there and is shown, labelled, from `financials`.
  const complete = (a: { readonly state: string; readonly number: number | null }): number | null => (a.state === "complete" ? a.number : null);

  return {
    tenantId,
    bizId,
    bizName,
    date: inputs.asOfBusinessDate,
    month: f.month,
    presentation: f.presentation,
    totalSales: complete(f.amounts.revenue),
    totalFood: complete(f.amounts.purchases),
    totalPayroll: complete(f.amounts.laborEmployerCost),
    totalOtherExpense: complete(f.amounts.otherExpense),
    fixedRegular: complete(f.amounts.fixedRegular),
    rentFixedAmount: complete(f.amounts.rentFixed),
    rentPctAmount: complete(f.amounts.rentPct),
    royaltyAmount: complete(f.amounts.royalty),
    netProfit: complete(f.amounts.operatingProfit),
    foodCostPct: f.ratios.purchasesPct.number,
    laborPct: f.ratios.laborPct.number,
    daysPassed: f.window.recognizedDays,
    presentDays: f.window.presentDays,
    daysInMonth: f.window.daysInMonth,
    daysLeft: f.window.daysLeft,
    forecast: complete(f.projection.operatingProfit),
    paceRevenue: complete(f.projection.revenue),
    targetSales: f.goals.sales.number,
    targetFoodCost: f.goals.foodCostPct.number,
    targetLabor: f.goals.laborPct.number,
    insights: snapshotInsights(f),
    financials,
  };
}

/** Legacy array adapter for the existing delivery route; combined acceptance requires the structured result. */
export async function buildSnapshotForAll(): Promise<SnapshotData[]> {
  return [...(await buildSnapshotRun()).snapshots];
}

/** Israel date of an injected instant, using the same timezone and Intl parts as canonical inputs. */
function runBusinessDate(nowMs: number): string {
  if (!Number.isFinite(nowMs)) throw new Error("invalid_run_instant");
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(nowMs);
  const part = (type: string) => parts.find((x) => x.type === type)?.value;
  const year = part("year"), month = part("month"), day = part("day");
  if (!year || !month || !day) throw new Error("run_date_unavailable");
  return `${year}-${month}-${day}`;
}

/** Structured builder-to-delivery handoff. The legacy array adapter above runs this same entrypoint. */
export async function buildSnapshotRun(opts?: { readonly nowMs?: number }): Promise<SnapshotBuildRun> {
  const db = getDb();
  const nowMs = opts?.nowMs ?? Date.now();
  const businessDate = runBusinessDate(nowMs);
  const snapshots: SnapshotData[] = [];
  const failedBuilds: SnapshotBuildFailure[] = [];
  const discoveryFailures: SnapshotDiscoveryFailure[] = [];
  const exclusions: SnapshotExclusion[] = [];
  const identity = (tenantId: string, bizId: string): SnapshotBusinessIdentity => ({ tenantId, bizId, businessDate });
  const discoveryFailed = (source: SnapshotDiscoveryFailure["source"], code: SnapshotDiscoveryFailure["code"]) => {
    discoveryFailures.push({ source, code });
  };

  // ── Hardened business discovery ────────────────────────────────────────────
  // Same pattern as the production-verified dailyBuilder discovery:
  // merges BOTH sources on every run — proactive_biz_index AND
  // tenants/*/app/business — then de-dupes by (tenantId, bizId).
  // Previous behavior consulted app/business only when the index yielded zero
  // entries, so a single stale/partial index entry silently excluded every
  // business missing from it. Inclusion is default-on: a business is skipped
  // ONLY when an explicit inactive/disabled/deleted/archived flag is present.
  // Missing optional fields never exclude a business.

  type DiscoveredBusiness = {
    tenantId: string;
    bizId: string;
    fromIndex: boolean;
    fromAppBusiness: boolean;
  };

  const discovered = new Map<string, DiscoveredBusiness>();
  const addBiz = (source: "index" | "appBusiness", tenantId: unknown, bizId: unknown): boolean => {
    if (typeof tenantId !== "string" || typeof bizId !== "string") return false;
    const t = tenantId;
    const b = bizId;
    if (!isAddressableTenant(t) || !isAddressableBusiness(b)) return false;
    if (t === b) {
      legacySelfSkipped++;
      exclusions.push({ ...identity(t, b), reason: "legacy_self" });
      return false;
    }

    const key = JSON.stringify([t, b]);
    const existing = discovered.get(key);
    if (existing) {
      if (source === "index") existing.fromIndex = true;
      else existing.fromAppBusiness = true;
      return true;
    }

    discovered.set(key, {
      tenantId: t,
      bizId: b,
      fromIndex: source === "index",
      fromAppBusiness: source === "appBusiness",
    });
    return true;
  };

  // True only when an EXPLICIT negative flag exists. `active === undefined`
  // (missing field) must NOT exclude a business. Also honors a string
  // `status` field ("inactive" | "disabled" | "deleted" | "archived"),
  // compared lowercase/trimmed.
  const INACTIVE_STATUSES = new Set(["inactive", "disabled", "deleted", "archived"]);
  const isExplicitlyInactive = (v: Record<string, unknown>): boolean =>
    v.active === false ||
    v.inactive === true ||
    v.disabled === true ||
    v.deleted === true ||
    v.archived === true ||
    (typeof v.status === "string" && INACTIVE_STATUSES.has(v.status.trim().toLowerCase()));

  // Lightweight discovery telemetry — sanitized counts only, no payloads.
  let fromIndex = 0;
  let fromAppBusiness = 0;
  let malformedSkipped = 0;
  let inactiveSkipped = 0;
  let legacySelfSkipped = 0;
  let indexOnlySkipped = 0;

  // Source 1: proactive_biz_index (optional — absence is not an error).
  try {
    const indexSnap = await db.ref("proactive_biz_index").once("value");
    const indexData = indexSnap.val();

    if (indexData !== null && indexData !== undefined && (typeof indexData !== "object" || Array.isArray(indexData))) {
      discoveryFailed("proactive_biz_index", "malformed_source");
    } else if (indexData && typeof indexData === "object") {
      for (const [key, rawValue] of Object.entries(indexData)) {
        // Primitive legacy entries: `"tenantId:bizId": true | false`.
        // `false` is an EXPLICIT inactive marker — skip it. Only `true` is
        // accepted as legacy-active (ids come from the colon key below);
        // any other primitive is malformed.
        if (rawValue === false) {
          const parts = key.split(":");
          if (parts.length === 2 && isAddressableTenant(parts[0]) && isAddressableBusiness(parts[1])) {
            inactiveSkipped++;
            exclusions.push({ ...identity(parts[0], parts[1]), reason: "explicit_inactive" });
          } else {
            malformedSkipped++;
            discoveryFailed("proactive_biz_index", "malformed_entry");
          }
          continue;
        }
        const value =
          rawValue && typeof rawValue === "object"
            ? (rawValue as Record<string, unknown>)
            : null;
        if (value === null && rawValue !== true) {
          malformedSkipped++;
          discoveryFailed("proactive_biz_index", "malformed_entry");
          continue;
        }

        // Prefer explicit ids stored in the value.
        let tenantId = value && typeof value.tenantId === "string" ? value.tenantId : "";
        let bizId = value && typeof value.bizId === "string" ? value.bizId : "";

        // Legacy colon keys "tenantId:bizId" — exact 2-part keys only.
        // No underscore/sanitized-key reverse engineering: the ids themselves
        // contain underscores, so splitting on "_" would be ambiguous.
        if (!tenantId || !bizId) {
          const parts = key.split(":");
          if (parts.length === 2 && parts[0] && parts[1]) {
            tenantId = parts[0];
            bizId = parts[1];
          }
        }

        if (!isAddressableTenant(tenantId) || !isAddressableBusiness(bizId)) {
          malformedSkipped++;
          discoveryFailed("proactive_biz_index", "malformed_entry");
          continue;
        }

        if (value && isExplicitlyInactive(value)) {
          inactiveSkipped++;
          exclusions.push({ ...identity(tenantId, bizId), reason: "explicit_inactive" });
          continue;
        }

        if (addBiz("index", tenantId, bizId)) fromIndex++;
      }
    }
  } catch (error) {
    discoveryFailed("proactive_biz_index", "read_failed");
    console.error("[snapshot/discovery] proactive_biz_index read_failed");
  }

  // Source 2: ALWAYS scan tenants/*/app/business (merged, not fallback-only).
  try {
    const tenantsSnap = await db.ref("tenants").once("value");
    const tenantsData = tenantsSnap.val();

    if (tenantsData !== null && tenantsData !== undefined && (typeof tenantsData !== "object" || Array.isArray(tenantsData))) {
      discoveryFailed("app_business", "malformed_source");
    } else if (tenantsData && typeof tenantsData === "object") {
      for (const [tenantId, tenantData] of Object.entries(tenantsData)) {
        if (!isAddressableTenant(tenantId)) {
          discoveryFailed("app_business", "malformed_entry");
          continue;
        }
        if (!tenantData || typeof tenantData !== "object" || Array.isArray(tenantData)) {
          discoveryFailed("app_business", "malformed_source");
          continue;
        }
        const app = (tenantData as Record<string, unknown>).app;
        if (app !== null && app !== undefined && (typeof app !== "object" || Array.isArray(app))) {
          discoveryFailed("app_business", "malformed_source");
          continue;
        }
        if (app && Object.hasOwn(app, "business")) {
          const raw = (app as Record<string, unknown>).business;
          if (raw === null || raw === undefined) continue;
          let businesses: readonly unknown[] | null;
          try {
            businesses = registryRows(raw);
          } catch {
            discoveryFailed("app_business", "malformed_source");
            continue;
          }
          if (!businesses) continue;
          let nonNull = 0;
          for (const biz of businesses) {
            if (biz === null) continue;
            nonNull++;
            if (!biz || typeof biz !== "object" || Array.isArray(biz) || !isAddressableBusiness((biz as Business).id)) {
              malformedSkipped++;
              discoveryFailed("app_business", "malformed_entry");
              continue;
            }
            const record = biz as Business & Record<string, unknown>;
            // The shared selector decides ambiguity before inactivity: a duplicate
            // identity cannot disappear merely because one record is inactive.
            if (classifyRegistryTarget(raw, record.id).state === "ambiguous") {
              if (addBiz("appBusiness", tenantId, record.id)) fromAppBusiness++;
              continue;
            }
            if (isExplicitlyInactive(record)) {
              inactiveSkipped++;
              exclusions.push({ ...identity(tenantId, record.id), reason: "explicit_inactive" });
              continue;
            }
            if (addBiz("appBusiness", tenantId, record.id)) fromAppBusiness++;
          }
          if (businesses.length > 0 && nonNull === 0) discoveryFailed("app_business", "malformed_source");
        }
      }
    }
  } catch (error) {
    discoveryFailed("app_business", "read_failed");
    console.error("[snapshot/discovery] app_business read_failed");
  }

  const afterDedupe = discovered.size;
  const activeBusinesses: Array<{ tenantId: string; bizId: string }> =
    Array.from(discovered.values()).filter((candidate) => {
      if (candidate.fromAppBusiness) return true;
      indexOnlySkipped++;
      if (!discoveryFailures.some((f) => f.source === "app_business")) exclusions.push({ ...identity(candidate.tenantId, candidate.bizId), reason: "index_only" });
      return false;
    });
  console.log(
    `[snapshot/discovery] summary fromIndex=${fromIndex} fromAppBusiness=${fromAppBusiness} ` +
      `afterDedupe=${afterDedupe} eligibleAfterValidation=${activeBusinesses.length} ` +
      `malformedSkipped=${malformedSkipped} inactiveSkipped=${inactiveSkipped} ` +
      `legacySelfSkipped=${legacySelfSkipped} indexOnlySkipped=${indexOnlySkipped}`
  );

  // Build snapshots for each active business
  const expectedBusinesses = activeBusinesses.map(({ tenantId, bizId }) => identity(tenantId, bizId));
  for (const { tenantId, bizId } of activeBusinesses) {
    try {
      const snapshot = await buildSnapshotForBiz(tenantId, bizId, { nowMs });
      snapshots.push(snapshot);
    } catch (error) {
      const code = error instanceof SnapshotIdentityRefusal ? error.code : "snapshot_build_failed";
      failedBuilds.push({ ...identity(tenantId, bizId), code });
    }
  }

  const keyOf = (x: SnapshotBusinessIdentity) => JSON.stringify([x.tenantId, x.bizId, x.businessDate]);
  const expectedKeys = new Set(expectedBusinesses.map(keyOf));
  const accounted = [...snapshots.map((x) => ({ tenantId: x.tenantId, bizId: x.bizId, businessDate: x.date })), ...failedBuilds];
  if (expectedKeys.size !== expectedBusinesses.length || accounted.length !== expectedKeys.size ||
      new Set(accounted.map(keyOf)).size !== accounted.length || accounted.some((x) => !expectedKeys.has(keyOf(x)))) {
    throw new Error("snapshot_accounting_invariant");
  }
  const status = discoveryFailures.length || failedBuilds.length ? "incomplete" : "complete";
  return {
    version: "MARJIN_SNAPSHOT_BUILD_RUN/1", businessDate, status,
    discovery: { status: discoveryFailures.length ? "failed" : "complete", failures: discoveryFailures },
    expectedBusinesses, snapshots, failedBuilds,
    exclusions: Array.from(new Map(exclusions
      .filter((x) => !expectedBusinesses.some((y) => x.tenantId === y.tenantId && x.bizId === y.bizId))
      .map((x) => [keyOf(x), x])).values()),
  };
}
