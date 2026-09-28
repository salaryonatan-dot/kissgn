// MARJIN_DEC/1 — exact decimal and rational arithmetic for the Financial Core.
//
// Every monetary value, accrual and ratio inside src/finance and src/metrics is a Dec
// (BigInt coefficient + decimal scale) or a Rat (reduced BigInt fraction). No binary
// floating-point arithmetic happens here: sums are exact and therefore independent of
// operand order. Rounding exists only in roundHalfAwayFromZero(), which is called by
// presenters and legacy adapters, never by the calculation layers.

export const DECIMAL_CONTRACT_VERSION = "MARJIN_DEC/1";

/** value = c × 10^-s, normalized: s ≥ 0, no trailing zero in c when s > 0, zero = {0n, 0}. */
export interface Dec {
  readonly c: bigint;
  readonly s: number;
}

/** value = n / d, reduced, d > 0, zero = 0/1. */
export interface Rat {
  readonly n: bigint;
  readonly d: bigint;
}

/** Canonical lossless amount string: terminating decimal, or reduced "n/d". */
export type AmountString = string;

export class DecimalContractError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DecimalContractError";
  }
}

const TEN = 10n;

function pow10(k: number): bigint {
  let r = 1n;
  for (let i = 0; i < k; i += 1) r *= TEN;
  return r;
}

export function normalizeDec(c: bigint, s: number): Dec {
  if (c === 0n) return { c: 0n, s: 0 };
  let cc = c;
  let ss = s;
  while (ss > 0 && cc % TEN === 0n) {
    cc /= TEN;
    ss -= 1;
  }
  return { c: cc, s: ss };
}

export const DEC_ZERO: Dec = { c: 0n, s: 0 };

/** Parse a plain canonical digit string "-123.45" (no exponent, already validated). */
export function decFromPlainString(text: string): Dec {
  const m = /^([+-]?)([0-9]+)(?:\.([0-9]+))?$/.exec(text);
  if (!m) throw new DecimalContractError("not_a_plain_decimal:" + text);
  const frac = m[3] || "";
  let c = BigInt(m[2] + frac);
  if (m[1] === "-") c = -c;
  return normalizeDec(c, frac.length);
}

function smallIntFromDigits(sign: string, digits: string): number {
  let v = 0;
  for (const ch of digits) v = v * 10 + (ch.charCodeAt(0) - 48);
  return sign === "-" ? -v : v;
}

const CANONICAL_NUMBER = /^(-?)([0-9]+)(?:\.([0-9]+))?(?:e([+-]?)([0-9]+))?$/;

/**
 * Exact decimal of a finite JS number's canonical round-trip string
 * (Number.prototype.toString) — the same interpretation the approved server reader
 * (dailyMetricsRepo.canonicalDecimal, CTO D-R2) uses.
 */
export function decFromNumber(x: number): Dec {
  if (!Number.isFinite(x)) throw new DecimalContractError("non_finite_number");
  const m = CANONICAL_NUMBER.exec(x.toString());
  if (!m) throw new DecimalContractError("non_canonical_number:" + x.toString());
  const frac = m[3] || "";
  let c = BigInt(m[2] + frac);
  if (m[1] === "-") c = -c;
  let s = frac.length - (m[5] ? smallIntFromDigits(m[4], m[5]) : 0);
  if (s < 0) {
    c *= pow10(-s);
    s = 0;
  }
  return normalizeDec(c, s);
}

function align(a: Dec, b: Dec): [bigint, bigint, number] {
  if (a.s === b.s) return [a.c, b.c, a.s];
  if (a.s > b.s) return [a.c, b.c * pow10(a.s - b.s), a.s];
  return [a.c * pow10(b.s - a.s), b.c, b.s];
}

export function decAdd(a: Dec, b: Dec): Dec {
  const [x, y, s] = align(a, b);
  return normalizeDec(x + y, s);
}

export function decSub(a: Dec, b: Dec): Dec {
  const [x, y, s] = align(a, b);
  return normalizeDec(x - y, s);
}

export function decSum(values: readonly Dec[]): Dec {
  let acc = DEC_ZERO;
  for (const v of values) acc = decAdd(acc, v);
  return acc;
}

export function decCmp(a: Dec, b: Dec): -1 | 0 | 1 {
  const [x, y] = align(a, b);
  return x < y ? -1 : x > y ? 1 : 0;
}

export function decIsZero(a: Dec): boolean {
  return a.c === 0n;
}

export function decIsNegative(a: Dec): boolean {
  return a.c < 0n;
}

/** Digits of the integer and fractional parts (for input range limits). */
export function decDigitCounts(a: Dec): { intDigits: number; fracDigits: number } {
  const abs = a.c < 0n ? -a.c : a.c;
  const str = abs.toString();
  const intDigits = str.length > a.s ? str.length - a.s : 1;
  return { intDigits, fracDigits: a.s };
}

