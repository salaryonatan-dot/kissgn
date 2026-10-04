// Core/F1 R4 identity guard: the successor starts at the exact REJECTED R3 candidate (950045c6, preserved
// unchanged in ancestry), its page delta is bounded by the R4 scope contract, and every changed runtime file
// has a FIXED literal pin equal to the committed, staged and checked-out bytes. The R3 pins are HISTORICAL:
// they are verified at the R4 parent and REFUSED as the current identity. Pins are pending independent
// Codex review; a changed pin is a new candidate and inherits no approval.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {REPO} from '../support/fincore-load.mjs';
import {R3_PARENT,R3_INDEX_PIN,R3_RUNTIME_BLOBS} from '../support/r3-candidate-pin.mjs';
import {r3IndexVerdict} from '../support/r3-index-scope.mjs';
import {R4_PARENT,R4_INDEX_PIN,R4_RUNTIME_BLOBS,R4_NEW_FILES} from '../support/r4-candidate-pin.mjs';
import {r4IndexVerdict} from '../support/r4-index-scope.mjs';

const git=(...args)=>spawnSync('git',args,{cwd:REPO,encoding:'utf8',maxBuffer:1<<28});
const hash=b=>spawnSync('git',['hash-object','--stdin'],{input:b,encoding:'utf8'}).stdout.trim();
const base=git('show',`${R4_PARENT}:index.html`).stdout;
const pins={...R4_RUNTIME_BLOBS,'index.html':R4_INDEX_PIN.blob};

test('R4G-01 fixed parent (the rejected R3 candidate, unchanged) and bounded R4 delta; committed, staged and working bytes match the literal pins; R3 pins are historical',()=>{
  assert.equal(git('merge-base','--is-ancestor',R4_PARENT,'HEAD').status,0,'the rejected R3 candidate is preserved in ancestry');
  assert.notEqual(git('rev-parse','HEAD').stdout.trim(),R4_PARENT,'the successor is a strict descendant');
  assert.equal(git('rev-parse',`${R4_PARENT}^`).stdout.trim(),R3_PARENT,'the R3 candidate itself sits on the Vercel carriage commit');
  // the R3 layer is HISTORICAL: its identities hold exactly at the R4 parent …
  assert.equal(hash(base),R3_INDEX_PIN.blob,'the R4 base page is the fixed (rejected) R3 identity');
  assert.deepEqual(r3IndexVerdict(git('show',`${R3_PARENT}:index.html`).stdout,base),{ok:true},'the R4 base satisfies the historical R3 scope');
  for(const [f,pin] of Object.entries(R3_RUNTIME_BLOBS)) assert.equal(git('rev-parse',`${R4_PARENT}:${f}`).stdout.trim(),pin,`R3 historical ${f}`);
  // … and are REFUSED as the current identity (R4 replaced every R3 runtime blob and the page)
  for(const [f,pin] of Object.entries(R3_RUNTIME_BLOBS)) assert.notEqual(git('rev-parse',`HEAD:${f}`).stdout.trim(),pin,`${f}: the R3 pin is not the current identity`);
  assert.notEqual(git('rev-parse','HEAD:index.html').stdout.trim(),R3_INDEX_PIN.blob,'the R3 page is not the current page');
  // the R4 layer: bounded page delta + literal pins on committed, staged and checked-out bytes
  const page=readFileSync(join(REPO,'index.html'));
  assert.deepEqual(r4IndexVerdict(base,page),{ok:true});
  for(const [f,pin] of Object.entries(pins)){
    assert.equal(git('rev-parse',`HEAD:${f}`).stdout.trim(),pin,`${f} committed`);
    assert.equal(git('rev-parse',`:${f}`).stdout.trim(),pin,`${f} staged`);
    assert.equal(hash(readFileSync(join(REPO,f))),pin,`${f} checked out`);
  }
  for(const f of R4_NEW_FILES){
    assert.notEqual(git('cat-file','-e',`${R4_PARENT}:${f}`).status,0,`${f} is new in R4`);
    assert.ok(Object.prototype.hasOwnProperty.call(R4_RUNTIME_BLOBS,f),`${f} is pinned`);
  }
  assert.match(R4_INDEX_PIN.status,/pending independent Codex review/);
  const source=readFileSync(join(REPO,'test/support/r4-candidate-pin.mjs'),'utf8');
  assert.doesNotMatch(source,/hash-object|readFileSync|rev-parse|HEAD:|spawnSync/,'identity is literal, not derived from current HEAD');
  // the Rules are untouched by R4
  assert.equal(git('rev-parse',`${R4_PARENT}:database.rules.json`).stdout.trim(),git('rev-parse','HEAD:database.rules.json').stdout.trim());
  // exactly the pinned runtime files differ from the parent (protected roots)
  const changed=git('diff','--name-only',R4_PARENT,'HEAD','--').stdout.trim().split('\n').filter(f=>/^(src\/|fincore\/|lib\/|api\/|database\.rules\.json$|index\.html$)/.test(f)).sort();
  assert.deepEqual(changed,Object.keys(pins).sort());
  // no fifth-state literal anywhere in the pinned runtime
  for(const f of Object.keys(pins)) assert.ok(!readFileSync(join(REPO,f),'utf8').includes('acknowledged'),`${f} carries no fifth-state literal`);
});

