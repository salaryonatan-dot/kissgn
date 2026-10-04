// These tests are intentionally runnable against rejected R2 with only this file and the API
// harness overlaid: they must fail on its production code, without missing-module false reds.
import {test} from 'node:test';import assert from 'node:assert/strict';
import * as SC from '../../lib/supplierCredits.js';
import {loadCommitted} from '../support/fincore-load.mjs';
import {creditNode,spec,oid,cid} from '../support/p1-credit-fixtures.mjs';
import {apiHarness,createBody} from '../support/p1-r3-api-harness.mjs';
const C=(await loadCommitted()).finance.supplierCredits,bind={tenantId:'tenantA',bizId:'bizA'};
function acceptance(){const n=creditNode([spec(1,'s1','2026-10-01','10',{review:'flagged'})]);const c={action:'review_accept',...bind,operationId:oid(90),targetOperationId:oid(1),intentDigest:n.review[oid(1)].intentDigest,decision:'accept',actorUid:'own',actorRole:'owner',now:20000};c.requestHash=SC.requestHash(c);return SC.applyCreditOperation(n,c).node;}
test('R3 RED F1 acceptance stores cleared with accepted audit, and canonical reader accepts it',()=>{const n=acceptance();assert.equal(n.review[oid(1)].state,'cleared');assert.equal(n.review[oid(1)].decisionAudit.decision,'accepted');assert.equal(C.decodeSupplierCredits(SC.safeNodeView(n),bind).credits.length,1)});
test('R3 RED F3 old supplier case switch cannot change hard document identity',()=>{assert.equal(C.normalizeDocumentNumber('CR-001',true).key,C.normalizeDocumentNumber('cr-001',false).key)});
test('R3 RED numeric audit operation ID is invalid',()=>{const n=acceptance();n.review[oid(1)].decisionAudit.operationId=12345678;if('decisionOperationId'in n.review[oid(1)])n.review[oid(1)].decisionOperationId=12345678;assert.equal(C.decodeSupplierCredits(SC.safeNodeView(n),bind).state,'unreadable')});
for(const action of ['create-supplier-credit','list-supplier-credits','void-supplier-credit','replace-supplier-credit','decide-supplier-credit-review','reconcile-supplier-credit-reviews'])test('R3 RED F2 '+action+' denies unregistered business',async()=>{const h=await apiHarness();const r=await h.call(action,createBody(1,{bizId:'ghost',newCreditId:cid(2),expectedSeq:1,targetOperationId:oid(1),intentDigest:'a'.repeat(64),decision:'accept'}),'own',action.startsWith('list')?'GET':'POST');assert.equal(r.code,403);assert.equal(r.body.error,'business_not_in_tenant')});
