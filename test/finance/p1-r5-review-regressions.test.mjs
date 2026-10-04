import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bothCores } from '../support/fincore-load.mjs';
import { compileServer } from '../support/server-reader-harness.mjs';
import { entry, inputs, uid } from '../support/b1-fixtures.mjs';
import { creditNode, spec, clone, view, cid, oid, T, B } from '../support/p1-credit-fixtures.mjs';
import * as Writer from '../../lib/supplierCredits.js';
import * as Repo from '../../lib/repositories/supplierCreditsRepo.js';
import { memoryDb, NODE } from '../support/p1-r3-api-harness.mjs';

const cores = await bothCores();
const server = await compileServer().import('src/policy/productFinance.js');
const engines = [['server', server], ...cores.map(([name, core]) => [name, core.product])];
const bind = { tenantId: T, bizId: B };
const monthRows = (year, month) => Array.from({ length: new Date(Date.UTC(Number(year), Number(month), 0)).getUTCDate() }, (_, i) =>
  entry(uid(i + 1), `${year}-${month}-${String(i + 1).padStart(2, '0')}`, { sales: '1000', supplier_payments: { s1: '300' }, payroll: '100' }));
function report(core, node, year, month) {
  const decoded = core.decodeSupplierCredits(view(node), bind);
  const next = Number(month) === 12 ? `${Number(year) + 1}-01-01` : `${year}-${String(Number(month) + 1).padStart(2, '0')}-01`;
  const result = core.productMonthReport({ ...inputs(monthRows(year, month), { asOf: next }), supplierCredits: decoded }, { kind: 'closed_month', month: `${year}-${month}` });
  return { decoded, purchases: result.actual.purchases, foodCost: result.actual.purchasesPct };
}
const base = (state, date = '2026-10-05') => creditNode([spec(1, 's1', date, '100', { review: state })]);
function incomplete(r, label) {
  assert.equal(r.purchases.complete, false, `${label}: purchases`);
  assert.notEqual(r.foodCost.state, 'ok', `${label}: Food Cost`);
  assert.equal(r.purchases.credits.value, null, `${label}: credits cannot become zero`);
}

test('R5 N-1 cleared and pending date tampering makes source and destination months incomplete on all three engines', () => {
  for (const state of ['cleared', 'pending']) for (const [source, dest] of [
    ['2026-10-05', '2026-09-05'],
    ['2026-12-05', '2027-01-05'],
    ['2026-10-05', '2025-01-05'],
  ]) {
    const good = base(state, source);
    const bad = clone(good); bad.records[cid(1)].issueDate = dest;
    for (const [name, core] of engines) {
      for (const [date, kind] of [[source, 'source'], [dest, 'destination']]) {
        const [year, month] = date.split('-');
        incomplete(report(core, bad, year, month), `${name} ${state} ${source}→${dest} ${kind}`);
      }
      const unrelatedPeriod = report(core, bad, '2028', '03');
      incomplete(unrelatedPeriod, `${name} ${state} outside selected period`);
    }
  }
});

test('R5 N-1 all review states and all digest-bound content fields have unattributable integrity failures', () => {
  for (const state of ['pending', 'cleared', 'flagged', 'accepted', 'rejected']) for (const [field, value] of [
    ['amount', '999'], ['issueDate', '2026-09-05'], ['supplierId', 's2'], ['note', 'altered'], ['documentNumber', 'OTHER-1'],
  ]) {
    const bad = clone(base(state)); bad.records[cid(1)][field] = value;
    for (const [name, core] of engines) {
      const original = report(core, bad, '2026', '10');
      incomplete(original, `${name} ${state} ${field} source`);
      if (field === 'issueDate') incomplete(report(core, bad, '2026', '09'), `${name} ${state} ${field} destination`);
      assert.ok(original.decoded.state === 'unreadable' || original.decoded.issues.some(i => i.dates.length === 0 && i.code !== 'review_pending' && i.code !== 'review_flagged'), `${name} ${state} ${field}: unverified date cannot attribute issue`);
    }
  }
});

test('R5 N-1 context transplants fail closed while a separate business valid node remains complete', () => {
  const good = base('cleared');
  for (const [label, mutate, target] of [
    ['business', n => { n.bizId = 'bizB'; n.records[cid(1)].bizId = 'bizB'; }, { tenantId: T, bizId: 'bizB' }],
    ['tenant', n => { n.tenantId = 'tenantB'; n.records[cid(1)].tenantId = 'tenantB'; }, { tenantId: 'tenantB', bizId: B }],
  ]) {
    const bad = clone(good); mutate(bad);
    for (const [name, core] of engines) {
      const d = core.decodeSupplierCredits(view(bad), target);
      assert.ok(d.state === 'unreadable' || d.issues.some(i => i.dates.length === 0), `${name} ${label}`);
      assert.equal(core.decodeSupplierCredits(view(good), bind).state, 'present', `${name} original business stays valid`);
    }
  }
});

