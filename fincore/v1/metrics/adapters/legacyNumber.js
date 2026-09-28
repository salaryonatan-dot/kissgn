import { decIsNegative, decIsZero, decToString, parseAmountString, ratFromDec, roundHalfAwayFromZero } from "../../finance/decimal.js";
import { ratioOfTotals } from "../report.js";
export function amountToNumber(a) {
    if (a === null)
        return null;
    const text = a.includes("/") ? decToString(roundHalfAwayFromZero(parseAmountString(a), 10)) : a;
    return Number(text);
}
/**
 * DailyMetric-shaped adapter (Slice B1 consumer contract). Legacy amount fields cannot
 * express absence, so an absent metric is written as 0 FOR OLD READERS ONLY; the
 * `presence` block is authoritative. Ratios are null when not a value (never 0).
 */
export function toDailyMetric(day, basis) {
    const val = (m) => (m.presence === "present" ? m.value : null);
    const rev = val(day.revenue);
    const lab = val(day.directLabor);
    const food = val(day.purchases);
    const pct = (num) => {
        if (num === null || rev === null)
            return null;
        const r = ratioOfTotals(ratFromDec(num), ratFromDec(rev));
        return r.state === "value" ? amountToNumber(r.value) : null;
    };
    return {
        date: day.date,
        revenue: rev === null ? 0 : Number(decToString(rev)),
        laborCost: lab === null ? 0 : Number(decToString(lab)),
        laborPct: pct(lab),
        foodCost: food === null ? 0 : Number(decToString(food)),
        foodCostPct: basis.kind === "unresolved" ? null : pct(food),
        transactionCount: 0,
        avgTicket: 0,
        presence: day.presence,
        purchaseBasis: basis.kind,
        purchaseBasisCompat: false,
    };
}
/**
 * REV_FORECAST input day. Missing revenue ⇒ null (the day is omitted, i.e. missing to the
 * engine). A recorded 0 is an entered day (had_entry true); `has_sales` is the engine's
 * descriptive closed-day attribute (revenue > 0), never a presence test.
 */
export function toForecastDay(day) {
    if (day.revenue.presence !== "present" || day.revenue.value === null)
        return null;
    const v = day.revenue.value;
    return {
        date: day.date,
        total: Number(decToString(v)),
        had_entry: true,
        has_sales: !decIsZero(v) && !decIsNegative(v),
        is_exception: day.exception.isException,
    };
}
