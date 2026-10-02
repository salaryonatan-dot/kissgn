// Canonical server inputs (Slice B1, MARJIN_FIN_SERVER/1): the ONLY server I/O seam of the
// financial read path and its ONLY clock read. Reads the entries node once through the shared
// dual-mode reader (typed EntriesStorageError on a malformed node), and the business config /
// fixed-cost envelopes only when asked, and the structured exception ledger when asked OR when
// monthly costs are needed (config / fixed): since MARJIN_LABOR/3 the placement of monthly
// costs depends on the declared closures, so a cost-reading caller always gets the one decoded
// ledger (closed-days amendment, TD-CDM1-2; the four B1 reader call sites are unchanged). Everything is
// decoded by the core's shared decoders (decodeEnvelope / decodeExceptionLedger): an
// undecodable input is reported as `unreadable`, never defaulted to {} / [] / "no exceptions".
// Entry rows are passed UNMODIFIED — the shared product composition applies the storage
// decoding, so server and browser give one meaning to one raw input. A failed RTDB read
// propagates (it is never treated as "absent"). No write.
import { readEntriesNode, requireEntriesRows } from "../../lib/analytics/entriesReader.js";
import { israelBusinessDate } from "../finance/businessDate.js";
import { decodeEnvelope, decodeExceptionLedger, decodeSupplierCredits, exceptionsByDateOf } from "../policy/productFinance.js";
import type { EnvelopeState, ExceptionLedgerState, ProductInputs, SupplierCreditsState } from "../policy/productFinance.js";

export const CANONICAL_SERVER_API_VERSION = "MARJIN_FIN_SERVER/1";

export type InputState = EnvelopeState<unknown>["state"] | "not_loaded";
export type InputIssue = "config_unreadable" | "fixed_unreadable" | "exceptions_unreadable" | "supplier_credits_unreadable" | "supplier_credits_invalid";

export interface ServerInputs extends ProductInputs {
  readonly tenantId: string;
  readonly bizId: string;
  readonly storageMode: "legacy" | "v2" | "absent";
  readonly configState: InputState;
  readonly fixedState: InputState;
  /** Structured exception ledger: not_loaded unless `need.exceptions`. */
  readonly exceptionsState: ExceptionLedgerState["state"] | "not_loaded";
  readonly inputIssues: readonly InputIssue[];
  /** P1 (MARJIN_CREDITS/1): state of the supplier-credit node, ALWAYS read (purchases are net of credits). */
  readonly supplierCreditsState: SupplierCreditsState["state"];
}

interface DbLike {
  ref(path: string): { once(event: "value"): Promise<{ val(): unknown }> };
}

export async function loadCanonicalInputs(
  db: DbLike,
  tenantId: string,
  bizId: string,
  opts: { readonly site: string; readonly nowMs?: number; readonly need: { readonly config: boolean; readonly fixed: boolean; readonly exceptions: boolean } },
): Promise<ServerInputs> {
  const base = `tenants/${tenantId}/biz:${bizId}`;
  // P1: the supplier-credit node is read on EVERY call — every financial output is net of credits,
  // so no caller can obtain gross purchases presented as net by forgetting to ask for credits.
  const [entriesSnap, configSnap, fixedSnap, exceptionsSnap, creditsSnap] = await Promise.all([
    db.ref(`${base}:entries`).once("value"),
    opts.need.config ? db.ref(`${base}:config`).once("value") : Promise.resolve(null),
    opts.need.fixed ? db.ref(`${base}:fixed`).once("value") : Promise.resolve(null),
    opts.need.exceptions || opts.need.config || opts.need.fixed ? db.ref(`tenants/${tenantId}/entry_exceptions/${bizId}`).once("value") : Promise.resolve(null),
    db.ref(`${base}:supplier_credits`).once("value"),
  ]);
  const raw = entriesSnap.val();
  const rows = requireEntriesRows(raw, { tenantId, bizId, site: opts.site }) as unknown[];
  const mode = readEntriesNode(raw).mode as ServerInputs["storageMode"];
  const config: EnvelopeState<Record<string, unknown>> = configSnap ? decodeEnvelope(configSnap.val(), "object") : { state: "absent" };
  const fixed: EnvelopeState<unknown[]> = fixedSnap ? decodeEnvelope(fixedSnap.val(), "array") : { state: "absent" };
  const inputIssues: InputIssue[] = [];
  if (config.state === "unreadable") inputIssues.push("config_unreadable");
  if (fixed.state === "unreadable") inputIssues.push("fixed_unreadable");
  const ledger: ExceptionLedgerState | null = exceptionsSnap ? decodeExceptionLedger(exceptionsSnap.val()) : null;
  if (ledger && ledger.state === "unreadable") inputIssues.push("exceptions_unreadable");
  const supplierCredits: SupplierCreditsState = decodeSupplierCredits(creditsSnap.val());
  if (supplierCredits.state === "unreadable") inputIssues.push("supplier_credits_unreadable");
  if (supplierCredits.state === "present" && supplierCredits.issues.length >= 1) inputIssues.push("supplier_credits_invalid");
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
    exceptionsState: ledger ? ledger.state : "not_loaded",
    ...(ledger && ledger.state === "present" ? { exceptionStates: ledger.value, exceptionsByDate: exceptionsByDateOf(ledger.value) } : {}),
    exceptionLedgerState: ledger ? ledger.state : "not_loaded",
    inputIssues,
    supplierCredits,
    supplierCreditsState: supplierCredits.state,
    asOfBusinessDate: israelBusinessDate(nowMs),
  };
}
