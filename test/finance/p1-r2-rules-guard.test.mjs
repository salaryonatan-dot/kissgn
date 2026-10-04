// P1 R2 candidate Rules delta: legacy credit node remains readable but client writes are denied.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { authorizedLegacyCreditsDenialDelta, LEGACY_CREDITS_BRANCH, P1_CREDITS_DENIAL_BRANCH, P1_R2_RULES_BLOB } from '../support/rules-authorized-delta.mjs';
const parent='ce506449b0377632bd9ad2f2b4192954b1696af7';
const before=JSON.parse(execFileSync('git',['show',`${parent}:database.rules.json`],{encoding:'utf8'}));
const after=JSON.parse(readFileSync('database.rules.json'));
const clone=x=>structuredClone(x);
const dk=x=>x.rules.tenants['$tenantId']['$dataKey'];

test('P1R2-G01 the only semantic change is the exact legacy credits write branch; read and ancestor grants are unchanged',()=>{
  assert.deepEqual(authorizedLegacyCreditsDenialDelta(before,after),{ok:true});
  assert.equal(dk(before)['.write'].includes(LEGACY_CREDITS_BRANCH),true);
  assert.equal(dk(after)['.write'].includes(P1_CREDITS_DENIAL_BRANCH),true);
  assert.equal(dk(after)['.write'].includes(LEGACY_CREDITS_BRANCH),false);
  assert.equal(dk(before)['.read'],dk(after)['.read']);
  assert.equal(after.rules['.write'],before.rules['.write']);
  assert.equal(after.rules.tenants['.write'],before.rules.tenants['.write']);
  assert.equal(after.rules.tenants['$tenantId']['.write'],before.rules.tenants['$tenantId']['.write']);
  assert.equal(readFileSync('database.rules.json','utf8'),readFileSync('test/emulator/database.rules.json','utf8'));
  assert.equal(execFileSync('git',['hash-object','database.rules.json'],{encoding:'utf8'}).trim(),P1_R2_RULES_BLOB);
});

test('P1R2-G02 narrow guard rejects an extra grant, read change, ancestor grant, or weakened denial',()=>{
  const mutants=[
    x=>{dk(x)['.write']=dk(x)['.write'].replace(P1_CREDITS_DENIAL_BRANCH,"$dataKey.matches(/^biz:[^:]+:credits$/) ? true")},
    x=>{dk(x)['.write']=dk(x)['.write'].replace(P1_CREDITS_DENIAL_BRANCH,"$dataKey.matches(/^biz:[^:]+:credits$/) ? auth !== null")},
    x=>{dk(x)['.read']+=' || true'},
    x=>{x.rules.tenants['$tenantId']['.write']=true},
    x=>{dk(x).newGrant={'.write':true}},
  ];
  for(const change of mutants){const m=clone(after);change(m);assert.equal(authorizedLegacyCreditsDenialDelta(before,m).ok,false)}
});

// R3 retains the exact R2 delta; these controls prohibit accidental policy expansion.
for (const [name, mutate] of [
  ['client-write denial', x=>{dk(x)['.write']='auth != null'}],
  ['ancestor bypass', x=>{x.rules.tenants['$tenantId']['.write']='auth != null'}],
  ['multi-path bypass', x=>{x.rules.tenants['.write']='auth != null'}],
  ['membership grant', x=>{dk(x)['.write']="root.child('tenants').child($tenantId).child('members').child(auth.uid).val() === true"}],
  ['stale business-access instead of registry', x=>{dk(x)['.write']="root.child('tenants').child($tenantId).child('biz_access').child('ghost').child(auth.uid).val() === true"}],
  ['role grant', x=>{dk(x)['.write']="root.child('tenants').child($tenantId).child('roles').child(auth.uid).val() === 'owner'"}],
  ['legacy node', x=>{dk(x)['.write']=dk(x)['.write'].replace(P1_CREDITS_DENIAL_BRANCH,LEGACY_CREDITS_BRANCH)}],
  ['duplicate registry child', x=>{dk(x).documents={'.write':'auth != null'}}],
]) test('P1R3 semantic guard rejects '+name,()=>{const m=clone(after);mutate(m);assert.equal(authorizedLegacyCreditsDenialDelta(before,m).ok,false)});
