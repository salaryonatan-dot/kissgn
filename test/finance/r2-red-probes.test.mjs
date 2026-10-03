import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeDb } from '../../tools/storage-v2/reader-sandbox.mjs';
import { loadWriter } from '../support/f1-writer-harness.mjs';
import { REPO } from '../support/fincore-load.mjs';

const W = await loadWriter(REPO);
const T = 'tenantA', B = 'bizA', A = '00000000-0000-4000-8000-0000000000a1';
const NODE = `tenants/${T}/biz:${B}:cost_history`;
const NOW = Date.parse('2026-10-02T09:00:00Z');
const body = { versionId:A, expectedHead:null, effectiveFrom:'2026-10-02', basis:'recorded', globalEmployees:[], fixedItems:[{ itemKey:'f1', monthlyAmount:'3100' }], rent:{ mode:'none' }, royalty:{ mode:'none' } };
function setup() {
  const db = makeDb();
  for (const [uid,role] of [['u_mgr','manager'],['u_super','super_owner']]) {
    db.seed(`tenants/${T}/members/${uid}`, true);
    db.seed(`tenants/${T}/roles/${uid}`, role);
    db.seed(`tenants/${T}/biz_access/${B}/${uid}`, true);
  }
  db.seed(`tenants/${T}/app/business`, { _v: JSON.stringify([{ id: B, name: "A" }]) });   // R3: business registry
  globalThis.__DB = db;
  globalThis.__CLAIMS = { uid:'u_mgr', email:'m@x' };
  const orig = db.ref;
  let committed = false;
  db.ref = (p) => {
    const ref = orig(p);
    if (p === NODE) return { ...ref, transaction: async (...args) => {
      const out = await ref.transaction(...args);
      if (out.committed && !committed) { committed = true; db.seed(`tenants/${T}/members/u_mgr`, false); }
      return out;
    }};
    return ref;
  };
  return db;
}

test('R2: failed atomic flag/audit transaction leaves pending', async () => {
  const db = setup();
  const base = db.ref;
  let transactions = 0;
  db.ref = (p) => p === NODE ? { ...base(p), transaction:async (...args) => {
    transactions++;
    if (transactions === 2) throw Error('flag transaction down');
    return base(p).transaction(...args);
  }} : base(p);
  const result = await W.createCostHistoryWriter({ db, clock:()=>NOW }).saveCostVersion({headers:{}}, {tenantId:T,bizId:B,body});
  const before = db.read(NODE);
  console.log('AUDIT_FAILURE', JSON.stringify({result, review:before.review[A], flag:db.read(`tenants/${T}/audit/cost_history_flags/${A}`)}));
  assert.equal(result.review, 'pending');
  assert.equal(before.review[A].state, 'pending');
});

test('R2: super_owner cannot accept a flagged cost version', async () => {
  const db = setup();
  const writer = W.createCostHistoryWriter({ db, clock:()=>NOW });
  const result = await writer.saveCostVersion({headers:{}}, {tenantId:T,bizId:B,body});
  const before = db.read(NODE);
  assert.equal(before.review[A].state, 'flagged');
  globalThis.__CLAIMS = { uid:'u_super', email:'s@x' };
  const accept = await writer.acknowledgeFlaggedVersion({headers:{}}, {tenantId:T,bizId:B,versionId:A,intentDigest:before.review[A].intentDigest,operationId:'00000000-0000-4000-8000-0000000000aa'});
  const after = db.read(NODE);
  console.log('SUPER_OWNER', JSON.stringify({result, before:before.review[A], accept, after:after.review[A]}));
  assert.equal(accept.status, 'role_not_allowed');
  assert.equal(after.review[A].state, 'flagged');
});
