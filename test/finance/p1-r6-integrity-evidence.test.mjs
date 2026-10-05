import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bothCores } from '../support/fincore-load.mjs';
import { compileServer } from '../support/server-reader-harness.mjs';
import { entry, inputs, uid } from '../support/b1-fixtures.mjs';
import { creditNode, spec, clone, view, cid, oid, T, B } from '../support/p1-credit-fixtures.mjs';

const cores = await bothCores();
const server = await compileServer().import('src/policy/productFinance.js');
const engines = [['server', server], ...cores.map(([name, core]) => [name, core.product])];
const bind = { tenantId: T, bizId: B };
const rows = (year, month) => Array.from({ length: new Date(Date.UTC(+year, +month, 0)).getUTCDate() }, (_, i) =>
  entry(uid(i + 1), `${year}-${month}-${String(i + 1).padStart(2, '0')}`, { sales: '1000', supplier_payments: { s1: '300' }, payroll: '100' }));
const sample = (state = 'cleared', date = '2026-10-15') => creditNode([spec(1, 's1', date, '100', { review: state })]);
function report(core, node, month, context = bind) {
  const [year, m] = month.split('-');
  const next = +m === 12 ? `${+year + 1}-01-01` : `${year}-${String(+m + 1).padStart(2, '0')}-01`;
  const decoded = core.decodeSupplierCredits(node === null ? null : view(node), context);
  const result = core.productMonthReport({ ...inputs(rows(year, m), { asOf: next }), supplierCredits: decoded }, { kind: 'closed_month', month });
  return { decoded, purchases: result.actual.purchases, foodCost: result.actual.purchasesPct };
}
function invalid(r, label, partial = null) {
  assert.equal(r.purchases.complete, false, `${label}: purchases incomplete`);
  assert.equal(r.foodCost.state, 'invalid_components', `${label}: Food Cost unavailable`);
  assert.equal('value' in r.foodCost, false, `${label}: no Food Cost percentage`);
  assert.equal(r.purchases.credits.invalidDates.length, rows(...labelMonth(label)).length, `${label}: all dates invalid`);
  if (partial === null) assert.equal(r.purchases.credits.value, null, `${label}: no zero substitution`);
  else assert.equal(r.purchases.credits.value, partial, `${label}: valid credit remains visible`);
}
function labelMonth(label) { const m = / (\d{4})-(\d{2})$/.exec(label); assert.ok(m, label); return [m[1], m[2]]; }

test('R6 N-1b missing review entry or section never trusts the stored date, in every lifecycle state and three engines', () => {
  const moves = [
    ['2026-10-15', '2026-10-15'],
    ['2026-10-15', '2026-09-15'],
    ['2026-10-15', '2026-11-15'],
    ['2026-10-15', '2025-12-15'],
    ['2026-10-15', '2027-01-15'],
    ['2026-10-15', '2032-03-15'],
  ];
  for (const state of ['pending', 'cleared', 'flagged', 'accepted', 'rejected'])
    for (const removal of ['entry', 'section']) for (const [source, destination] of moves) {
      const bad = clone(sample(state, source));
      if (removal === 'entry') delete bad.review[oid(1)];
      else delete bad.review;
      bad.records[cid(1)].issueDate = destination;
      for (const [engine, core] of engines) {
        const decoded = core.decodeSupplierCredits(view(bad), bind);
        assert.ok(decoded.state === 'unreadable' || decoded.issues.some(i => i.dates.length === 0), `${engine} ${state} ${removal}: date is untrusted`);
        for (const month of new Set([source.slice(0, 7), destination.slice(0, 7), '2028-04']))
          invalid(report(core, bad, month), `${engine} ${state} ${removal} ${source}→${destination} ${month}`);
      }
    }
});

