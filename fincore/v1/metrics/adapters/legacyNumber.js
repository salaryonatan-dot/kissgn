import { DEC_ZERO, decIsNegative, decIsZero, decToString, parseAmountString, ratAdd, ratFromDec, roundHalfAwayFromZero, serializeRat } from "../../finance/decimal.js";
import { isBusinessDate } from "../../finance/businessDate.js";
import { FinanceContractError } from "../../finance/types.js";
import { ratioOfTotals } from "../report.js";
import { validateLaborSource } from "../../finance/labor.js";
import { accrueDay, resolveTimeline, versionForDay } from "../costTimeline.js";
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
const GLOBAL_CONFIG_CODES = ["invalid_global_amount", "missing_global_amount"];
/**
 * One COMPLETED day's metric. The current day (and later) is outside Actual and is refused.
 * Daily laborCost = hourly employer cost + that calendar day's global allocation; on a
 * declared closed day the hourly part is not required (global still accrues). Daily values
 * are per-day views: an MTD total always comes from computePeriodReport, never from summing
 * `laborCost` over entered days.
 */
export function toDailyMetric(day, basis, laborSource, timeline, ctx) {
    const labor = validateLaborSource(laborSource);
    if (!ctx || !isBusinessDate(ctx.asOfBusinessDate))
        throw new FinanceContractError("invalid_as_of", ctx && ctx.asOfBusinessDate);
    if (day.date >= ctx.asOfBusinessDate)
        throw new FinanceContractError("day_outside_actual", day.date);
    const closed = !!ctx.operatingCalendar && Array.isArray(ctx.operatingCalendar.closedDates) && ctx.operatingCalendar.closedDates.includes(day.date);
    const val = (m) => (m.presence === "present" ? m.value : null);
    const rev = val(day.revenue);
    const hourlyRecorded = val(day.hourlyLabor);
    // A declared closed day has no hourly labor by definition; a recorded value is kept as recorded.
    const hourly = hourlyRecorded === null && closed && day.hourlyLabor.presence === "absent" ? DEC_ZERO : hourlyRecorded;
    const food = val(day.purchases);
    const version = versionForDay(resolveTimeline(timeline), day.date);
    const globalKnown = version !== null && !(timeline.flags || []).some((f) => GLOBAL_CONFIG_CODES.includes(f.code));
    const globalDay = globalKnown && version !== null ? accrueDay(version, day.date, null).global : null;
    const laborRat = hourly === null || globalDay === null ? null : ratAdd(ratFromDec(hourly), globalDay);
    const pct = (num) => {
        if (num === null || rev === null)
            return null;
        const r = ratioOfTotals(num, ratFromDec(rev));
        return r.state === "value" ? amountToNumber(r.value) : null;
    };
    return {
        date: day.date,
        revenue: rev === null ? 0 : Number(decToString(rev)),
        laborCost: laborRat === null ? 0 : amountToNumber(serializeRat(laborRat)),
        laborCostComplete: laborRat !== null,
        hourlyLaborCost: hourlyRecorded === null ? 0 : Number(decToString(hourlyRecorded)),
        globalLaborCost: globalDay === null ? null : amountToNumber(serializeRat(globalDay)),
        laborPct: pct(laborRat),
        foodCost: food === null ? 0 : Number(decToString(food)),
        foodCostPct: basis.kind === "unresolved" ? null : pct(food === null ? null : ratFromDec(food)),
        transactionCount: 0,
        avgTicket: 0,
        presence: day.presence,
        purchaseBasis: basis.kind,
        purchaseBasisCompat: false,
        laborMeaning: labor.meaning,
        laborSourceSystem: labor.sourceSystem,
        laborIngestionMethod: labor.ingestionMethod,
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
