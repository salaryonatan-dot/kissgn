import { FinanceContractError } from "./types.js";
export const BUSINESS_TIMEZONE = "Asia/Jerusalem";
const DATE_RE = /^([0-9]{4})-([0-9]{2})-([0-9]{2})$/;
function digits(text) {
    let v = 0;
    for (const ch of text)
        v = v * 10 + (ch.charCodeAt(0) - 48);
    return v;
}
export function isLeapYear(y) {
    return (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0;
}
export function daysInMonth(year, month1) {
    if (month1 === 2)
        return isLeapYear(year) ? 29 : 28;
    return month1 === 4 || month1 === 6 || month1 === 9 || month1 === 11 ? 30 : 31;
}
export function parseBusinessDate(date) {
    if (typeof date !== "string")
        return null;
    const m = DATE_RE.exec(date);
    if (!m)
        return null;
    const y = digits(m[1]);
    const mo = digits(m[2]);
    const d = digits(m[3]);
    if (mo < 1 || mo > 12 || d < 1 || d > daysInMonth(y, mo))
        return null;
    return { y, m: mo, d };
}
export function isBusinessDate(date) {
    return typeof date === "string" && parseBusinessDate(date) !== null;
}
function pad(n, w) {
    let s = String(n);
    while (s.length < w)
        s = "0" + s;
    return s;
}
export function formatBusinessDate(y, m, d) {
    return pad(y, 4) + "-" + pad(m, 2) + "-" + pad(d, 2);
}
function requireDate(date) {
    const p = parseBusinessDate(date);
    if (!p)
        throw new FinanceContractError("invalid_business_date", date);
    return p;
}
function nextDay(p) {
    if (p.d < daysInMonth(p.y, p.m))
        return { y: p.y, m: p.m, d: p.d + 1 };
    if (p.m < 12)
        return { y: p.y, m: p.m + 1, d: 1 };
    return { y: p.y + 1, m: 1, d: 1 };
}
function prevDay(p) {
    if (p.d > 1)
        return { y: p.y, m: p.m, d: p.d - 1 };
    if (p.m > 1)
        return { y: p.y, m: p.m - 1, d: daysInMonth(p.y, p.m - 1) };
    return { y: p.y - 1, m: 12, d: 31 };
}
/** Calendar step by n days (small |n|; the core only steps day by day). */
export function addDays(date, n) {
    let p = requireDate(date);
    if (n >= 0)
        for (let i = 0; i < n; i += 1)
            p = nextDay(p);
    else
        for (let i = 0; i < -n; i += 1)
            p = prevDay(p);
    return formatBusinessDate(p.y, p.m, p.d);
}
export function compareDates(a, b) {
    return a < b ? -1 : a > b ? 1 : 0;
}
/** Inclusive list of calendar dates from `from` to `to` (empty when to < from). */
export function datesInRange(from, to) {
    requireDate(from);
    requireDate(to);
    const out = [];
    let cur = from;
    while (cur <= to) {
        out.push(cur);
        cur = addDays(cur, 1);
    }
    return out;
}
export function monthOf(date) {
    requireDate(date);
    return date.slice(0, 7);
}
export function monthBounds(month) {
    const m = /^([0-9]{4})-([0-9]{2})$/.exec(month);
    if (!m)
        throw new FinanceContractError("invalid_month", month);
    const y = digits(m[1]);
    const mo = digits(m[2]);
    if (mo < 1 || mo > 12)
        throw new FinanceContractError("invalid_month", month);
    const days = daysInMonth(y, mo);
    return { first: formatBusinessDate(y, mo, 1), last: formatBusinessDate(y, mo, days), days };
}
export function daysInMonthOf(date) {
    const p = requireDate(date);
    return daysInMonth(p.y, p.m);
}
/** 0 = Sunday … 6 = Saturday (Sakamoto; identical to REV_FORECAST/v1 dowOf). */
export function dowOf(date) {
    const p = requireDate(date);
    const t = [0, 3, 2, 5, 0, 3, 5, 1, 4, 6, 2, 4];
    const yy = p.m < 3 ? p.y - 1 : p.y;
    const q4 = (yy - (yy % 4)) / 4;
    const q100 = (yy - (yy % 100)) / 100;
    const q400 = (yy - (yy % 400)) / 400;
    return (yy + q4 - q100 + q400 + t[p.m - 1] + p.d) % 7;
}
/** Israel business date of an injected instant (ms since epoch). */
export function israelBusinessDate(nowMs) {
    if (typeof nowMs !== "number" || !Number.isFinite(nowMs))
        throw new FinanceContractError("invalid_instant", nowMs);
    const parts = new Intl.DateTimeFormat("en-CA", { timeZone: BUSINESS_TIMEZONE, year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(nowMs);
    const get = (type) => {
        const p = parts.find((x) => x.type === type);
        if (!p)
            throw new FinanceContractError("intl_unavailable");
        return p.value;
    };
    const date = get("year") + "-" + get("month") + "-" + get("day");
    requireDate(date);
    return date;
}
