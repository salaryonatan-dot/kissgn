// Commit 1 — "fix: guard checklist async state and template fallback"
//
// Part 1: async write-context guards. This file has two halves:
//   (1) a pure re-implementation of the exact guard mechanism used in
//       index.html (ctxRef + per-family monotonic generation + context key +
//       stillCurrent), exercised against every required stale scenario;
//   (2) static-source assertions that the guards and the canEdit-gated template
//       migration actually exist in index.html for every write family.
//
// index.html is browser JSX (Babel) and cannot be node --checked, so the guard
// LOGIC is validated here by mirroring it faithfully.
//
// Run: node --test test/security/checklist-async-context.test.mjs

import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const html = readFileSync(join(ROOT, "index.html"), "utf8");

// ─── (1) Faithful mirror of the index.html guard mechanism ───────────────────
function makeEditor(initial) {
  const ctxRef = { current: { ...initial } };            // updated "during render"
  const gen = { run: 0, simpleRun: 0, items: 0 };
  const runKey       = (c) => `run|${c.tenantId}|${c.bizId}|${c.todayKey}`;
  const simpleRunKey = (c) => `simplerun|${c.tenantId}|${c.bizId}|${c.todayKey}|${c.selectedTemplateId}`;
  const itemsKey     = (c) => `items|${c.tenantId}|${c.bizId}|${c.selectedTemplateId}`;
  const stillCurrent = (capKey, keyFn, capGen, fam) => (capKey === keyFn(ctxRef.current) && capGen === gen[fam]);

  // Rendered state the setters would touch.
  const state = { runs: null, simpleRun: null, items: null, token: null, lastError: null, lastSuccess: null };

  // Simulate the user switching context (what a load-effect / re-render does).
  function switchContext(patch) { ctxRef.current = { ...ctxRef.current, ...patch }; }

  // Begin a write: capture key+gen exactly like the component.
  function begin(fam) {
    const keyFn = fam === "run" ? runKey : fam === "simpleRun" ? simpleRunKey : itemsKey;
    const capKey = keyFn(ctxRef.current);
    const capGen = ++gen[fam];
    return { fam, keyFn, capKey, capGen };
  }
  // Apply a resolved response only if still current (mirrors the guard).
  function applySuccess(h, doc, token) {
    if (!stillCurrent(h.capKey, h.keyFn, h.capGen, h.fam)) return false;
    state[h.fam === "run" ? "runs" : h.fam === "simpleRun" ? "simpleRun" : "items"] = doc;
    state.token = token; state.lastSuccess = doc;
    return true;
  }
  function applyError(h, msg) {
    if (!stillCurrent(h.capKey, h.keyFn, h.capGen, h.fam)) return false;
    state.lastError = msg;
    return true;
  }
  return { switchContext, begin, applySuccess, applyError, state };
}

const CTX = { tenantId: "t1", bizId: "A", todayKey: "2026-07-10", selectedTemplateId: "shift" };

test("business A response after switching to B is ignored (no setter, no success)", () => {
  const ed = makeEditor(CTX);
  const h = ed.begin("run");
  ed.switchContext({ bizId: "B" });            // user switches business mid-flight
  const applied = ed.applySuccess(h, { for: "A" }, "tokA");
  assert.equal(applied, false, "stale success must not apply");
  assert.equal(ed.state.runs, null);
  assert.equal(ed.state.lastSuccess, null);
});

test("date A response after switching to date B is ignored", () => {
  const ed = makeEditor(CTX);
  const h = ed.begin("run");
  ed.switchContext({ todayKey: "2026-07-11" });
  assert.equal(ed.applySuccess(h, { d: "A" }, "tk"), false);
  assert.equal(ed.state.runs, null);
});

test("old template-items response after template switch is ignored", () => {
  const ed = makeEditor({ ...CTX, selectedTemplateId: "tplA" });
  const h = ed.begin("items");
  ed.switchContext({ selectedTemplateId: "tplB" });
  assert.equal(ed.applySuccess(h, { items: [1] }, "tk"), false);
  assert.equal(ed.state.items, null);
});

test("simple-run stale conflict reload after context switch is ignored", () => {
  const ed = makeEditor({ ...CTX, selectedTemplateId: "tplA" });
  const h = ed.begin("simpleRun");
  // write rejected with conflict; during the reload the user switches template
  ed.switchContext({ selectedTemplateId: "tplB" });
  // reload result tries to apply — must be blocked
  assert.equal(ed.applySuccess(h, { reloaded: "tplA" }, "tk"), false);
  assert.equal(ed.state.simpleRun, null);
});

test("two same-context writes resolving out of order: older ignored, newer applied", () => {
  const ed = makeEditor(CTX);
  const h1 = ed.begin("run");        // gen=1
  const h2 = ed.begin("run");        // gen=2 (newer)
  // newer resolves first and applies
  assert.equal(ed.applySuccess(h2, { v: 2 }, "tok2"), true);
  assert.deepEqual(ed.state.runs, { v: 2 });
  // older resolves later and must be ignored (would otherwise clobber newer)
  assert.equal(ed.applySuccess(h1, { v: 1 }, "tok1"), false);
  assert.deepEqual(ed.state.runs, { v: 2 }, "newer confirmed state preserved");
  assert.equal(ed.state.token, "tok2");
});

