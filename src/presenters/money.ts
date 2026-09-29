// ₪ presenter: integer shekels, ROUND_HALF_AWAY_FROM_ZERO on the exact value; null ⇒ "—".
import type { AmountString } from "../finance/decimal.js";
import { decToString, parseAmountString, roundHalfAwayFromZero } from "../finance/decimal.js";

export const NOT_AVAILABLE = "—";

function group(intDigits: string): string {
  let out = "";
  for (let i = 0; i < intDigits.length; i += 1) {
    const fromEnd = intDigits.length - i;
    out += intDigits[i];
    if (fromEnd > 1 && (fromEnd - 1) % 3 === 0) out += ",";
  }
  return out;
}

export function formatShekel(amount: AmountString | null): string {
  if (amount === null) return NOT_AVAILABLE;
  const text = decToString(roundHalfAwayFromZero(parseAmountString(amount), 0));
  const neg = text.startsWith("-");
  return "₪" + (neg ? "-" : "") + group(neg ? text.slice(1) : text);
}

/** Typed totals (TI-18): only a complete result is formatted as money; anything else is "—". */
export function formatTypedAmount(result: { state: string; value: AmountString | null }): string {
  return result.state === "complete" && result.value !== null ? formatShekel(result.value) : NOT_AVAILABLE;
}