test('R4G-02 page mutations that reopen a finding fail scope or exact identity: capability rollback, accept disclosure removed, unbound decode, generation binding dropped, owner-only controls removed, global tenant binding',()=>{
  const page=readFileSync(join(REPO,'index.html'),'utf8');
  const changes=[
    page.replace('v.costHistory !== "MARJIN_COSTH/6"','v.costHistory !== "MARJIN_COSTH/5"'),
    page.replace('api.versions.costHistory !== "MARJIN_COSTH/6"','false'),
    page.replace('{review?.state==="cleared"&&review?.decision==="accepted"&&<p data-f2="accepted">','{false&&<p data-f2="accepted">'),
    page.replace('{activating&&role!=="owner"&&<p data-f2="activation-owner-only">','{false&&<p data-f2="activation-owner-only">'),
    page.replace('{(activating?role==="owner":state.state==="present"&&!unresolved)&&draft&&<>','{(activating?true:state.state==="present"&&!unresolved)&&draft&&<>'),
    page.replace('      if (!bound) return { ok: false, reason: "context_unbound" };','      if (false) return { ok: false, reason: "context_unbound" };'),
    page.replace('      if (!registered) return { ok: false, reason: "business_unregistered" };','      if (false) return { ok: false, reason: "business_unregistered" };'),
    page.replace('finF.costHistory.codec.decodeHistory({ exists: raw.costHistory.kind !== "absent", value: raw.costHistory.raw }, histBind.bind)','finF.costHistory.codec.decodeHistory({ exists: raw.costHistory.kind !== "absent", value: raw.costHistory.raw }, { tenantId: window._currentTenantId, bizId: currentBizId })'),
    page.replace('      : !histBind.ok ? { state: "unreadable", reason: histBind.reason }','      : !histBind.ok ? { state: "absent" }'),
    page.replace('  }, [currentBizId, finSel.gen, finSel.tenantId]);','  }, [currentBizId]);'),
    page.replace('    : !bound ? {state:"unreadable",reason:"context_unbound"}','    : !bound ? {state:"absent"}'),
    page.replace('data-f2="reject-flag"','data-f2="reject-flag-x"'),
    page.replace('if (activating && (role!=="owner" || !activationConfirmed)) {setResult({status:"activation_confirmation_required"});return;}','if (false) {return;}'),
    page.replace('text={pv.gross.text}','text={pv.rows.net.text}'),
    page+'\n',
  ];
  for(const changed of changes){
    assert.notEqual(changed,page);
    assert.ok(!r4IndexVerdict(base,changed).ok||hash(changed)!==R4_INDEX_PIN.blob);
  }
  // a page that reintroduces the fifth state fails scope even inside an allowed hunk
  const fifth=page.replace('{review?.state==="cleared"&&review?.decision==="accepted"&&<p data-f2="accepted">','{review?.state==="acknowledged"&&<p data-f2="accepted">');
  assert.equal(r4IndexVerdict(base,fifth).ok,false);
});

test('R4G-03 changed runtime payload cannot satisfy the fixed byte identities; the R3 blobs are refused for every R4 file',()=>{
  for(const [f,pin] of Object.entries(R4_RUNTIME_BLOBS)){
    const b=readFileSync(join(REPO,f));
    assert.equal(hash(b),pin);
    assert.notEqual(hash(Buffer.concat([b,Buffer.from('\n// mutation\n')])),pin,f);
    if(R3_RUNTIME_BLOBS[f]) assert.notEqual(R3_RUNTIME_BLOBS[f],pin,`${f}: R4 pin differs from the rejected R3 pin`);
  }
  assert.notEqual(R4_INDEX_PIN.blob,R3_INDEX_PIN.blob);
});
