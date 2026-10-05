import { test } from 'node:test';
import assert from 'node:assert/strict';
import { bothCores } from '../support/fincore-load.mjs';
import { compileServer } from '../support/server-reader-harness.mjs';
import { entry, inputs, uid } from '../support/b1-fixtures.mjs';
import { creditNode, spec, replaceIn, voidIn, mutate, view, cid, oid, T, B } from '../support/p1-credit-fixtures.mjs';

const server = await compileServer().import('src/policy/productFinance.js');
const engines = [['server', server], ...(await bothCores()).map(([name, core]) => [name, core.product])];
const bind = { tenantId: T, bizId: B };
const monthRows = (month) => {
  const [year, m] = month.split('-').map(Number);
  return Array.from({ length: new Date(Date.UTC(year, m, 0)).getUTCDate() }, (_, i) =>
    entry(uid(i + 1), `${month}-${String(i + 1).padStart(2, '0')}`, { sales: '1000', supplier_payments: { s1: '300' }, payroll: '100' }));
};
function report(core, node, month, context = bind) {
  const [year, m] = month.split('-').map(Number);
  const next = m === 12 ? `${year + 1}-01-01` : `${year}-${String(m + 1).padStart(2, '0')}-01`;
  const decoded = core.decodeSupplierCredits(node === null ? null : view(node), context);
  const actual = core.productMonthReport({ ...inputs(monthRows(month), { asOf: next }), supplierCredits: decoded }, { kind: 'closed_month', month }).actual;
  return { decoded, purchases: actual.purchases, foodCost: actual.purchasesPct };
}
function incomplete(r, label, validCredit = null) {
  assert.equal(r.purchases.complete, false, `${label}: purchases must be incomplete`);
  assert.equal(r.foodCost.state, 'invalid_components', `${label}: Food Cost must be unavailable`);
  assert.equal('value' in r.foodCost, false, `${label}: no final percentage`);
  assert.equal(r.purchases.credits.value, validCredit, `${label}: no fabricated credit or zero`);
  if (r.decoded.state === 'present') assert.ok(r.decoded.issues.some(i => i.dates.length === 0), `${label}: untrusted chain dates`);
}
const base = (date, state = 'cleared') => replaceIn(creditNode([spec(1, 's1', '2026-10-15', '100')]), 1, 2, { issueDate: date, amount: '110' }, { review: state });
const cases = [
  ['C1 successor record + review missing', n => { delete n.records[cid(2)]; delete n.review[oid(2)]; }],
  ['C2 successor, review and event missing', n => { delete n.records[cid(2)]; delete n.review[oid(2)]; delete n.voids[oid(2)]; }],
  ['C3 head re-pointed with old sequence', n => { delete n.records[cid(2)]; delete n.review[oid(2)]; delete n.voids[oid(2)]; n.heads[cid(1)] = { creditId: cid(1), seq: 2 }; }],
  ['C4 head deleted', n => { delete n.records[cid(2)]; delete n.review[oid(2)]; delete n.voids[oid(2)]; delete n.heads[cid(1)]; }],
  ['C6 root record + review missing', n => { delete n.records[cid(1)]; delete n.review[oid(1)]; }],
];

test('R7 N-1c C1-C4/C6: month and year moves, cleared and pending, fail closed across three engines', () => {
  for (const [destination, state] of [['2026-09-15', 'cleared'], ['2025-12-15', 'cleared'], ['2027-01-15', 'cleared'], ['2026-09-15', 'pending'], ['2025-12-15', 'pending'], ['2027-01-15', 'pending']]) {
    const source = base(destination, state);
    for (const [caseId, change] of cases) {
      const bad = mutate(source, change);
      for (const [engine, core] of engines)
        for (const month of new Set(['2026-10', destination.slice(0, 7), '2028-04']))
          incomplete(report(core, bad, month), `${engine} ${caseId} ${state} ${month}`);
    }
  }
});

test('R7 N-1c C7 reservation left after identity-correction successor rollback; C8 middle-op control', () => {
  const correction = replaceIn(creditNode([spec(1, 's1', '2026-10-15', '100')]), 1, 2,
    { issueDate: '2026-09-15', documentNumber: 'CR-77' }, { identityCorrection: true });
  const c7 = mutate(correction, n => { delete n.records[cid(2)]; delete n.review[oid(2)]; delete n.voids[oid(2)]; n.heads[cid(1)] = { creditId: cid(1), seq: 1 }; });
  const three = replaceIn(base('2026-09-15'), 2, 3, { amount: '120' }, { now: 950000 });
  const c8 = mutate(three, n => { delete n.records[cid(2)]; delete n.review[oid(2)]; delete n.voids[oid(2)]; });
  for (const [engine, core] of engines) for (const [caseId, node] of [['C7', c7], ['C8', c8]])
    for (const month of ['2026-09', '2026-10', '2028-04']) incomplete(report(core, node, month), `${engine} ${caseId} ${month}`);
});

const guardCases = [
  ['a record review', () => mutate(base('2026-09-15'), n => { delete n.review[oid(1)]; })],
  ['b event review', () => mutate(voidIn(creditNode([spec(1, 's1', '2026-10-15', '100')]), 1), n => { delete n.review[oid(7001)]; })],
  ['c referenced record', () => mutate(replaceIn(creditNode([spec(1, 's1', '2026-10-15', '100')]), 1, 2,
    { issueDate: '2026-09-15', documentNumber: 'CR-77' }, { identityCorrection: true }), n => {
    delete n.records[cid(2)]; delete n.review[oid(2)]; delete n.voids[oid(2)];
    n.heads[cid(1)] = { creditId: cid(1), seq: 1 }; // only the reservation still references c2
  })],
  ['d head sequence', () => mutate(base('2026-09-15'), n => { n.heads[cid(1)].seq = 7; })],
  ['d missing head', () => mutate(base('2026-09-15'), n => { delete n.heads[cid(1)]; })],
];
for (const [condition, make] of guardCases) test(`R7 completeness guard ${condition}`, () => {
  const node = make();
  for (const [engine, core] of engines) for (const month of ['2026-09', '2026-10', '2028-04'])
    incomplete(report(core, node, month), `${engine} ${condition} ${month}`);
});

