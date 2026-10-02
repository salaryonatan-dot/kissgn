// C1 R2: one bounded closure-history attempt, deterministic timers and deferred list reads.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { loadFinance, loadSeam } from '../support/c1-seam.mjs';

const F = await loadFinance();
const C = loadSeam();
const FROM = '2026-09-01', TO = '2026-09-30';
const ok = (from, to, exceptions = {}) => ({ ok: true, fromDate: from, toDate: to, exceptions });
const tick = () => new Promise((resolve) => setImmediate(resolve));
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
function clock() {
  let seq = 0;
  const tasks = new Map();
  const cleared = [];
  return {
    setTimeout: (fn, ms) => { const id = ++seq; tasks.set(id, { fn, ms }); return id; },
    clearTimeout: (id) => { cleared.push(id); tasks.delete(id); },
    pending: () => tasks.size,
    durations: () => [...tasks.values()].map((x) => x.ms),
    cleared: () => cleared.length,
    fire: () => { const [id, task] = tasks.entries().next().value || []; assert.ok(task, 'a deadline is scheduled'); tasks.delete(id); task.fn(); },
  };
}

// R1 red: no deadline was scheduled; all six tests fail promptly before awaiting a held request.
test('C1R2-01 a never-settling list read expires as an explicit retryable unreadable state', async () => {
  const t = clock(), s = C.createLedgerSession(F, t), held = deferred();
  let observedSignal;
  const p = s.request('a0', FROM, TO, (_f, _to, signal) => { observedSignal = signal; return held.promise; });
  await tick();
  assert.deepEqual(t.durations(), [C.LEDGER_ATTEMPT_DEADLINE_MS]);
  assert.ok(observedSignal, 'the browser request receives an abort signal');
  t.fire();
  const result = await p;
  assert.equal(result.state, 'unreadable'); assert.equal(result.reason, 'deadline_exceeded'); assert.equal(result.key, 'a0');
  assert.equal(C.ledgerFor(result, 'a0').state, 'unreadable');
  assert.equal(t.pending(), 0);
});

test('C1R2-02 retry gets a new attempt and succeeds after an expired never-settling read', async () => {
  const t = clock(), s = C.createLedgerSession(F, t), held = deferred();
  const first = s.request('a0', FROM, TO, () => held.promise);
  await tick();
  assert.equal(t.pending(), 1);
  t.fire(); assert.equal((await first).reason, 'deadline_exceeded');
  const retry = s.request('a1', FROM, TO, async (f, to) => ok(f, to));
  assert.equal(t.pending(), 1);
  const result = await retry;
  assert.equal(result.state, 'absent'); assert.equal(result.key, 'a1');
  assert.equal(t.pending(), 0); assert.ok(t.cleared() >= 2);
});

test('C1R2-03 old success after retry success cannot replace the recovered result', async () => {
  const t = clock(), s = C.createLedgerSession(F, t), held = deferred(), published = [];
  const first = s.request('a0', FROM, TO, () => held.promise).then((r) => published.push(r));
  await tick();
  assert.equal(t.pending(), 1); t.fire(); await first;
  const good = await s.request('a1', FROM, TO, async (f, to) => ok(f, to));
  published.push(good);
  held.resolve(ok(FROM, TO, { '2026-09-07': { source: 'structured', status: 'active' } }));
  await tick();
  assert.equal(published.length, 2); assert.equal(published[1], good);
  assert.equal(good.state, 'absent'); assert.equal(s.latest(), 'a1');
});

test('C1R2-04 late old success or rejection while retry is pending cannot replace its loading state', async () => {
  for (const late of ['resolve', 'reject']) {
    const t = clock(), s = C.createLedgerSession(F, t), old = deferred(), next = deferred();
    const first = s.request('a0', FROM, TO, () => old.promise);
    await tick(); // attach the real fetch before expiring it, so a late rejection is observable
    assert.equal(t.pending(), 1); t.fire(); assert.equal((await first).reason, 'deadline_exceeded');
    const retry = s.request('a1', FROM, TO, () => next.promise);
    assert.equal(t.pending(), 1);
    if (late === 'resolve') old.resolve(ok(FROM, TO)); else old.reject(new Error('late failure'));
    await tick();
    assert.equal(C.ledgerFor({ state: 'unreadable', key: 'a0' }, 'a1').state, 'loading');
    assert.equal(t.pending(), 1); assert.equal(s.latest(), 'a1');
    next.resolve(ok(FROM, TO));
    assert.equal((await retry).state, 'absent'); assert.equal(t.pending(), 0);
  }
});

test('C1R2-05 one attempt deadline bounds a later hung chunk, not merely the first fetch', async () => {
  const t = clock(), s = C.createLedgerSession(F, t), later = deferred();
  const from = '2025-09-01', to = '2026-09-30';
  assert.ok(C.ledgerChunks(F, from, to).length > 1);
  let calls = 0;
  const p = s.request('multi', from, to, (f, end) => ++calls === 1 ? ok(f, end) : later.promise);
  await tick();
  assert.equal(calls, 2); assert.deepEqual(t.durations(), [C.LEDGER_ATTEMPT_DEADLINE_MS]);
  t.fire();
  const result = await p;
  assert.equal(result.state, 'unreadable'); assert.equal(result.reason, 'deadline_exceeded');
  assert.equal(t.pending(), 0);
  later.resolve(ok(C.ledgerChunks(F, from, to)[1].from, C.ledgerChunks(F, from, to)[1].to));
  await tick(); assert.equal(result.state, 'unreadable');
});

test('C1R2-06 context invalidation, timely completion and disposal clear timers and abort old reads', async () => {
  const t = clock(), s = C.createLedgerSession(F, t), old = deferred(), pending = deferred();
  let firstSignal;
  const first = s.request('bizA', FROM, TO, (_f, _to, signal) => { firstSignal = signal; return old.promise; });
  await tick(); assert.equal(t.pending(), 1);
  const second = s.request('bizB|newWindow', FROM, TO, async (f, to) => ok(f, to));
  assert.equal((await first).state, 'stale'); assert.equal(firstSignal.aborted, true);
  assert.equal((await second).state, 'absent'); assert.equal(t.pending(), 0);
  const third = s.request('bizB|retry', FROM, TO, () => pending.promise);
  assert.equal(t.pending(), 1);
  s.cancel(); assert.equal((await third).state, 'stale'); assert.equal(t.pending(), 0);
  assert.equal(s.latest(), null); assert.ok(t.cleared() >= 3);
});