test('R6 N-1b absent, null, malformed and mismatched review evidence fails closed without date attribution', () => {
  const variants = [
    ['entry absent', n => { delete n.review[oid(1)]; }],
    ['section absent', n => { delete n.review; }],
    ['section empty', n => { n.review = {}; }],
    ['section null', n => { n.review = null; }],
    ['section scalar', n => { n.review = 'missing'; }],
    ['entry null', n => { n.review[oid(1)] = null; }],
    ['entry array', n => { n.review[oid(1)] = []; }],
    ['entry scalar', n => { n.review[oid(1)] = 7; }],
    ['entry object empty', n => { n.review[oid(1)] = {}; }],
    ['digest absent', n => { delete n.review[oid(1)].intentDigest; }],
    ['digest null', n => { n.review[oid(1)].intentDigest = null; }],
    ['digest number', n => { n.review[oid(1)].intentDigest = 7; }],
    ['digest malformed', n => { n.review[oid(1)].intentDigest = 'no-digest'; }],
    ['digest mismatched', n => { n.review[oid(1)].intentDigest = '0'.repeat(64); }],
    ['content mismatched', n => { n.records[cid(1)].amount = '999'; }],
    ['wrong operation link', n => { n.records[cid(1)].operationId = oid(9); }],
  ];
  for (const [variant, mutate] of variants) {
    const bad = clone(sample()); mutate(bad); bad.records[cid(1)].issueDate = '2026-09-15';
    for (const [engine, core] of engines) for (const month of ['2026-10', '2026-09', '2028-04'])
      invalid(report(core, bad, month), `${engine} ${variant} ${month}`);
  }
});

test('R6 N-1b mixed valid and unverified records stay partial; empty and isolated valid nodes remain complete', () => {
  const mixed = creditNode([spec(1, 's1', '2026-10-15', '100'), spec(2, 's1', '2026-10-16', '40')]);
  const bad = clone(mixed); delete bad.review[oid(1)]; bad.records[cid(1)].issueDate = '2026-09-15';
  for (const [engine, core] of engines) {
    invalid(report(core, bad, '2026-10'), `${engine} mixed 2026-10`, '40');
    invalid(report(core, bad, '2026-09'), `${engine} mixed 2026-09`);
    invalid(report(core, bad, '2028-04'), `${engine} mixed 2028-04`);
    const valid = report(core, sample(), '2026-10');
    assert.equal(valid.decoded.state, 'present', `${engine}: valid review evidence`);
    assert.equal(valid.purchases.complete, true, `${engine}: valid purchases`);
    assert.equal(valid.purchases.value, '9200', `${engine}: correct net purchases`);
    assert.equal(valid.foodCost.state, 'value', `${engine}: valid Food Cost percentage`);
    assert.equal(valid.foodCost.value, '920/31', `${engine}: valid Food Cost percentage`);
    const empty = report(core, null, '2026-10');
    assert.equal(empty.decoded.state, 'absent', `${engine}: empty valid dataset`);
    assert.equal(empty.purchases.complete, true, `${engine}: empty dataset purchases`);
    assert.equal(empty.foodCost.state, 'value', `${engine}: empty dataset Food Cost`);
    const business = creditNode([spec(9, 's1', '2026-10-20', '20')], { bizId: 'bizB' });
    const tenant = creditNode([spec(10, 's1', '2026-10-20', '30')], { tenantId: 'tenantB' });
    for (const [other, context] of [[business, { tenantId: T, bizId: 'bizB' }], [tenant, { tenantId: 'tenantB', bizId: B }]]) {
      const r = report(core, other, '2026-10', context);
      assert.equal(r.purchases.complete, true, `${engine}: unrelated scope complete`);
      assert.equal(r.foodCost.state, 'value', `${engine}: unrelated Food Cost complete`);
    }
  }
});

test('R6 an unverified void digest cannot make another month look complete', () => {
  const good = creditNode([spec(1, 's1', '2026-10-15', '100', { voided: true })]);
  const bad = clone(good); bad.review[oid(5001)].intentDigest = '0'.repeat(64);
  for (const [engine, core] of engines) {
    const clean = report(core, good, '2026-10');
    assert.equal(clean.purchases.complete, true, `${engine}: verified void is complete`);
    assert.equal(clean.foodCost.state, 'value', `${engine}: verified void has Food Cost`);
    for (const month of ['2026-10', '2026-11', '2027-04'])
      invalid(report(core, bad, month), `${engine} invalid void digest ${month}`);
  }
});
