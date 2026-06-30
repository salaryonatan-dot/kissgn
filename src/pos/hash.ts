/**
 * POS Ingestion Foundation — hashing & idempotency (Phase 1, INERT).
 *
 * Pure helpers. No network, no DB, no secrets. Uses only node:crypto.
 *  - canonicalStringify: deterministic JSON (sorted keys) so equal content
 *    always serializes identically.
 *  - contentHashFor: sha256 over the content, with VOLATILE fields excluded
 *    (importId, importedAt, durationMs) so the hash reflects data, not the run.
 *  - idempotencyKey: stable key for a (tenant, biz, date, source, reportType).
 */

import { createHash, randomUUID } from "node:crypto";
import type { ReportType, SourceSystem } from "./types.js";

/** Fields that must never affect the content hash. */
const VOLATILE_FIELDS = new Set(["importId", "importedAt", "durationMs"]);

/**
 * Deterministic JSON serialization: object keys sorted recursively, arrays
 * kept in order. Volatile fields are dropped. undefined is dropped; null kept.
 */
export function canonicalStringify(value: unknown): string {
  return JSON.stringify(canonicalize(value));
}

function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map((v) => canonicalize(v));
  }
  if (value && typeof value === "object" && Object.getPrototypeOf(value) === Object.prototype) {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      if (VOLATILE_FIELDS.has(key)) continue;
      const v = (value as Record<string, unknown>)[key];
      if (v === undefined) continue;
      out[key] = canonicalize(v);
    }
    return out;
  }
  return value;
}

/** sha256 hex of an arbitrary string. */
export function sha256Hex(input: string): string {
  return createHash("sha256").update(input, "utf8").digest("hex");
}

/**
 * Stable content hash. Pass the content object (or a full report — volatile
 * fields are stripped either way). Same data → same hash; changed data → new hash.
 */
export function contentHashFor(content: unknown): string {
  return sha256Hex(canonicalStringify(content));
}

/** Idempotency key for a normalized report / import. */
export function idempotencyKey(parts: {
  tenantId: string;
  bizId: string;
  businessDate: string;
  sourceSystem: SourceSystem;
  reportType: ReportType;
}): string {
  return [
    parts.tenantId,
    parts.bizId,
    parts.businessDate,
    parts.sourceSystem,
    parts.reportType,
  ].join("|");
}

/** Fresh import id per run (volatile; for audit trail, not for keying rows). */
export function makeImportId(): string {
  return randomUUID();
}
