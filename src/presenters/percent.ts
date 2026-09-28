// % presenter: one decimal, ROUND_HALF_AWAY_FROM_ZERO; non-values ⇒ "—".
import type { AmountString } from "../finance/decimal.js";
import { decToString, parseAmountString, roundHalfAwayFromZero } from "../finance/decimal.js";
import { NOT_AVAILABLE } from "./money.js";

export function formatPercent(input: AmountString | null | { state: string; value?: AmountString }): string {
  const value = input === null ? null : typeof input === "string" ? input : input.state === "value" && input.value !== undefined ? input.value : null;
  if (value === null) return NOT_AVAILABLE;
  const text = decToString(roundHalfAwayFromZero(parseAmountString(value), 1));
  return (text.includes(".") ? text : text + ".0") + "%";
}
