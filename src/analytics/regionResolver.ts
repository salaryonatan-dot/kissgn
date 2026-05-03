/**
 * Region resolver.
 *
 * Given a business's selected regions / sub-regions, plus optional
 * lat/lon for auto-suggest, returns:
 *   - The flat list of Oref area substrings to filter alerts by.
 *   - The closest sub-region to a given coordinate (for the map UI).
 *
 * Pure functions, no side effects, safe to import in both the cron
 * builder and the browser UI (when index.html consumes the same data).
 */

import {
  REGIONS,
  ALL_SUBREGIONS,
  ALL_OREF_AREAS,
  getRegion,
  getSubRegion,
  type SubRegion,
} from "./regions.js";

export interface RegionSelection {
  /**
   * IDs of fully-selected regions. Whenever a region appears here, the
   * union of all its sub-regions' Oref areas is included.
   */
  region_ids?: string[];

  /**
   * IDs of individually-selected sub-regions. These are added on top of
   * any full regions; a sub-region whose parent region is already in
   * `region_ids` is fine — set deduplication handles it.
   */
  subregion_ids?: string[];

  /**
   * Free-text Oref area names the user added manually. Useful for
   * exotic cases the predefined taxonomy doesn't cover (a single
   * outlying yishuv, a newly-named area, etc.). Same substring-match
   * semantics as the predefined ones.
   */
  custom_areas?: string[];
}

/**
 * Resolve a selection into the flat list of Oref-area substrings to
 * pass to the alerts-filter step. De-duplicates and sorts for stability.
 */
export function resolveOrefAreas(selection: RegionSelection): string[] {
  const out = new Set<string>();

  for (const rid of selection.region_ids ?? []) {
    const region = getRegion(rid);
    if (!region) continue;
    for (const sub of region.sub) {
      for (const a of sub.oref_areas) out.add(a);
    }
  }

  for (const sid of selection.subregion_ids ?? []) {
    const sub = getSubRegion(sid);
    if (!sub) continue;
    for (const a of sub.oref_areas) out.add(a);
  }

  for (const a of selection.custom_areas ?? []) {
    const trimmed = a.trim();
    if (trimmed) out.add(trimmed);
  }

  return Array.from(out).sort();
}

/**
 * Haversine great-circle distance in kilometers.
 * Sphere model is good enough at the country scale we operate on.
 */
export function haversineKm(
  a: { lat: number; lon: number },
  b: { lat: number; lon: number }
): number {
  const R = 6371; // km
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLon = toRad(b.lon - a.lon);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Find sub-regions ranked by proximity to a point. The map picker uses
 * this for "auto-suggest the user's region from where they tapped".
 *
 * @param point   user's chosen lat/lon
 * @param maxKm   only return sub-regions within this many km (default 25 —
 *                roughly the radius at which alerts are still operationally
 *                relevant for a restaurant; bigger means too noisy)
 * @param limit   cap output length so the UI doesn't show 50 candidates
 */
export function findNearestSubRegions(
  point: { lat: number; lon: number },
  maxKm: number = 25,
  limit: number = 5
): Array<SubRegion & { regionId: string; regionName: string; distanceKm: number }> {
  return ALL_SUBREGIONS
    .map((s) => ({ ...s, distanceKm: haversineKm(point, s.center) }))
    .filter((s) => s.distanceKm <= maxKm)
    .sort((a, b) => a.distanceKm - b.distanceKm)
    .slice(0, limit);
}

/**
 * Convenience: given a point, return the single closest sub-region (or
 * null if everything in our taxonomy is more than `maxKm` away —
 * shouldn't happen inside Israel proper but worth handling).
 */
export function findNearestSubRegion(
  point: { lat: number; lon: number },
  maxKm: number = 50
): (SubRegion & { regionId: string; regionName: string; distanceKm: number }) | null {
  const all = findNearestSubRegions(point, maxKm, 1);
  return all[0] ?? null;
}

/**
 * "Show me everything inside Israel" escape hatch — used when a business
 * deliberately wants to track all alerts for analytics breadth, regardless
 * of geographic relevance. Not a normal default.
 */
export function getAllOrefAreas(): string[] {
  return ALL_OREF_AREAS.slice();
}

/**
 * Inverse lookup: given an Oref alert's `data` field, which sub-regions
 * does it belong to? Useful for diagnostics ("which restaurants would
 * have been notified about this specific alert?").
 */
export function findSubRegionsForAlertData(alertData: string): string[] {
  const matches: string[] = [];
  for (const sub of ALL_SUBREGIONS) {
    if (sub.oref_areas.some((a) => alertData.includes(a))) {
      matches.push(sub.id);
    }
  }
  return matches;
}
