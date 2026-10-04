// R3 identity guard — HISTORICAL since Core/F1 R4. The R3 candidate (950045c6) was independently REJECTED; its
// identities are verified exactly at the R4 parent (the rejected commit itself, preserved unchanged in
// ancestry) and REFUSED as the current identity. The current tree is pinned by f1-r4-identity-guard.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {REPO} from '../support/fincore-load.mjs';
import {F2_INDEX_PIN,F2_RUNTIME_BLOBS} from '../support/f2-candidate-pin.mjs';
import {R3_PARENT,R3_INDEX_PIN,R3_RUNTIME_BLOBS} from '../support/r3-candidate-pin.mjs';
import {r3IndexVerdict} from '../support/r3-index-scope.mjs';
import {R4_PARENT} from '../support/r4-candidate-pin.mjs';

const git=(...args)=>spawnSync('git',args,{cwd:REPO,encoding:'utf8',maxBuffer:1<<28});
const hash=b=>spawnSync('git',['hash-object','--stdin'],{input:b,encoding:'utf8'}).stdout.trim();
const base=git('show',`${R3_PARENT}:index.html`).stdout;
const pins={...R3_RUNTIME_BLOBS,'index.html':R3_INDEX_PIN.blob};

test('R3G-01 (historical) fixed parent (the Vercel carriage commit) and bounded R3 delta; the REJECTED R3 candidate keeps its literal pins at the R4 parent and is refused as the current identity',()=>{
  assert.equal(git('merge-base','--is-ancestor',R3_PARENT,'HEAD').status,0);
  assert.equal(git('merge-base','--is-ancestor',R4_PARENT,'HEAD').status,0);
  assert.equal(git('rev-parse',`${R4_PARENT}^`).stdout.trim(),R3_PARENT,'the R3 candidate sits directly on the Vercel carriage commit');
  assert.notEqual(git('rev-parse','HEAD').stdout.trim(),R4_PARENT,'the current tree is a strict descendant of the rejected candidate');
  assert.equal(hash(base),F2_INDEX_PIN.blob,'the R3 base page is the fixed F2 identity');
  for(const [f,pin] of Object.entries(F2_RUNTIME_BLOBS)) assert.equal(git('rev-parse',`${R3_PARENT}:${f}`).stdout.trim(),pin,`F2 parent ${f}`);
  const page=git('show',`${R4_PARENT}:index.html`).stdout;
  assert.deepEqual(r3IndexVerdict(base,page),{ok:true});
  for(const [f,pin] of Object.entries(pins)){
    assert.equal(git('rev-parse',`${R4_PARENT}:${f}`).stdout.trim(),pin,`${f} at the rejected R3 commit`);
    assert.notEqual(git('rev-parse',`HEAD:${f}`).stdout.trim(),pin,`${f}: the rejected R3 identity is not the current identity`);
    assert.notEqual(hash(readFileSync(join(REPO,f))),pin,`${f}: the checked-out bytes are not the rejected R3 bytes`);
  }
  assert.match(R3_INDEX_PIN.status,/pending independent Codex review/);
  const source=readFileSync(join(REPO,'test/support/r3-candidate-pin.mjs'),'utf8');
  assert.doesNotMatch(source,/hash-object|readFileSync|rev-parse|HEAD:/,'identity is literal, not derived from current HEAD');
  assert.equal(git('rev-parse',`${R3_PARENT}:database.rules.json`).stdout.trim(),git('rev-parse',`${R4_PARENT}:database.rules.json`).stdout.trim());
  const changed=git('diff','--name-only',R3_PARENT,R4_PARENT,'--').stdout.trim().split('\n').filter(f=>/^(src\/|fincore\/|lib\/|api\/|database\.rules\.json$|index\.html$)/.test(f)).sort();
  assert.deepEqual(changed,Object.keys(pins).sort());
});

test('R3G-02 (historical) page mutations of the R3 page fail its scope or exact identity',()=>{
  const page=git('show',`${R4_PARENT}:index.html`).stdout;
  const changes=[
    page.replace('v.costHistory !== "MARJIN_COSTH/5"','v.costHistory !== "MARJIN_COSTH/4"'),
    page.replace('api.versions.costHistory !== "MARJIN_COSTH/5"','false'),
    page.replace('data-f2="reject-flag"','data-f2="reject-flag-x"'),
    page.replace('{review?.state==="rejected"&&<p data-f2="rejected">','{false&&<p data-f2="rejected">'),
    page.replace(', histBind);',');'),
    page.replace('if (activating && (role!=="owner" || !activationConfirmed)) {setResult({status:"activation_confirmation_required"});return;}','if (false) {return;}'),
    page.replace('text={pv.gross.text}','text={pv.rows.net.text}'),
  ];
  for(const changed of changes){
    assert.notEqual(changed,page);
    assert.ok(!r3IndexVerdict(base,changed).ok||hash(changed)!==R3_INDEX_PIN.blob);
  }
});

test('R3G-03 (historical) changed runtime payload cannot satisfy the fixed R3 byte identities',()=>{
  for(const [f,pin] of Object.entries(R3_RUNTIME_BLOBS)){
    const b=Buffer.from(spawnSync('git',['show',`${R4_PARENT}:${f}`],{cwd:REPO,maxBuffer:1<<28}).stdout);
    assert.equal(hash(b),pin);
    assert.notEqual(hash(Buffer.concat([b,Buffer.from('\n// mutation\n')])),pin,f);
  }
});
