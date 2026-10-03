import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {REPO} from '../support/fincore-load.mjs';
import {R2_INDEX_PIN,R2_RUNTIME_BLOBS} from '../support/r2-candidate-pin.mjs';
import {F2_PARENT,F2_INDEX_PIN,F2_RUNTIME_BLOBS} from '../support/f2-candidate-pin.mjs';
import {f2IndexVerdict} from '../support/f2-index-scope.mjs';

const git=(...args)=>spawnSync('git',args,{cwd:REPO,encoding:'utf8'});
const hash=b=>spawnSync('git',['hash-object','--stdin'],{input:b,encoding:'utf8'}).stdout.trim();
const base=git('show',`${F2_PARENT}:index.html`).stdout;
const pins={...F2_RUNTIME_BLOBS,'index.html':F2_INDEX_PIN.blob};

test('F2G-01 fixed R2 parent and bounded F2 delta; committed, staged, working bytes match candidate pins',()=>{
  assert.equal(git('merge-base','--is-ancestor',F2_PARENT,'HEAD').status,0);
  assert.equal(hash(base),R2_INDEX_PIN.blob);
  for(const [f,pin] of Object.entries(R2_RUNTIME_BLOBS))
    assert.equal(git('rev-parse',`${F2_PARENT}:${f}`).stdout.trim(),pin,`R2 parent ${f}`);
  const page=readFileSync(join(REPO,'index.html'));
  assert.deepEqual(f2IndexVerdict(base,page),{ok:true});
  for(const [f,pin] of Object.entries(pins)){
    assert.equal(git('rev-parse',`HEAD:${f}`).stdout.trim(),pin,`${f} committed`);
    assert.equal(git('rev-parse',`:${f}`).stdout.trim(),pin,`${f} staged`);
    assert.equal(hash(readFileSync(join(REPO,f))),pin,`${f} checked out`);
  }
  assert.match(F2_INDEX_PIN.status,/pending independent Claude review/);
  const source=readFileSync(join(REPO,'test/support/f2-candidate-pin.mjs'),'utf8');
  assert.doesNotMatch(source,/hash-object|readFileSync|rev-parse|HEAD:/,'identity is literal, not derived from current HEAD');
});

test('F2G-02 page changes to capability, owner gate or financial presentation fail scope or exact identity',()=>{
  const page=readFileSync(join(REPO,'index.html'),'utf8');
  const changes=[
    page.replace('v.costHistory !== "MARJIN_COSTH/4"','false'),
    page.replace('api.versions.costHistory !== "MARJIN_COSTH/4"','false'),
    page.replace('role!=="owner" || !activationConfirmed','false'),
    page.replace('financeLocked={finRaw.bizId!==currentBizId || finRaw.costHistory.kind!=="absent"}','financeLocked={false}'),
    page.replace('text={pv.gross.text}','text={pv.rows.net.text}'),
  ];
  for(const changed of changes){
    assert.notEqual(changed,page);
    assert.ok(!f2IndexVerdict(base,changed).ok||hash(changed)!==F2_INDEX_PIN.blob);
  }
});

test('F2G-03 changed runtime payload cannot satisfy the fixed byte identities',()=>{
  for(const [f,pin] of Object.entries(F2_RUNTIME_BLOBS)){
    const b=readFileSync(join(REPO,f));
    assert.equal(hash(b),pin);
    assert.notEqual(hash(Buffer.concat([b,Buffer.from('\n// mutation\n')])),pin,f);
  }
});
