// R3 identity guard: the successor starts at the exact Vercel-carriage commit (e63ba6c8), its page delta is
// bounded by the R3 scope contract, and every changed runtime file has a FIXED literal pin equal to the
// committed, staged and checked-out bytes. Pins are pending independent Codex review.
import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {REPO} from '../support/fincore-load.mjs';
import {F2_INDEX_PIN,F2_RUNTIME_BLOBS} from '../support/f2-candidate-pin.mjs';
import {R3_PARENT,R3_INDEX_PIN,R3_RUNTIME_BLOBS} from '../support/r3-candidate-pin.mjs';
import {r3IndexVerdict} from '../support/r3-index-scope.mjs';

const git=(...args)=>spawnSync('git',args,{cwd:REPO,encoding:'utf8'});
const hash=b=>spawnSync('git',['hash-object','--stdin'],{input:b,encoding:'utf8'}).stdout.trim();
const base=git('show',`${R3_PARENT}:index.html`).stdout;
const pins={...R3_RUNTIME_BLOBS,'index.html':R3_INDEX_PIN.blob};

test('R3G-01 fixed parent (the Vercel carriage commit) and bounded R3 delta; committed, staged and working bytes match the literal pins',()=>{
  assert.equal(git('merge-base','--is-ancestor',R3_PARENT,'HEAD').status,0);
  assert.notEqual(git('rev-parse','HEAD').stdout.trim(),R3_PARENT,'the successor is a strict descendant');
  assert.equal(hash(base),F2_INDEX_PIN.blob,'the R3 base page is the fixed F2 identity');
  for(const [f,pin] of Object.entries(F2_RUNTIME_BLOBS)) assert.equal(git('rev-parse',`${R3_PARENT}:${f}`).stdout.trim(),pin,`F2 parent ${f}`);
  const page=readFileSync(join(REPO,'index.html'));
  assert.deepEqual(r3IndexVerdict(base,page),{ok:true});
  for(const [f,pin] of Object.entries(pins)){
    assert.equal(git('rev-parse',`HEAD:${f}`).stdout.trim(),pin,`${f} committed`);
    assert.equal(git('rev-parse',`:${f}`).stdout.trim(),pin,`${f} staged`);
    assert.equal(hash(readFileSync(join(REPO,f))),pin,`${f} checked out`);
  }
  assert.match(R3_INDEX_PIN.status,/pending independent Codex review/);
  const source=readFileSync(join(REPO,'test/support/r3-candidate-pin.mjs'),'utf8');
  assert.doesNotMatch(source,/hash-object|readFileSync|rev-parse|HEAD:/,'identity is literal, not derived from current HEAD');
  // the Rules are untouched by R3
  assert.equal(git('rev-parse',`${R3_PARENT}:database.rules.json`).stdout.trim(),git('rev-parse','HEAD:database.rules.json').stdout.trim());
  // exactly the pinned runtime files differ from the parent (protected roots)
  const changed=git('diff','--name-only',R3_PARENT,'HEAD','--').stdout.trim().split('\n').filter(f=>/^(src\/|fincore\/|lib\/|api\/|database\.rules\.json$|index\.html$)/.test(f)).sort();
  assert.deepEqual(changed,Object.keys(pins).sort());
});

test('R3G-02 page mutations that reopen a finding fail scope or exact identity: capability rollback, reject control removed, unbound decode, owner activation gate removed',()=>{
  const page=readFileSync(join(REPO,'index.html'),'utf8');
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

test('R3G-03 changed runtime payload cannot satisfy the fixed byte identities',()=>{
  for(const [f,pin] of Object.entries(R3_RUNTIME_BLOBS)){
    const b=readFileSync(join(REPO,f));
    assert.equal(hash(b),pin);
    assert.notEqual(hash(Buffer.concat([b,Buffer.from('\n// mutation\n')])),pin,f);
  }
});
