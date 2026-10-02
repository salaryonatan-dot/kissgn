// WP-C1 — the index.html scope contract of the C1 browser-surface migration (B2G-05, C1 branch).
//
// The APPROVED page is the release-assembly index.html (the clean merge of CD-M2 R1 and HF-1 R1,
// recomputed from git objects by the B2G-05 guard — never read from the working tree). A C1
// candidate may differ from it ONLY:
//   R1  inside the fixed C1 zones below, each located by anchors that are unique in the APPROVED
//       bytes (every changed / inserted line of a line diff must fall inside one zone);
//   R2  while every protected write / lifecycle sub-region INSIDE a zone stays byte-identical
//       (anchors unique in both files);
//   R3  while the multiset of lines that call a write / lifecycle entry point is unchanged across
//       the WHOLE file (no write call added, removed or edited anywhere);
//   R4  while the new browser blocks are exactly the fincore bootstrap and the MarjinC1 seam.
// Everything outside the zones is therefore byte-identical to the approved page (R1).
// Known limitation (documented in the C1 handoff): an edit INSIDE a zone that touches no
// protected sub-region and no write call is accepted by this contract; it is bounded by the
// zones, and by the guard's committed == checked-out == staged consistency of index.html.
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

export const C1_ASSEMBLY = "239602c95b9127291e1b60eca39e6efef3074664"; // approved RC 1.0 release assembly (independent review: APPROVED)

/**
 * C1 zones in the APPROVED page: [name, startAnchor, endAnchor, kind?] (inclusive lines).
 * kind "insert": ONLY new lines between the anchor lines are allowed — no approved line of the
 * zone (anchors included) may be modified or deleted.
 */
export const C1_ZONES = Object.freeze([
  ["css-hm-row (2 forecast cells)", "    .hm-row  { display:grid; grid-template-columns:repeat(3,1fr);", "z-index:1; }"],
  ["fincore bootstrap insertion", '    window.dispatchEvent(new Event("firebase-ready"));', "  <!-- ═══ REV_FORECAST/v1", "insert"],
  ["MarjinC1 seam insertion", '      sanitizeExceptionOnSave:sanitizeExceptionOnSave, FORMULA_ID:"REV_FORECAST/v1"', '  <script type="text/babel" data-presets="react">', "insert"],
  ["retired page finance formulas (U-09)", "// ─── Helper: compute monthly metrics from entries", "function PilotDashboard() {"],
  ["finance inputs (read-only wiring)", '    return () => { live = false; unsubs.forEach(u => typeof u==="function" && u()); clearInterval(orefInterval); };', "  const israelDateKey = (offsetDays=0) => {", "insert"],
  ["dashboard derivations", "  const monthPrefix = `${YEAR}-${MONTH_STR}-`;", "  const sendAI = React.useCallback("],
  ["supplier reminders (D-17/S-09)", "  // Calculate missing supplier data per supplier this month", "  if(!loaded) return"],
  ["fixed modal total (D-21)", '<div style={{fontSize:12,color:"#94A3B8",marginTop:3}}>קבועות + שכ״ד: <strong', "</span>}</div>"],
  ["dashboard screen", "      {/* ═══ DASHBOARD ═══ */}", "{/* ═══ FOOD COST ═══ */}"],
  ["food-cost screen", "{/* ═══ FOOD COST ═══ */}", "      {/* ═══ CREDIT ALERTS ═══ */}"],
  ["entry labor preview (E-02/E-03/E-05)", '            <div className="form-sec">הוצאות כ״א</div>', '            <label className="label">הוצאה אחרת (₪)</label>'],
  ["entry revenue preview (E-01)", "              const rawInc=(Number(form.sales)||0)+(Number(form.deliveries)||0)+(Number(form.other_income)||0);\n              const netInc", "            })()}"],
  ["history screen", "      {/* ═══ HISTORY ═══ */}", "      {/* ═══ FORECAST ═══ */}"],
  ["forecast / P&L screen props", "      {/* ═══ FORECAST ═══ */}", "      {/* ═══ SHIFTS ═══ */}"],
  ["employees screen props", '      {screen==="employees" && !currentUser && (', '      {screen==="tasks" && !currentUser && ('],
  ["legacy fixed screen (X-02)", "      {/* ═══ FIXED SCREEN (legacy, kept for backward compat) ═══ */}", "      {/* ═══ ADMIN PANEL (super_owner only) ═══ */}"],
  ["EmployeesScreen", "function EmployeesScreen({ businessConfig, saveBusinessConfig, entries, submitLaborEntry }) {", "// ─── Master Tasks Screen"],
  ["PnLScreen", "function PnLScreen({ entries=[], fixedList=[], businessConfig={}, lastYear=[] }) {", 'const DOW_KEYS    = ["sun"'],
  ["DailyInsightsScreen", "function DailyInsightsScreen({ tenantId, bizId }) {", "function KpiTile({ label, value, sub }) {"],
]);

