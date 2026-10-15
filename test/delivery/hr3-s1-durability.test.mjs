// HR3 S1: deterministic persistence faults; no network, provider or release-success claim.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as E from '../../lib/emailDelivery.js';
import { seedWorld, sdkTransactions, HOLD_PATH } from '../support/daily-email-harness.mjs';
const D = '2026-09-08', nowMs = Date.parse(D + 'T04:05:00Z');
const op = { actor: 'local.review', reason: 'durability verification', nowMs };
const fresh = () => { const db = seedWorld(); sdkTransactions(db, 'delivery_control'); return db; };

test('HR3-S1-01 first-intent loss and no invocation have identical durable state after restart; neither review proves completeness', async () => {
  const db = fresh();
  assert.equal((await E.changeDeliveryHold(db, { ...op, action: 'hold', expectVersion: 2 })).ok, true);
  const before = structuredClone(db.read(HOLD_PATH)), ref = db.ref;
  db.ref = (p,q) => p === HOLD_PATH || String(p).startsWith(E.HELD_DATES_ROOT)
    ? { ...ref(p,q), transaction: async () => { throw new Error('no evidence persisted'); } } : ref(p,q);
  assert.equal((await E.makeDailyDeliveryGate(db,D)('g1')).open, false);
  assert.deepEqual(db.read(HOLD_PATH), before);
  assert.equal(db.read(E.heldDatePath(D)), null);
  for (const snapshot of [before, structuredClone(db.read(HOLD_PATH))]) {
    const restarted = fresh(); restarted.seed(HOLD_PATH, snapshot);
    const view = E.deliveryInventoryView(restarted.read(HOLD_PATH));
    assert.equal(view.complete, false); assert.deepEqual(view.pending, []);
    const reviewed = await E.confirmDeliveryInventory(restarted, { ...op, generation: view.generation, digest: view.digest });
    assert.equal(reviewed.ok, true); assert.equal(reviewed.releaseBlocked, true);
    assert.equal((await E.changeDeliveryHold(restarted, { ...op, action: 'release', expectVersion: 3 })).code, 'inventory_coverage_unverified');
    assert.equal(restarted.read(HOLD_PATH).state, 'held');
    assert.deepEqual(restarted.read(HOLD_PATH).log, before.log);
  }
});

test('HR3-S1-02 successful local finalization callback with committed=false cannot open a gate', async () => {
  const db = fresh(), ref = db.ref; let calls = 0;
  db.ref = (p,q) => {
    const r = ref(p,q);
    return p !== HOLD_PATH ? r : { ...r, transaction: async (update) => {
      if (++calls !== 2) return r.transaction(update);
      update(structuredClone(db.read(p))); // A prospective callback result is not a server acknowledgement.
      return { committed: false, snapshot: { val: () => db.read(p) } };
    } };
  };
  const g = await E.makeDailyDeliveryGate(db,D)('g3');
  assert.equal(g.open, false); assert.equal(g.code, 'held_day_unverifiable');
  assert.equal(Object.values(db.read(HOLD_PATH).inventory.entries)[0].state, 'pending');
});

test('HR3-S1-03 contradictory audit appearing after the logical open read cannot be finalized as allowed', async () => {
  const db = fresh(), ref = db.ref; let calls = 0;
  db.ref = (p,q) => {
    const r = ref(p,q);
    return p !== HOLD_PATH ? r : { ...r, transaction: async (update) => {
      if (++calls === 2) {
        const raw = structuredClone(db.read(p)); delete raw.log.v000000002.actor; db.seed(p,raw);
      }
      return r.transaction(update);
    } };
  };
  const g = await E.makeDailyDeliveryGate(db,D)('g3');
  assert.equal(g.open, false); assert.equal(g.code, 'held_day_unverifiable');
  assert.equal(Object.values(db.read(HOLD_PATH).inventory.entries)[0].state, 'pending');
  assert.equal(E.classifyHoldRecord(db.read(HOLD_PATH)).code, 'delivery_hold_unreadable');
});

test('HR3-S1-04 a hold between the logical open read and finalization leaves pending evidence and prevents handoff', async () => {
  const db = fresh(), ref = db.ref; let calls = 0;
  db.ref = (p,q) => {
    const r = ref(p,q);
    return p !== HOLD_PATH ? r : { ...r, transaction: async (update) => {
      if (++calls === 2) {
        const saved = db.ref; db.ref = ref;
        try { assert.equal((await E.changeDeliveryHold(db, { ...op, action: 'hold', expectVersion: 2 })).ok, true); }
        finally { db.ref = saved; }
      }
      return r.transaction(update);
    } };
  };
  const g = await E.makeDailyDeliveryGate(db,D)('g3');
  assert.equal(g.open, false); assert.equal(g.code, 'held_day_unverifiable');
  assert.equal(Object.values(db.read(HOLD_PATH).inventory.entries)[0].state, 'pending');
  assert.equal(db.read(HOLD_PATH).state, 'held');
});

test('HR3-S1-05 changed intent identity or observed version cannot use an earlier open read', async () => {
  for (const change of [
    (x) => { x.generation = '00000000-0000-4000-8000-000000000000'; },
    (x) => { x.businessDate = '2026-09-09'; },
    (x) => { x.observedVersion = 1; },
  ]) {
    const db = fresh(), ref = db.ref; let calls = 0;
    db.ref = (p,q) => {
      const r = ref(p,q);
      return p !== HOLD_PATH ? r : { ...r, transaction: async (update) => {
        if (++calls === 2) {
          const raw = structuredClone(db.read(p)); change(Object.values(raw.inventory.entries)[0]); db.seed(p,raw);
        }
        return r.transaction(update);
      } };
    };
    const g = await E.makeDailyDeliveryGate(db,D)('g3');
    assert.equal(g.open, false); assert.equal(g.code, 'held_day_unverifiable');
    assert.equal(Object.values(db.read(HOLD_PATH).inventory.entries)[0].state, 'pending');
  }
});

test('HR3-S1-06 a late finalization acknowledgement cannot retroactively open a timed-out gate', async () => {
  const db = fresh(), ref = db.ref; let calls = 0, finish;
  db.ref = (p,q) => {
    const r = ref(p,q);
    return p !== HOLD_PATH ? r : { ...r, transaction: async (update) => {
      if (++calls === 2) await new Promise((resolve) => { finish = resolve; });
      return r.transaction(update);
    } };
  };
  const g = await E.makeDailyDeliveryGate(db,D,{timeoutMs:20})('g3');
  assert.equal(g.open, false); assert.equal(g.code, 'held_day_unverifiable');
  assert.equal(Object.values(db.read(HOLD_PATH).inventory.entries)[0].state, 'pending');
  finish(); await new Promise((resolve) => setImmediate(resolve));
  assert.equal(Object.values(db.read(HOLD_PATH).inventory.entries)[0].state, 'allowed');
  assert.equal(g.open, false, 'late commit is not cancellation or permission for the returned invocation');
});
