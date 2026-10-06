import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bothCores } from '../support/fincore-load.mjs';
import { creditNode, spec, view, clone, cid, oid, T, B } from '../support/p1-credit-fixtures.mjs';
import { canonicalCreditJson } from '../../fincore/v1/finance/creditEvidence.js';
import * as Repo from '../../lib/repositories/supplierCreditsRepo.js';
import { memoryDb, NODE } from '../support/p1-r3-api-harness.mjs';
import { entry, inputs, uid } from '../support/b1-fixtures.mjs';

const cores = await bothCores();
const bind = { tenantId: T, bizId: B };
const built = state => creditNode([spec(1, 's1', '2026-10-01', '10', { review: state })]);
function failsClosed(decoded, label) {
  if (decoded.state === 'unreadable') return;
  assert.equal(decoded.state, 'present', label);
  assert.equal(decoded.credits.length, 0, label);
  assert.ok(decoded.issues.some(i => i.code === 'invalid_review' || i.code === 'invalid_review_audit'), `${label}: ${JSON.stringify(decoded)}`);
}

for (const state of ['pending', 'cleared', 'flagged', 'accepted', 'rejected']) {
  test(`R4 ${state} content integrity binds amount and date`, () => {
    const good = built(state);
    for (const [name, core] of cores) {
      const valid = core.finance.supplierCredits.decodeSupplierCredits(view(good), bind);
      assert.equal(valid.state, 'present', `${name} clean ${state}`);
      for (const [field, value] of [['amount', '999'], ['issueDate', '2026-09-01']]) {
        const bad = clone(good);
        bad.records[cid(1)][field] = value;
        const decoded = core.finance.supplierCredits.decodeSupplierCredits(view(bad), bind);
        failsClosed(decoded, `${name} ${state} ${field}`);
      }
    }
  });
  test(`R4 ${state} required intentDigest rejects bogus, missing and malformed evidence`, () => {
    const good = built(state);
    for (const [label, change] of [
      ['bogus', r => { r.intentDigest = 'f'.repeat(64); }],
      ['missing', r => { delete r.intentDigest; }],
      ['malformed', r => { r.intentDigest = 'not-a-digest'; }],
    ]) {
      const bad = clone(good);
      change(bad.review[oid(1)]);
      for (const [name, core] of cores) {
        const decoded = core.finance.supplierCredits.decodeSupplierCredits(view(bad), bind);
        failsClosed(decoded, `${name} ${state} ${label}`);
      }
    }
  });
}

test('R4 decision audit targetOperationId is the review entry key', () => {
  for (const state of ['accepted', 'rejected']) {
    const bad = built(state);
    bad.review[oid(1)].decisionAudit.targetOperationId = oid(2);
    for (const [name, core] of cores)
      assert.equal(core.finance.supplierCredits.decodeSupplierCredits(view(bad), bind).state, 'unreadable', name);
  }
});

test('R4 canonical JSON preserves complete nested content, types and array order', () => {
  const a = { z: [{ k: 'v', nested: { b: 2, a: 1 } }], a: { y: true, x: '1' } };
  const b = { a: { x: '1', y: true }, z: [{ nested: { a: 1, b: 2 }, k: 'v' }] };
  assert.notEqual(JSON.stringify(a), JSON.stringify(b));
  assert.equal(canonicalCreditJson(a), canonicalCreditJson(b));
  for (const changed of [
    { ...b, a: { x: 1, y: true } },
    { ...b, z: [{ nested: { a: 1, b: 3 }, k: 'v' }] },
    { ...b, z: [...b.z, 'extra'] },
    { ...b, z: ['extra', ...b.z] },
  ]) assert.notEqual(canonicalCreditJson(a), canonicalCreditJson(changed));
});

test('R4 lost acknowledgement refuses a committed but different complete review payload', async () => {
  const pending = built('pending');
  const db = memoryDb();
  db.put(NODE, pending);
  db.afterTransaction = (path, store) => {
    if (path !== NODE) return;
    const changed = store.read(NODE);
    changed.review[oid(1)].resolvedAt += 1;
    store.put(NODE, changed);
    throw Error('ack lost after commit');
  };
  const rv = pending.review[oid(1)];
  const out = await Repo.transitionReview({ ...bind, operationId: oid(1), intentDigest: rv.intentDigest, to: 'cleared', resolution: 'post_commit_authorized', now: 1020 }, db);
  assert.equal(out.status, 'outcome_unknown', JSON.stringify(out));
  assert.equal(db.read(NODE).review[oid(1)].state, 'cleared');
});

test('R4 altered cleared amount and date cannot yield complete-looking purchases or Food Cost', () => {
  const monthEntries = (month, days) => Array.from({ length: days }, (_, i) => entry(uid(i + 1), `2026-${month}-${String(i + 1).padStart(2, '0')}`, { sales: '1000', supplier_payments: { s1: '300' }, payroll: '100' }));
  for (const [field, value, month, days] of [['amount', '999', '10', 31], ['issueDate', '2026-09-01', '09', 30]]) {
    const bad = built('cleared');
    bad.records[cid(1)][field] = value;
    for (const [name, core] of cores) {
      const decoded = core.product.decodeSupplierCredits(view(bad), bind);
      const report = core.product.productMonthReport({ ...inputs(monthEntries(month, days), { asOf: `2026-${String(Number(month) + 1).padStart(2, '0')}-01` }), supplierCredits: decoded }, { kind: 'closed_month', month: `2026-${month}` });
      assert.equal(report.actual.purchases.complete, false, `${name} ${field} purchases`);
      assert.equal(report.actual.purchases.credits.value, null, `${name} ${field} credits`);
      assert.equal(report.actual.purchasesPct.state, 'invalid_components', `${name} ${field} Food Cost`);
    }
  }
});
