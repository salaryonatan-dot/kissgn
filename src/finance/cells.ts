// MARJIN_DEC/1 §4.2 input grammar + TI-14 presence states.
import { decDigitCounts, decFromNumber, decFromPlainString, decIsNegative, DecimalContractError } from "./decimal.js";
import type { Cell, InvalidReason } from "./types.js";

export const MAX_INT_DIGITS = 15;
export const MAX_FRAC_DIGITS = 6;

const PLAIN = /^[+-]?(0|[1-9][0-9]*)(\.[0-9]+)?$/;
const GROUPED = /^[+-]?[1-9][0-9]{0,2}(,[0-9]{3})+(\.[0-9]+)?$/;
const ASCII_WS = /^[ \t\n\r\f\v]+|[ \t\n\r\f\v]+$/g;

function invalid(reason: InvalidReason): Cell {
  return { state: "invalid", reason };
}

function withinLimits(cell: Cell): Cell {
  if (cell.state !== "present") return cell;
  const { intDigits, fracDigits } = decDigitCounts(cell.value);
  if (intDigits > MAX_INT_DIGITS || fracDigits > MAX_FRAC_DIGITS) return invalid("out_of_range");
  return cell;
}

/**
 * Parse one stored amount. Absent: undefined / null / "" / whitespace-only.
 * Present: a valid number or grammar string (an explicit 0 is present, value 0);
 * "skip" is a present, explicit no-activity statement (value 0) only where allowed.
 * Invalid: everything else — flagged by callers, never coerced to 0.
 */
export function parseAmount(raw: unknown, ctx: { allowSkip: boolean }): Cell {
  if (raw === undefined || raw === null) return { state: "absent" };
  if (typeof raw === "number") {
    if (!Number.isFinite(raw)) return invalid("non_finite");
    try {
      return withinLimits({ state: "present", value: decFromNumber(raw), origin: "number" });
    } catch (err) {
      if (err instanceof DecimalContractError) return invalid("bad_grammar");
      throw err;
    }
  }
  if (typeof raw !== "string") return invalid("wrong_type");
  const text = raw.replace(ASCII_WS, "");
  if (text === "") return { state: "absent" };
  if (text === "skip") {
    return ctx.allowSkip ? { state: "present", value: decFromPlainString("0"), origin: "skip" } : invalid("bad_grammar");
  }
  if (PLAIN.test(text)) {
    return withinLimits({ state: "present", value: decFromPlainString(text), origin: "string" });
  }
  if (GROUPED.test(text)) {
    return withinLimits({ state: "present", value: decFromPlainString(text.split(",").join("")), origin: "string", thousands: true });
  }
  if (text.includes(",")) return invalid("ambiguous_comma");
  return invalid("bad_grammar");
}

export function cellIsNegative(cell: Cell): boolean {
  return cell.state === "present" && decIsNegative(cell.value);
}
