# OVERFLOW / NON-FINITE POLICY — CTO D-R2-2 (documented explicitly)

| input (separate same-date rows, after the UNCHANGED per-row coercion) | R1 (binary, order-dependent) | R2 (exact, order-independent) |
|---|---|---|
| `[1e308, 1e308, −1e308]` | `1e308` or `Infinity` depending on order | `1e308` always — the exact mathematical total is finite, so every permutation returns it. Approved correctness fix, not a semantic change. |
| `[MAX_VALUE, MAX_VALUE]` | `Infinity` | `Infinity` — the exact final total is outside the finite range; the one final `Number(...)` conversion is the existing output representation. No clamp, no new limit. |
| `[−MAX_VALUE, −MAX_VALUE]` | `−Infinity` | `−Infinity` |
| `["1e309", 5, 7]` (scalar coerces to `+∞` today) | `Infinity` | `Infinity` (category preserved) |
| `["-1e309", 5]` | `−Infinity` | `−Infinity` |
| `["1e309", "-1e309", 1]` | `NaN` | `NaN` (both infinities) |
| a row whose own component is `NaN` (`sales:"1e309", deliveries:"-1e309"`) | `NaN` | `NaN` (a NaN component is never zeroed a second time; singleton passthrough keeps it) |
| exact cancellation `[0.1, 0.2, −0.3]` | `5.551115123125783e-17` or `0` by order | `+0` |

Not changed: the accepted input domain (`Number(v) || 0` at the scalar boundary; `'1,234'`, `'skip'`, `null`, `''` → 0; `true` → 1; `'0x10'` → 16), ratio semantics (`revenue > 0` guard; otherwise 0), the `DailyMetric` output type (Number). No rounding policy is introduced anywhere (`ROUNDING_POLICY_CHANGE: NO`).
