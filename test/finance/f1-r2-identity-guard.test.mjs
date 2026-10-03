import {test} from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {join} from 'node:path';
import {spawnSync} from 'node:child_process';
import {REPO} from '../support/fincore-load.mjs';
import {R2_PARENT,R2_INDEX_PIN,R2_RUNTIME_BLOBS} from '../support/r2-candidate-pin.mjs';
import {r2IndexVerdict} from '../support/r2-index-scope.mjs';
import {F2_PARENT} from '../support/f2-candidate-pin.mjs';

const git=(...args)=>spawnSync('git',args,{cwd:REPO,encoding:'utf8'});
const blob=(f)=>git('rev-parse',f).stdout.trim();
const hash=b=>spawnSync('git',['hash-object','--stdin'],{input:b,encoding:'utf8'}).stdout.trim();
const base=git('show',`${R2_PARENT}:index.html`).stdout;
const current=()=>git('show',`${F2_PARENT}:index.html`).stdout;
const pins={...R2_RUNTIME_BLOBS,'index.html':R2_INDEX_PIN.blob};

test('R2G-01 historical R2 commit retains its exact approved-parent scope and literal candidate identities',()=>{
  assert.equal(git('merge-base','--is-ancestor',F2_PARENT,'HEAD').status,0);
  assert.deepEqual(r2IndexVerdict(base,current()),{ok:true});
  for(const [path,expected] of Object.entries(pins)){
    assert.equal(blob(`${F2_PARENT}:${path}`),expected,path+' R2 committed');
  }
  assert.match(R2_INDEX_PIN.status,/pending independent Claude review/);
});

test('R2G-02 changed page mutations fail scope or fixed identity',()=>{
  const original=current().toString('utf8');
  const cases=[
    original.replace('MARJIN_COSTH/3','MARJIN_COSTH/2'),
    original.replace('cost_history_" + src.costHistory.reason','cost_history_unreadable"'),
    original.replace('text={pv.gross.text}','text={pv.rows.net.text}'),
    original.replace('v.costHistory !== "MARJIN_COSTH/3"','false'),
  ];
  for(const changed of cases){assert.notEqual(changed,original);assert.ok(!r2IndexVerdict(base,changed).ok||hash(changed)!==R2_INDEX_PIN.blob);}
});