/** Protected sub-regions INSIDE the zones: [name, start, end] — byte-identical in both files. */
export const C1_PROTECTED = Object.freeze([
  ["getSupPay (grid read)", "            const getSupPay = (supId, date) => {", "            };"],
  ["setSupPayDate (supplier write lane)", "            const setSupPayDate = async (supId, date, val) => {", 'clearError: () => setSupplierWriteError(""),\n              });\n            };'],
  ["supplier grid cell input + skip", '                                <input type="number" inputMode="decimal" placeholder="₪"\n                                  value={val==="0"||val===0?"":val||""}', "</button>"],
  ["unplanned supplier add", "                                const existing=Number(getSupPay(sup.id,d))||0;", "setSupPayDate(sup.id,d,String(newVal));"],
  ["supplier write error banner", "                {supplierWriteError&&(", "                )}"],
  ["payroll input", '                <input className="input" type="number" inputMode="numeric" placeholder="0" value={form.payroll}', "/>"],
  ["hourly employee inputs", "                        const val = (form.hourly_payroll||{})[emp.id]||\"\";", "                        );"],
  ["history clear-all", '                  if(!window.confirm("למחוק את כל הרשומות?")) return;', "                }}"],
  ["history duplicate collection", "	                const entriesByDate = new Map();", "dupExtras.set(e.date, list);\n	                });"],
  ["history openEntry (edit identity)", "		                  const openEntry = () => {", '		                    setScreen("entry");\n	                  };'],
  ["history row delete", "	                            onClick={()=>deleteEntryByDate(e.date)}", "</button>"],
  ["history duplicate delete", "                                onClick={()=>{ if(!window.confirm(`למחוק רשומה כפולה זו", 'data-testid="dup-delete"'],
  ["setDailyLabor (labor write lane)", "  const setDailyLabor = async (date, val) => {", "    return res;\n  };"],
  ["employee save / remove / edit", "  const saveEmp = () => {", "  const startEdit = emp =>"],
  ["daily labor input", '              <input type="number" inputMode="numeric" placeholder="₪ נוכחות"', "/>"],
  ["labor save error banner", '      {laborSaveError && <div data-testid="labor-save-error"', "</div>}"],
  ["global employee form inputs", '                <input style={inp} placeholder="שם עובד"', "/>"],
  ["fixed screen amount input", '                    : <input className="input" style={{padding:"5px 9px",flex:1,marginBottom:0}} type="number" inputMode="decimal" placeholder="₪" value={f.amount||""}', "/>"],
]);

/** Write / lifecycle entry points: the multiset of lines calling them must not change anywhere. */
export const C1_WRITE_TOKENS = Object.freeze([
  "saveEntry(", "saveBusinessConfig(", "persistFixed(", "persistEntries(", "setSupPayDate(", "setDailyLabor(", "submitLaborEntry(",
  "submitSupplierEdit(", "submitClearAll(", "submitIntent(", "deleteEntryByDate(", "deleteEntryById(", "closeBusinessDay(", "reopenBusinessDay(",
  "saveSuppliers(", "saveLastYear(", "storage.set(", "storage.setFor(", "storage.mutateFor(", "storage.delete(", "_rtdbSet(",
  "set-entry-exception", "clear-entry-exception", "runTransaction(",
]);

const text = (b) => (Buffer.isBuffer(b) ? b.toString("utf8") : String(b));
const lineAt = (src, idx) => src.slice(0, idx).split("\n").length;  // 1-based line of a character index

function locate(src, start, end) {
  const i = src.indexOf(start);
  if (i < 0) return { error: "anchor_missing" };
  if (src.indexOf(start, i + 1) !== -1) return { error: "anchor_not_unique" };
  const j = src.indexOf(end, i + start.length);
  if (j < 0) return { error: "end_anchor_missing" };
  return { from: i, to: j + end.length, firstLine: lineAt(src, i), lastLine: lineAt(src, j + end.length - 1) };
}

