// P1 R2 owner contract: distinct hard identity, audited similarity, atomic review and strict readers.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import * as SC from '../../lib/supplierCredits.js';
import { loadCommitted } from '../support/fincore-load.mjs';
import { cid, oid, spec, creditNode, mutate, view } from '../support/p1-credit-fixtures.mjs';

const CORE = (await loadCommitted()).finance.supplierCredits;
const T = 'tenantA', B = 'bizA';
const command = (n, number, extra = {}) => {
  const c = { action:'create', tenantId:T, bizId:B, creditId:cid(n), operationId:oid(n),
    input:SC.validateCreditInput({supplierId:'s1', issueDate:'2026-10-01', amount:'10', documentNumber:number}),
    actorUid:'mgr', actorRole:'manager', now:1000+n, ...extra };
  c.requestHash = SC.requestHash(c);
  return c;
};
const run = (node, cmd) => SC.applyCreditOperation(node, cmd);
const clear = (node, op) => SC.applyReviewTransition(node, {tenantId:T,bizId:B,operationId:op,
  intentDigest:node.review[op].intentDigest,to:'cleared',resolution:'post_commit_authorized',now:3000}).node;

test('P1R2-D01 exact hard duplicate cannot be bypassed; separator similarity needs explicit matching audit', () => {
  const first = clear(run(null, command(1,'CR001')).node,oid(1));
  assert.equal(run(first,command(2,'cr001')).code,'duplicate_document');
  const warning = run(first,command(2,'CR-001'));
  assert.deepEqual([warning.code,warning.detail],["similar_document",{confirmedAgainst:[cid(1)]}]);
  const confirm = {confirmed:true,confirmedAgainst:[cid(1)],reason:'Different supplier document verified'};
  const accepted = run(first,command(2,'CR-001',{similarityConfirmation:confirm}));
  assert.equal(accepted.outcome,'applied');
  assert.deepEqual(accepted.node.records[cid(2)].similarityConfirmation,{fingerprint:'cr001',confirmedAgainst:[cid(1)],reason:confirm.reason,by:'mgr',at:1002});
  assert.deepEqual(CORE.decodeSupplierCredits(view(accepted.node),{tenantId:T,bizId:B}).issues.map(x=>x.code),['review_pending']);
  assert.equal(run(accepted.node,command(3,'cr-001',{similarityConfirmation:confirm})).code,'duplicate_document');
  assert.equal(run(first,command(2,'CR-001',{similarityConfirmation:{...confirm,confirmedAgainst:[]}})).code,'similar_document');
  assert.equal(run(first,command(2,'CR-001',{similarityConfirmation:{...confirm,reason:'other'}})).outcome,'applied');
});

test('P1R2-D02 separator positions remain distinct; similar document confirmation cannot create an orphan reservation', () => {
  const first=clear(run(null,command(1,'12-3')).node,oid(1));
  assert.notEqual(SC.normalizeDocumentNumber('12-3').key,SC.normalizeDocumentNumber('1-23').key);
  const before=JSON.stringify(first);
  assert.equal(run(first,command(2,'1-23')).code,'similar_document');
  assert.equal(JSON.stringify(first),before);
  const confirm={confirmed:true,confirmedAgainst:[cid(1)],reason:'Separate source document'};
  const accepted=run(first,command(2,'1-23',{similarityConfirmation:confirm}));
  assert.equal(accepted.outcome,'applied');
  assert.equal(Object.keys(accepted.node.documents.s_s1).length,2);
  assert.equal(run(accepted.node,command(3,'1-23')).code,'duplicate_document');
});

test('P1R2-R01 flag and exact audit share one transaction value; malformed pair is unreadable', () => {
  const pending=run(null,command(1,'CR-1')).node;
  const digest=pending.review[oid(1)].intentDigest;
  const flag=SC.applyReviewTransition(pending,{tenantId:T,bizId:B,operationId:oid(1),intentDigest:digest,to:'flagged',resolution:'revoked_during_commit',now:2000});
  assert.equal(flag.o,'applied');
  assert.equal(flag.node.review[oid(1)].state,'flagged');
  assert.equal(flag.node.review[oid(1)].flagAudit.operationId,oid(1));
  assert.equal(pending.review[oid(1)].state,'pending');
  for(const broken of [
    mutate(flag.node,n=>{delete n.review[oid(1)].flagAudit}),
    mutate(flag.node,n=>{n.review[oid(1)].flagAudit.operationId=oid(2)}),
    mutate(flag.node,n=>{n.review[oid(1)].flagAudit.outcome='wrong'}),
  ]) assert.deepEqual(CORE.decodeSupplierCredits(view(broken),{tenantId:T,bizId:B}),{state:'unreadable',reason:'invalid_review_audit'});
  assert.equal(SC.applyReviewTransition(flag.node,{tenantId:T,bizId:B,operationId:oid(1),intentDigest:digest,to:'flagged',resolution:'revoked_during_commit',now:2001}).o,'already_flagged');
});

test('P1R2-R02 only owner can accept; decision audit is atomic and malformed decisions unreadable', () => {
  const pending=run(null,command(1,'CR-1')).node;
  const digest=pending.review[oid(1)].intentDigest;
  const flagged=SC.applyReviewTransition(pending,{tenantId:T,bizId:B,operationId:oid(1),intentDigest:digest,to:'flagged',resolution:'revoked_during_commit',now:2000}).node;
  const decide=(role)=>{const c={action:'review_accept',tenantId:T,bizId:B,targetOperationId:oid(1),intentDigest:digest,decision:'accept',operationId:oid(3),actorUid:'owner1',actorRole:role,now:3000};c.requestHash=SC.requestHash(c);return run(flagged,c)};
  for(const role of ['super_owner','manager','viewer']) assert.equal(decide(role).code,'role_not_allowed');
  const accepted=decide('owner');
  assert.equal(accepted.outcome,'applied');
  assert.equal(accepted.node.review[oid(1)].decisionAudit.operationId,oid(3));
  assert.equal(flagged.review[oid(1)].state,'flagged');
  assert.equal(CORE.decodeSupplierCredits(view(accepted.node),{tenantId:T,bizId:B}).issues.length,0);
  const broken=mutate(accepted.node,n=>{n.review[oid(1)].decisionAudit.by='other'});
  assert.deepEqual(CORE.decodeSupplierCredits(view(broken),{tenantId:T,bizId:B}),{state:'unreadable',reason:'invalid_review_audit'});
});