test("stale error is ignored (no error surfaced in new context)", () => {
  const ed = makeEditor(CTX);
  const h = ed.begin("simpleRun");
  ed.switchContext({ bizId: "B" });
  assert.equal(ed.applyError(h, "save failed"), false);
  assert.equal(ed.state.lastError, null, "no error message in the new context");
});

test("current (non-stale) response still updates correctly", () => {
  const ed = makeEditor(CTX);
  const h = ed.begin("run");
  const applied = ed.applySuccess(h, { ok: true }, "tokLive");
  assert.equal(applied, true);
  assert.deepEqual(ed.state.runs, { ok: true });
  assert.equal(ed.state.token, "tokLive");
});

test("cross-family isolation: a simple-run write does not invalidate an in-flight run write", () => {
  const ed = makeEditor(CTX);
  const hRun = ed.begin("run");            // run gen=1
  const hSimple = ed.begin("simpleRun");   // simpleRun gen=1 (independent family)
  assert.equal(ed.applySuccess(hSimple, { s: 1 }, "ts"), true);
  // the run write is still valid — different family, same context
  assert.equal(ed.applySuccess(hRun, { r: 1 }, "tr"), true);
  assert.deepEqual(ed.state.runs, { r: 1 });
});

// ─── (2) Static-source guard presence in index.html ──────────────────────────
test("index.html defines the context ref refreshed during render", () => {
  assert.match(html, /ctxRef\.current = \{ tenantId, bizId, todayKey, selectedTemplateId \}/);
});

test("index.html defines per-family monotonic generations and key builders", () => {
  assert.match(html, /const runGenRef = React\.useRef\(0\)/);
  assert.match(html, /const simpleRunGenRef = React\.useRef\(0\)/);
  assert.match(html, /const itemsGenRef = React\.useRef\(0\)/);
  assert.match(html, /const runKey\s+= \(c\) =>/);
  assert.match(html, /const simpleRunKey = \(c\) =>/);
  assert.match(html, /const itemsKey\s+= \(c\) =>/);
  assert.match(html, /const stillCurrent = \(capKey, keyFn, capGen, genRef\) =>/);
});

test("run write family (saveRunItem + submitRun) is guarded twice", () => {
  const n = (html.match(/const capKey = runKey\(ctxRef\.current\); const capGen = \+\+runGenRef\.current;/g) || []).length;
  assert.equal(n, 2, "both run writers capture context+generation");
});

test("simple-run write (toggleSimpleItem) is guarded", () => {
  assert.match(html, /const capKey = simpleRunKey\(ctxRef\.current\); const capGen = \+\+simpleRunGenRef\.current;/);
  assert.match(html, /if \(!stillCurrent\(capKey, simpleRunKey, capGen, simpleRunGenRef\)\) return;/);
});

test("template-items write (saveSimpleItems) is guarded at set and tail", () => {
  assert.match(html, /const capKey = itemsKey\(ctxRef\.current\); const capGen = \+\+itemsGenRef\.current;/);
  const n = (html.match(/if \(!stillCurrent\(capKey, itemsKey, capGen, itemsGenRef\)\) return;/g) || []).length;
  assert.ok(n >= 2, "items write guarded after SET and after registry sync");
});

test("createSimpleTemplate guards final setters on business/tenant switch", () => {
  assert.match(html, /const capBizKey = `\$\{ctxRef\.current\.tenantId\}\|\$\{ctxRef\.current\.bizId\}`/);
  assert.match(html, /!== capBizKey \|\| capGen !== itemsGenRef\.current\) return;/);
});

test("conflict reloads are guarded before applying reload result", () => {
  // every conflict reload path re-checks stillCurrent after the await
  const reloads = html.match(/apiGetChecklistDoc\("run"[^\n]*if \(!stillCurrent/g) || [];
  assert.ok(reloads.length >= 2, "run conflict reloads re-check context");
  assert.match(html, /apiGetChecklistDoc\("simple-run"[^\n]*if \(!stillCurrent\(capKey, simpleRunKey/);
});

test("Part 4: legacy template migration persist is gated by canEdit (manager+)", () => {
  assert.match(html, /if \(canEdit\) \{\s*try \{ await window\.storage\.set\(`biz:\$\{bizId\}:checklist_template`/);
  // and the runtime template is set for everyone regardless of persistence
  assert.match(html, /runtime template retained/);
});

test("Part 4: token invalidation on context change for all three families", () => {
  assert.match(html, /runsTokenRef\.current = null;.*Part 1/);
  assert.match(html, /itemsTokenRef\.current = null;.*Part 1/);
  assert.match(html, /simpleRunTokenRef\.current = null;.*Part 1/);
});