test('R5 N-1 valid dates and decided review states keep their established accounting', () => {
  for (const state of ['cleared', 'pending', 'flagged', 'accepted', 'rejected']) for (const [name, core] of engines) {
    const source = report(core, base(state), '2026', '10');
    assert.equal(source.purchases.complete, state === 'cleared' || state === 'accepted' || state === 'rejected', `${name} ${state} clean source`);
    assert.equal(source.decoded.state, 'present', `${name} ${state} clean decode`);
    const unrelated = report(core, base(state), '2026', '09');
    assert.equal(unrelated.purchases.complete, true, `${name} ${state} clean unrelated month`);
  }
});

test('R5 N-2 Unicode recomposition preserves one global document identity through repository writes', async () => {
  for (const [first, twin] of [['H\u0331-1', '\u1e96-1'], ['J\u030c-7', '\u01f0-7']]) {
    const command = (n, documentNumber) => {
      const c = { action: 'create', tenantId: T, bizId: B, creditId: cid(n), operationId: oid(n), input: Writer.validateCreditInput({ supplierId: 's1', issueDate: '2026-10-05', amount: '10', documentNumber }), actorUid: 'u1', actorRole: 'manager', now: 2000 + n };
      c.requestHash = Writer.requestHash(c); return c;
    };
    const one = Writer.applyCreditOperation(null, command(1, first));
    assert.equal(one.outcome, 'applied', first);
    const two = Writer.applyCreditOperation(one.node, command(2, twin));
    assert.equal(two.outcome, 'conflict', `${first}/${twin}`);
    assert.equal(two.code, 'duplicate_document', `${first}/${twin}`);
    assert.equal(Object.keys(one.node.documents.s_s1).length, 1);
    const db = memoryDb();
    const persistedFirst = await Repo.runSupplierCreditTxn(command(1, first), db);
    const persistedTwin = await Repo.runSupplierCreditTxn(command(2, twin), db);
    assert.equal(persistedFirst.outcome, 'applied', first);
    assert.deepEqual([persistedTwin.outcome, persistedTwin.code], ['conflict', 'duplicate_document'], `${first}/${twin}`);
    assert.equal(Object.keys(db.read(NODE).documents.s_s1).length, 1, 'one durable reservation');
    for (const [name, core] of cores) assert.equal(core.finance.supplierCredits.normalizeDocumentNumber(first).key, core.finance.supplierCredits.normalizeDocumentNumber(twin).key, name);
  }
});

test('R5 N-3 a matching clear by another call is not confirmation when this callback never ran', async () => {
  const pending = base('pending');
  const committed = Writer.applyReviewTransition(pending, { ...bind, operationId: oid(1), intentDigest: pending.review[oid(1)].intentDigest, to: 'cleared', resolution: 'post_commit_authorized', now: 3000 });
  assert.equal(committed.o, 'applied');
  const db = memoryDb(); db.put(NODE, committed.node);
  const ref = db.ref;
  db.ref = path => ({ ...ref(path), transaction: async () => { throw Error('disconnected before callback'); } });
  const out = await Repo.transitionReview({ ...bind, operationId: oid(1), intentDigest: pending.review[oid(1)].intentDigest, to: 'cleared', resolution: 'post_commit_authorized', now: 3000 }, db);
  assert.equal(out.status, 'outcome_unknown');
  assert.equal(db.read(NODE).review[oid(1)].state, 'cleared');
});

test('R5 N-3 matching readback entry cannot confirm a non-strict node', async () => {
  for (const changedCredit of [1, 2]) {
    const node = creditNode([spec(1, 's1', '2026-10-05', '100', { review: 'pending' }), spec(2, 's1', '2026-10-06', '20')]);
    const db = memoryDb(); db.put(NODE, node);
    db.afterTransaction = (path, store) => {
      const changed = store.read(path); changed.records[cid(changedCredit)].amount = '999'; store.put(path, changed);
      throw Error('ack lost after commit');
    };
    const out = await Repo.transitionReview({ ...bind, operationId: oid(1), intentDigest: node.review[oid(1)].intentDigest, to: 'cleared', resolution: 'post_commit_authorized', now: 3000 }, db);
    assert.equal(db.read(NODE).review[oid(1)].state, 'cleared');
    assert.equal(out.status, 'outcome_unknown', `tampered credit ${changedCredit}: ${JSON.stringify(out)}`);
  }
});
