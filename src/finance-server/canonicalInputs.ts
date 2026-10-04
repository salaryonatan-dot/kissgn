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
import { decodeEnvelope, decodeExceptionLedger, exceptionsByDateOf } from "../policy/productFinance.js";
import type { EnvelopeState, ExceptionLedgerState, ProductInputs } from "../policy/productFinance.js";
import { costHistoryCodec } from "../finance/costHistory.js";

export const CANONICAL_SERVER_API_VERSION = "MARJIN_FIN_SERVER/1";

export type InputState = EnvelopeState<unknown>["state"] | "not_loaded";
export type InputIssue = "config_unreadable" | "fixed_unreadable" | "exceptions_unreadable" | "cost_history_unreadable";

export interface ServerInputs extends ProductInputs {
  readonly tenantId: string;
  readonly bizId: string;
  readonly storageMode: "legacy" | "v2" | "absent";
  readonly configState: InputState;
  readonly fixedState: InputState;
  /** Structured exception ledger: not_loaded unless `need.exceptions`. */
  readonly exceptionsState: ExceptionLedgerState["state"] | "not_loaded";
  readonly costHistoryState: "absent" | "present" | "unreadable" | "not_loaded";
  readonly inputIssues: readonly InputIssue[];
}

interface DbLike {
  ref(path: string): { once(event: "value"): Promise<{ val(): unknown }> };
}

export async function loadCanonicalInputs(
  db: DbLike,
  tenantId: string,
  bizId: string,
  opts: { readonly site: string; readonly nowMs?: number; readonly need: { readonly config: boolean; readonly fixed: boolean; readonly exceptions: boolean; readonly costHistory?: boolean } },
): Promise<ServerInputs> {
  const base = `tenants/${tenantId}/biz:${bizId}`;
  const needHistory = opts.need.costHistory === undefined ? opts.need.config || opts.need.fixed : opts.need.costHistory;
  const [entriesSnap, configSnap, fixedSnap, exceptionsSnap, costHistoryRead] = await Promise.all([
    db.ref(`${base}:entries`).once("value"),
    opts.need.config ? db.ref(`${base}:config`).once("value") : Promise.resolve(null),
    opts.need.fixed ? db.ref(`${base}:fixed`).once("value") : Promise.resolve(null),
    opts.need.exceptions || opts.need.config || opts.need.fixed ? db.ref(`tenants/${tenantId}/entry_exceptions/${bizId}`).once("value") : Promise.resolve(null),
    needHistory ? db.ref(`${base}:cost_history`).once("value").then((s) => ({ snap: s })).catch((failed: unknown) => ({ failed })) : Promise.resolve(null),
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
  const costHistory = costHistoryRead ? ("failed" in costHistoryRead
    ? costHistoryCodec.decodeHistory({ failed: costHistoryRead.failed }, { tenantId, bizId })
    : costHistoryCodec.decodeHistory({ exists: costHistoryRead.snap.val() !== null, value: costHistoryRead.snap.val() }, { tenantId, bizId })) : null;   // R4: always BOUND
  if (costHistory?.state === "unreadable") inputIssues.push("cost_history_unreadable");
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
    costHistoryState: costHistory ? costHistory.state : "not_loaded",
    ...(costHistory ? { costHistory } : {}),
    ...(ledger && ledger.state === "present" ? { exceptionStates: ledger.value, exceptionsByDate: exceptionsByDateOf(ledger.value) } : {}),
    exceptionLedgerState: ledger ? ledger.state : "not_loaded",
    inputIssues,
    asOfBusinessDate: israelBusinessDate(nowMs),
  };
}