/** Old-side hunks of a line diff A→B: [{start, count}] (count 0 = insertion after `start`). */
export function diffHunks(a, b) {
  const dir = mkdtempSync(join(tmpdir(), "c1-scope-"));
  try {
    writeFileSync(join(dir, "a"), a); writeFileSync(join(dir, "b"), b);
    const r = spawnSync("git", ["diff", "--no-index", "--no-color", "-U0", "--", "a", "b"], { cwd: dir, encoding: "utf8", maxBuffer: 256 * 1024 * 1024 });
    if (r.status !== 0 && r.status !== 1) throw new Error("git diff --no-index failed: " + r.stderr);
    const out = [];
    for (const m of r.stdout.matchAll(/^@@ -(\d+)(?:,(\d+))? \+\d+(?:,\d+)? @@/gm)) out.push({ start: Number(m[1]), count: m[2] === undefined ? 1 : Number(m[2]) });
    return out;
  } finally { rmSync(dir, { recursive: true, force: true }); }
}

function writeLines(src) {
  const m = new Map();
  for (const l of src.split("\n")) if (C1_WRITE_TOKENS.some((t) => l.includes(t))) m.set(l, (m.get(l) || 0) + 1);
  return m;
}

/**
 * Verdict of the C1 contract for a candidate page against the APPROVED page (both bytes).
 * { ok: true } | { ok: false, reason, detail }
 */
export function c1IndexVerdict(approvedBytes, candidateBytes) {
  const A = text(approvedBytes), B = text(candidateBytes);
  const zones = [];
  for (const [name, s, e, kind] of C1_ZONES) {
    const z = locate(A, s, e);
    if (z.error) return { ok: false, reason: "zone_anchor_invalid", detail: [name, z.error] };
    zones.push({ name, kind: kind || "replace", ...z });
  }
  // R1 every changed / inserted line of the approved page lies inside one zone
  const outside = [];
  for (const h of diffHunks(A, B)) {
    const inZone = h.count === 0
      ? zones.some((z) => h.start >= z.firstLine && h.start < z.lastLine)
      : zones.some((z) => z.kind === "replace" && h.start >= z.firstLine && h.start + h.count - 1 <= z.lastLine);
    if (!inZone) outside.push(h.count === 0 ? `insertion after line ${h.start}` : `lines ${h.start}-${h.start + h.count - 1}`);
  }
  if (outside.length) return { ok: false, reason: "change_outside_c1_zones", detail: outside };
  // R2 protected sub-regions inside the zones are byte-identical
  for (const [name, s, e] of C1_PROTECTED) {
    const a = locate(A, s, e), b = locate(B, s, e);
    if (a.error) return { ok: false, reason: "protected_anchor_invalid", detail: [name, "approved", a.error] };
    if (b.error) return { ok: false, reason: "protected_region_changed", detail: [name, b.error] };
    if (A.slice(a.from, a.to) !== B.slice(b.from, b.to)) return { ok: false, reason: "protected_region_changed", detail: [name] };
    if (!zones.some((z) => a.firstLine >= z.firstLine && a.lastLine <= z.lastLine)) return { ok: false, reason: "protected_region_not_in_zone", detail: [name] };
  }
  // R3 no write / lifecycle call added, removed or edited anywhere
  const wa = writeLines(A), wb = writeLines(B), changed = [];
  for (const k of new Set([...wa.keys(), ...wb.keys()])) if ((wa.get(k) || 0) !== (wb.get(k) || 0)) changed.push(k.trim().slice(0, 160));
  if (changed.length) return { ok: false, reason: "write_path_lines_changed", detail: changed };
  // R4 the new browser blocks: exactly one fincore bootstrap and one MarjinC1 seam
  const count = (re) => (B.match(re) || []).length;
  if (count(/<script type="module">\s*\n\s*\/\/ ── C1 fincore bootstrap ──/g) !== 1) return { ok: false, reason: "fincore_bootstrap_shape" };
  if (count(/await import\("\/fincore\/v1\/browser\/marjinFinanceGlobal\.js"\)/g) !== 1) return { ok: false, reason: "fincore_import_shape" };
  if (count(/\/\/ ── C1 browser financial view models/g) !== 1) return { ok: false, reason: "c1_seam_shape" };
  return { ok: true };
}
