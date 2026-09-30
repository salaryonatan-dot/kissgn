import { getDb } from "../firebase/admin.js";
import { loadCanonicalInputs } from "../finance-server/canonicalInputs.js";
import { canonicalMonthProjection, canonicalMonthReport } from "../finance-server/canonicalMetrics.js";
import type { SnapshotFinancials, SnapshotInsight } from "./snapshotEmail.js";
import { buildSnapshotView, snapshotInsights } from "./snapshotEmail.js";

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

function parseFirebaseData<T>(value: any): T {
  if (!value) return [] as T;
  if (typeof value === "string") {
    try {
      return JSON.parse(value);
    } catch {
      return [] as T;
    }
  }
  if (value._v) {
    try {
      return JSON.parse(value._v);
    } catch {
      return [] as T;
    }
  }
  return value as T;
}

function isUnknownBusinessName(value?: string | null): boolean {
  const name = value?.trim();
  return !name || name === "Unknown";
}

export async function buildSnapshotForBiz(
  tenantId: string,
  bizId: string,
  opts?: { readonly nowMs?: number }
): Promise<SnapshotData> {
  const db = getDb();
  // ONE clock read for the whole snapshot: the same instant fixes the business date of the
  // loader (Actual = D-1) and the projection's engine run.
  const nowMs = opts?.nowMs ?? Date.now();

  const [inputs, businessSnap] = await Promise.all([
    loadCanonicalInputs(db, tenantId, bizId, { site: "snapshotBuilder", nowMs, need: { config: true, fixed: true, exceptions: true } }),
    db.ref(`tenants/${tenantId}/app/business`).once("value"),
  ]);

  // Business name (not financial)
  const businesses = parseFirebaseData<Business[]>(businessSnap.val());
  const business = Array.isArray(businesses) ? businesses.find((b) => b.id === bizId) : undefined;
  const bizName = business?.name || "Unknown";

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

export async function buildSnapshotForAll(): Promise<SnapshotData[]> {
  const db = getDb();
  const snapshots: SnapshotData[] = [];

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
    const t = tenantId.trim();
    const b = bizId.trim();
    if (!t || !b) return false;
    if (t === b) {
      legacySelfSkipped++;
      console.warn(`[snapshot/discovery] skipping legacy self business ${t}:${b}`);
      return false;
    }

    const key = `${t}|${b}`;
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

    if (indexData && typeof indexData === "object") {
      for (const [key, rawValue] of Object.entries(indexData)) {
        // Primitive legacy entries: `"tenantId:bizId": true | false`.
        // `false` is an EXPLICIT inactive marker — skip it. Only `true` is
        // accepted as legacy-active (ids come from the colon key below);
        // any other primitive is malformed.
        if (rawValue === false) {
          inactiveSkipped++;
          console.log(
            `[snapshot/discovery] skipping explicitly inactive index entry key="${key}" (false)`
          );
          continue;
        }
        const value =
          rawValue && typeof rawValue === "object"
            ? (rawValue as Record<string, unknown>)
            : null;
        if (value === null && rawValue !== true) {
          malformedSkipped++;
          console.warn(
            `[snapshot/discovery] ignoring malformed proactive_biz_index entry key="${key}"`
          );
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

        if (!tenantId || !bizId) {
          // Sanitized: key + ids only, never the value payload.
          malformedSkipped++;
          console.warn(
            `[snapshot/discovery] ignoring malformed proactive_biz_index entry key="${key}"`
          );
          continue;
        }

        if (value && isExplicitlyInactive(value)) {
          inactiveSkipped++;
          console.log(
            `[snapshot/discovery] skipping explicitly inactive index entry ${tenantId}:${bizId}`
          );
          continue;
        }

        if (addBiz("index", tenantId, bizId)) fromIndex++;
      }
    }
  } catch (error) {
    console.error("Error reading proactive_biz_index:", error);
  }

  // Source 2: ALWAYS scan tenants/*/app/business (merged, not fallback-only).
  try {
    const tenantsSnap = await db.ref("tenants").once("value");
    const tenantsData = tenantsSnap.val();

    if (tenantsData && typeof tenantsData === "object") {
      for (const [tenantId, tenantData] of Object.entries(tenantsData)) {
        if (
          typeof tenantData === "object" &&
          tenantData !== null &&
          (tenantData as any).app?.business
        ) {
          const businesses = parseFirebaseData<
            Array<Business & Record<string, unknown>>
          >((tenantData as any).app.business);
          if (!Array.isArray(businesses)) continue;
          for (const biz of businesses) {
            if (!biz || typeof biz !== "object" || typeof biz.id !== "string" || !biz.id) {
              malformedSkipped++;
              console.warn(
                `[snapshot/discovery] ignoring malformed app/business entry under tenant ${tenantId}`
              );
              continue;
            }
            if (isExplicitlyInactive(biz as Record<string, unknown>)) {
              inactiveSkipped++;
              console.log(
                `[snapshot/discovery] skipping explicitly inactive business ${tenantId}:${biz.id}`
              );
              continue;
            }
            if (addBiz("appBusiness", tenantId, biz.id)) fromAppBusiness++;
          }
        }
      }
    }
  } catch (error) {
    console.error("Error discovering businesses from tenants:", error);
    // Proceed with index results if we have any; abort only if BOTH sources
    // produced nothing (previous behavior for a total discovery failure).
    if (discovered.size === 0) return snapshots;
  }

  const afterDedupe = discovered.size;
  const activeBusinesses: Array<{ tenantId: string; bizId: string }> =
    Array.from(discovered.values()).filter((candidate) => {
      if (candidate.fromAppBusiness) return true;
      indexOnlySkipped++;
      console.warn(
        `[snapshot/discovery] skipping index-only business ${candidate.tenantId}:${candidate.bizId}`
      );
      return false;
    });
  console.log(
    `[snapshot/discovery] summary fromIndex=${fromIndex} fromAppBusiness=${fromAppBusiness} ` +
      `afterDedupe=${afterDedupe} eligibleAfterValidation=${activeBusinesses.length} ` +
      `malformedSkipped=${malformedSkipped} inactiveSkipped=${inactiveSkipped} ` +
      `legacySelfSkipped=${legacySelfSkipped} indexOnlySkipped=${indexOnlySkipped}`
  );

  // Build snapshots for each active business
  for (const { tenantId, bizId } of activeBusinesses) {
    try {
      const snapshot = await buildSnapshotForBiz(tenantId, bizId);
      if (isUnknownBusinessName(snapshot.bizName)) {
        console.warn("[snapshot/discovery] skipping snapshot with unknown business name", {
          tenantId,
          bizId,
          reason: "unknown_business_name",
        });
        continue;
      }
      snapshots.push(snapshot);
    } catch (error) {
      console.error(`Error building snapshot for ${tenantId}:${bizId}:`, error);
    }
  }

  return snapshots;
}
