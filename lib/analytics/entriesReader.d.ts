// Type declarations for the runtime helper lib/analytics/entriesReader.js — the server-
// side dual-mode entries reader (Storage V2 / legacy `_v`). Placed adjacent to the .js so
// TypeScript callers resolve it under strict mode without allowJs. Signatures match the
// runtime exactly.

export const ENTRIES_STORAGE_V2: 2;
export const ROW_GEN_KEY: "_gen";
export function isValidEntryId(v: unknown): boolean;
export function isGenerationEpoch(v: unknown): boolean;

export type EntryRow = { id?: string; date?: string; [field: string]: unknown };
export type EntriesMode = "absent" | "legacy" | "v2";

export interface EntriesReadOk { ok: true; mode: EntriesMode; rows: EntryRow[]; generation: number | null }
export interface EntriesReadFailure { ok: false; mode: "malformed" | "v2"; status: "malformed_storage" | "malformed_v2"; reason: string; key?: string }
export type EntriesReadResult = EntriesReadOk | EntriesReadFailure;

export interface ReaderContext { tenantId?: string; bizId?: string; site?: string }

export class EntriesStorageError extends Error {
  name: "EntriesStorageError";
  status: "malformed_storage" | "malformed_v2";
  mode: string;
  reason: string;
  key?: string;
  tenantId?: string;
  bizId?: string;
  site?: string;
  constructor(init?: { status?: string; mode?: string; reason?: string; key?: string } & ReaderContext);
}
export class EntriesAmbiguityError extends Error {
  name: "EntriesAmbiguityError";
  status: "duplicate_business_date";
  date: string;
  count: number;
  ids: Array<string | null>;
  tenantId?: string;
  bizId?: string;
  site?: string;
  constructor(init?: { date?: string; count?: number; ids?: Array<string | null> } & ReaderContext);
}
export function isEntriesStorageError(e: unknown): e is EntriesStorageError;
export function isEntriesAmbiguityError(e: unknown): e is EntriesAmbiguityError;
export function isEntriesReadError(e: unknown): e is EntriesStorageError | EntriesAmbiguityError;

export function readEntriesNode(raw: unknown): EntriesReadResult;
export function requireEntriesRows(raw: unknown, ctx?: ReaderContext): EntryRow[];

export type RowForDate =
  | { status: "absent"; row: null }
  | { status: "single"; row: EntryRow }
  | { status: "ambiguous"; row: null; count: number; ids: Array<string | null> };
export function rowForDate(rows: EntryRow[], date: string): RowForDate;
export function requireRowForDate(rows: EntryRow[], date: string, ctx?: ReaderContext): EntryRow | null;
export function rowsInRange(rows: EntryRow[], fromDate: string, toDate: string): EntryRow[];
export function duplicateDates(rows: EntryRow[]): Array<{ date: string; ids: Array<string | null> }>;