export function decToString(a: Dec): AmountString {
  if (a.s === 0) return a.c.toString();
  const neg = a.c < 0n;
  let digits = (neg ? -a.c : a.c).toString();
  while (digits.length <= a.s) digits = "0" + digits;
  const ip = digits.slice(0, digits.length - a.s);
  const fp = digits.slice(digits.length - a.s);
  return (neg ? "-" : "") + ip + "." + fp;
}

// ── Rationals ────────────────────────────────────────────────────────────────

function gcd(a: bigint, b: bigint): bigint {
  let x = a < 0n ? -a : a;
  let y = b < 0n ? -b : b;
  while (y !== 0n) {
    const t = x % y;
    x = y;
    y = t;
  }
  return x;
}

export function rat(n: bigint, d: bigint = 1n): Rat {
  if (d === 0n) throw new DecimalContractError("division_by_zero");
  let nn = n;
  let dd = d;
  if (dd < 0n) {
    nn = -nn;
    dd = -dd;
  }
  if (nn === 0n) return { n: 0n, d: 1n };
  const g = gcd(nn, dd);
  return { n: nn / g, d: dd / g };
}

export const RAT_ZERO: Rat = { n: 0n, d: 1n };

export function ratFromDec(a: Dec): Rat {
  return rat(a.c, pow10(a.s));
}

export function ratFromInt(k: number): Rat {
  return rat(BigInt(k), 1n);
}

export function ratAdd(a: Rat, b: Rat): Rat {
  return rat(a.n * b.d + b.n * a.d, a.d * b.d);
}

export function ratSub(a: Rat, b: Rat): Rat {
  return rat(a.n * b.d - b.n * a.d, a.d * b.d);
}

export function ratMul(a: Rat, b: Rat): Rat {
  return rat(a.n * b.n, a.d * b.d);
}

export function ratDiv(a: Rat, b: Rat): Rat {
  if (b.n === 0n) throw new DecimalContractError("division_by_zero");
  return rat(a.n * b.d, a.d * b.n);
}

export function ratSum(values: readonly Rat[]): Rat {
  let acc = RAT_ZERO;
  for (const v of values) acc = ratAdd(acc, v);
  return acc;
}

export function ratCmp(a: Rat, b: Rat): -1 | 0 | 1 {
  const x = a.n * b.d;
  const y = b.n * a.d;
  return x < y ? -1 : x > y ? 1 : 0;
}

export function ratIsZero(a: Rat): boolean {
  return a.n === 0n;
}

export function ratIsNegative(a: Rat): boolean {
  return a.n < 0n;
}

/** Terminating (denominator 2^a·5^b) rationals become exact decimals; otherwise null. */
export function ratToDecExact(a: Rat): Dec | null {
  let d = a.d;
  let twos = 0;
  let fives = 0;
  while (d % 2n === 0n) {
    d /= 2n;
    twos += 1;
  }
  while (d % 5n === 0n) {
    d /= 5n;
    fives += 1;
  }
  if (d !== 1n) return null;
  const s = twos > fives ? twos : fives;
  const c = (a.n * pow10(s)) / a.d;
  return normalizeDec(c, s);
}

/** Canonical lossless serialization (MARJIN_DEC/1 §4.5). */
export function serializeRat(a: Rat): AmountString {
  const exact = ratToDecExact(a);
  if (exact) return decToString(exact);
  return a.n.toString() + "/" + a.d.toString();
}

export function serializeDec(a: Dec): AmountString {
  return decToString(a);
}

const AMOUNT_DECIMAL = /^-?(0|[1-9][0-9]*)(\.[0-9]*[1-9])?$/;
const AMOUNT_RATIONAL = /^-?(0|[1-9][0-9]*)\/[1-9][0-9]*$/;

export function isCanonicalAmountString(text: string): boolean {
  if (text === "-0") return false;
  if (AMOUNT_DECIMAL.test(text)) return true;
  if (!AMOUNT_RATIONAL.test(text)) return false;
  const [ns, ds] = text.split("/");
  const r = rat(BigInt(ns), BigInt(ds));
  return r.n.toString() === ns && r.d.toString() === ds && ratToDecExact(r) === null;
}

export function parseAmountString(text: string): Rat {
  if (!isCanonicalAmountString(text)) throw new DecimalContractError("non_canonical_amount:" + text);
  if (text.includes("/")) {
    const [ns, ds] = text.split("/");
    return rat(BigInt(ns), BigInt(ds));
  }
  return ratFromDec(decFromPlainString(text));
}

/** ROUND_HALF_AWAY_FROM_ZERO to `fractionDigits` decimals; never yields negative zero. */
export function roundHalfAwayFromZero(a: Rat, fractionDigits: number): Dec {
  const scale = pow10(fractionDigits);
  const num = a.n * scale;
  const neg = num < 0n;
  const absNum = neg ? -num : num;
  const q = absNum / a.d;
  const r = absNum % a.d;
  const rounded = r * 2n >= a.d ? q + 1n : q;
  return normalizeDec(neg ? -rounded : rounded, fractionDigits);
}
