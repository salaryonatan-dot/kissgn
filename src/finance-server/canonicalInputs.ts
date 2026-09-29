// Canonical server inputs (Slice B1, MARJIN_FIN_SERVER/1): the ONLY server I/O seam of the
// financial read path and its ONLY clock read. Reads the entries node once through the shared
// dual-mode reader (typed EntriesStorageError on a malformed node), and the business config /
// fixed-cost envelopes only when asked. Envelopes are decoded by the core's strict decoder:
// an undecodable envelope is reported as `unreadable`, never defaulted to {} or []. A failed
// RTDB read propagates (it is never treated as "absent"). No write.
import { readEntriesNode, requireEntriesRows } from "../../lib/analytics/entriesReader.js";
import { israelBusinessDate } from "../finance/businessDate.js";
import { decodeEnvelope } from "../policy/productFinance.js";
import type { EnvelopeState, ProductInputs } from "../policy/productFinance.js";

export const CANONICAL_SERVER_API_VERSION = "MARJIN_FIN_SERVER/1";

/** The two keyed-map fields of an entry row (the client's MarjinStorageV2.MAP_FIELDS). */
export const ENTRY_MAP_FIELDS = Object.freeze(["supplier_payments", "hourly_payroll"]);

/**
 * RTDB numeric-key readback (the approved client contract R2-B3, index.html
 * canonicalMapField): RTDB returns a map whose keys are dense integers ("0", "1", …) as a
 * JavaScript ARRAY. For the two map fields ONLY, an array is the same value as the map
 * {index: element}; a null element is an absent key. Every other field is untouched, the
 * stored row objects are never mutated (a changed row is a shallow copy), and nothing else
 * is interpreted here — amounts are read by the core.
 */
export function mapFieldReadback(rows: readonly unknown[]): unknown[] {
  return rows.map((row) => {
    if (!row || typeof row !== "object" || Array.isArray(row)) return row;
    const r = row as Record<string, unknown>;
    let out: Record<string, unknown> | null = null;
    for (const field of ENTRY_MAP_FIELDS) {
      const v = r[field];
      if (!Array.isArray(v)) continue;
      const map: Record<string, unknown> = {};
      v.forEach((x, i) => { if (x !== null && x !== undefined) map[String(i)] = x; });
      if (out === null) out = { ...r };
      out[field] = map;
    }
    return out === null ? row : out;
  });
}

export type InputState = EnvelopeState<unknown>["state"] | "not_loaded";
export type InputIssue = "config_unreadable" | "fixed_unreadable";

export interface ServerInputs extends ProductInputs {
  readonly tenantId: string;
  readonly bizId: string;
  readonly storageMode: "legacy" | "v2" | "absent";
  readonly configState: InputState;
  readonly fixedState: InputState;
  readonly inputIssues: readonly InputIssue[];
}

interface DbLike {
  ref(path: string): { once(event: "value"): Promise<{ val(): unknown }> };
}

export async function loadCanonicalInputs(
  db: DbLike,
  tenantId: string,
  bizId: string,
  opts: { readonly site: string; readonly nowMs?: number; readonly need: { readonly config: boolean; readonly fixed: boolean } },
): Promise<ServerInputs> {
  const base = `tenants/${tenantId}/biz:${bizId}`;
  const [entriesSnap, configSnap, fixedSnap] = await Promise.all([
    db.ref(`${base}:entries`).once("value"),
    opts.need.config ? db.ref(`${base}:config`).once("value") : Promise.resolve(null),
    opts.need.fixed ? db.ref(`${base}:fixed`).once("value") : Promise.resolve(null),
  ]);
  const raw = entriesSnap.val();
  const rows = mapFieldReadback(requireEntriesRows(raw, { tenantId, bizId, site: opts.site }) as unknown[]);
  const mode = readEntriesNode(raw).mode as ServerInputs["storageMode"];
  const config: EnvelopeState<Record<string, unknown>> = configSnap ? decodeEnvelope(configSnap.val(), "object") : { state: "absent" };
  const fixed: EnvelopeState<unknown[]> = fixedSnap ? decodeEnvelope(fixedSnap.val(), "array") : { state: "absent" };
  const inputIssues: InputIssue[] = [];
  if (config.state === "unreadable") inputIssues.push("config_unreadable");
  if (fixed.state === "unreadable") inputIssues.push("fixed_unreadable");
  const nowMs = opts.nowMs === undefined ? Date.now() : opts.nowMs;
  return {
    tenantId,
    bizId,
    rows,
    storageMode: mode,
    config,
    fixed,
    configState: configSnap ? config.state : "not_loaded",
    fixedState: fixedSnap ? fixed.state : "not_loaded",
    inputIssues,
    asOfBusinessDate: israelBusinessDate(nowMs),
  };
}
