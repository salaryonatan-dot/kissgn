import { decToString, parseAmountString, roundHalfAwayFromZero } from "../finance/decimal.js";
export const NOT_AVAILABLE = "—";
function group(intDigits) {
    let out = "";
    for (let i = 0; i < intDigits.length; i += 1) {
        const fromEnd = intDigits.length - i;
        out += intDigits[i];
        if (fromEnd > 1 && (fromEnd - 1) % 3 === 0)
            out += ",";
    }
    return out;
}
export function formatShekel(amount) {
    if (amount === null)
        return NOT_AVAILABLE;
    const text = decToString(roundHalfAwayFromZero(parseAmountString(amount), 0));
    const neg = text.startsWith("-");
    return "₪" + (neg ? "-" : "") + group(neg ? text.slice(1) : text);
}
