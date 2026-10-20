// Test-only scenario clock: capture execution time once; align all dates to Israel's calendar.
// Callers run sequentially. A concurrent/nested scenario is refused; the prior Date is always restored.
import assert from "node:assert/strict";
let active = false;
export async function withIsraelScenario(fn, nowMs = Date.now()) {
  assert.equal(active, false, "scenario clocks must not overlap");
  assert.ok(Number.isSafeInteger(nowMs), "finite scenario instant");
  const descriptor = Object.getOwnPropertyDescriptor(globalThis, "Date");
  const PreviousDate = globalThis.Date;
  const fmt = new Intl.DateTimeFormat("en-CA", { timeZone: "Asia/Jerusalem", year: "numeric", month: "2-digit", day: "2-digit" });
  const parts = Object.fromEntries(fmt.formatToParts(new PreviousDate(nowMs)).map(p => [p.type, p.value]));
  const today = `${parts.year}-${parts.month}-${parts.day}`;
  const [y, m, d] = today.split("-").map(Number);
  const dayBefore = n => new PreviousDate(PreviousDate.UTC(y, m - 1, d - n)).toISOString().slice(0, 10);
  function ScenarioDate(...args) {
    if (!new.target) return new PreviousDate(nowMs).toString();
    return Reflect.construct(PreviousDate, args.length ? args : [nowMs], new.target === ScenarioDate ? PreviousDate : new.target);
  }
  Object.setPrototypeOf(ScenarioDate, PreviousDate);
  ScenarioDate.prototype = PreviousDate.prototype;
  Object.defineProperty(ScenarioDate, "now", { value: () => nowMs });
  active = true;
  try {
    Object.defineProperty(globalThis, "Date", { ...descriptor, value: ScenarioDate });
    return await fn(Object.freeze({ nowMs, nowIso: new PreviousDate(nowMs).toISOString(), today, dayBefore }));
  } finally {
    Object.defineProperty(globalThis, "Date", descriptor);
    active = false;
  }
}