test('R7 malformed root review and missing later record review cannot authenticate lineage dates', () => {
  const root = mutate(creditNode([spec(1, 's1', '2026-10-15', '100')]), n => {
    n.review[oid(1)].schema = 'MARJIN_CREDITR/2';
  });
  const successor = mutate(base('2026-09-15'), n => {
    delete n.voids[oid(2)]; // (b) has no event to scan; (c) and (d) still hold
    n.review[oid(2)].schema = 'MARJIN_CREDITR/2';
  });
  const later = mutate(base('2026-09-15'), n => {
    n.records[cid(3)] = { ...n.records[cid(2)], creditId: cid(3), operationId: oid(3), seq: 3, replacesCreditId: cid(2) };
    n.heads[cid(1)] = { creditId: cid(3), seq: 3 }; // surviving event review still verifies op2
  });
  for (const [engine, core] of engines)
    for (const [label, node] of [['malformed root review', root], ['malformed successor review', successor], ['missing later record review', later]])
      for (const month of ['2026-09', '2026-10', '2028-04'])
        incomplete(report(core, node, month), `${engine} ${label} ${month}`);
});

test('R7 valid writer chains, mixed lineages, empty data and tenant/business isolation stay correct', () => {
  const good = base('2026-09-15');
  const mixed = creditNode([spec(9, 's1', '2026-09-20', '40')]);
  const bad = mutate(base('2026-09-15'), n => { delete n.records[cid(2)]; delete n.review[oid(2)]; });
  for (const [engine, core] of engines) {
    const valid = report(core, good, '2026-09');
    assert.equal(valid.purchases.complete, true, `${engine}: clean replacement complete`);
    assert.equal(valid.purchases.credits.value, '110', `${engine}: successor counted once`);
    const empty = report(core, null, '2026-09');
    assert.equal(empty.purchases.complete, true, `${engine}: absent node complete`);
    const joined = mutate(bad, n => {
      for (const key of ['records', 'review', 'documents', 'heads']) Object.assign(n[key], mixed[key]);
    });
    incomplete(report(core, joined, '2026-09'), `${engine} mixed 2026-09`, '40');
    for (const [context, node] of [
      [{ tenantId: T, bizId: 'bizB' }, creditNode([spec(8, 's1', '2026-09-15', '30')], { bizId: 'bizB' })],
      [{ tenantId: 'tenantB', bizId: B }, creditNode([spec(7, 's1', '2026-09-15', '20')], { tenantId: 'tenantB' })],
    ]) assert.equal(report(core, node, '2026-09', context).purchases.complete, true, `${engine}: unrelated scope`);
  }
});

test('R7 the 22 valid writer-produced lineage shapes remain decodable with attributable review states', () => {
  const shapes = [];
  for (const state of ['pending', 'cleared', 'flagged', 'accepted', 'rejected']) {
    shapes.push([`create ${state}`, creditNode([spec(1, 's1', '2026-10-15', '100', { review: state })])]);
    shapes.push([`void ${state}`, voidIn(creditNode([spec(1, 's1', '2026-10-15', '100')]), 1, { review: state })]);
    shapes.push([`replace ${state}`, base('2026-09-15', state)]);
  }
  for (const state of ['cleared', 'pending', 'rejected']) shapes.push([`identity correction ${state}`,
    replaceIn(creditNode([spec(1, 's1', '2026-10-15', '100')]), 1, 2,
      { documentNumber: 'CR-77' }, { review: state, identityCorrection: true })]);
  const start = creditNode([spec(1, 's1', '2026-10-15', '100')]);
  const replaced = replaceIn(start, 1, 2, { issueDate: '2026-09-15' });
  shapes.push(['three operations', replaceIn(replaced, 2, 3, { amount: '120' }, { now: 950000 })]);
  shapes.push(['replace then void', voidIn(replaced, 2, { now: 950000 })]);
  shapes.push(['rejected replace then replace', replaceIn(replaceIn(start, 1, 2, { amount: '110' }, { review: 'rejected' }), 1, 3, { amount: '120' }, { now: 960000 })]);
  shapes.push(['voided create', creditNode([spec(1, 's1', '2026-10-15', '100', { voided: true })])]);
  assert.equal(shapes.length, 22);
  for (const [engine, core] of engines) for (const [label, node] of shapes) {
    const decoded = core.decodeSupplierCredits(view(node), bind);
    assert.equal(decoded.state, 'present', `${engine} ${label}`);
    assert.equal(decoded.logical.length, 1, `${engine} ${label}: lineage retained`);
    assert.ok(decoded.issues.every(i => ['review_pending', 'review_flagged'].includes(i.code) && i.dates.length > 0),
      `${engine} ${label}: no false integrity defect`);
  }
});

test('R7 a head reference to another lineage does not borrow that record or its dates', () => {
  const two = creditNode([spec(1, 's1', '2026-10-15', '100'), spec(9, 's1', '2026-09-20', '40')]);
  const bad = mutate(two, n => { n.heads[cid(1)].creditId = cid(9); });
  for (const [engine, core] of engines) for (const month of ['2026-09', '2026-10', '2028-04'])
    incomplete(report(core, bad, month), `${engine} foreign-lineage head ${month}`, month === '2026-09' ? '40' : null);
});
