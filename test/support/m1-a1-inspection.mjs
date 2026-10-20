// M1-A1 inspection composition. PROPOSED technical carriage, not integration/release acceptance.
import { test as nodeTest, after } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync, mkdtempSync, symlinkSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { untrackedPaths, bf2RecordVerdict, BF2_PIN, BF2_FILE } from './bf2-backfill-layer.mjs';

export const A1_PARENT = 'f34eec92aed4851c2da8a8dfd8f1f353b1d582d7';
export const A1_SOURCES = Object.freeze({ c07t:'7062046c0227a3647fbd034e83c9bcff937e79f6', cc2:'838b63659596cd995331bbf8c681e6ad12cf1ec1', bf3:'3a3b6ff21632d76563eae95c6a8717e1cc263f76', dt:'7b1d3061c1a42b2d05d7702fbe376f98916e2ce6' });
export const A2_PARENT = 'a5f9f1b471e9d7004aba3dec923f717dbfe36c3e';
export const A2_SCOPE = Object.freeze(["test/finance/adb06-builder-layer-guard.test.mjs", "test/finance/bf1-backfill-layer-guard.test.mjs", "test/finance/cc1-checklist-cold-cache-guard.test.mjs", "test/finance/hr1-daily-hold-guard.test.mjs", "test/finance/m1-a1-inspection-guard.test.mjs", "test/support/m1-a1-inspection.json", "test/support/m1-a1-inspection.mjs"]);
// M1-A3: bounded policy-carriage successor of A2 (proposal T-A3-*). DP4 is a provenance reference, never an ancestor.
export const A3_PARENT = '43387d824e539fe5233c3b4112e6bf47a80366bb';
export const A3_SOURCE = Object.freeze({ dp4:'079fe656779eb6f922d2e3bfe3a567a6a73545ef' });
export const A3_DP_CHAIN = Object.freeze(["079fe656779eb6f922d2e3bfe3a567a6a73545ef", "a125824cdf1b824da3e60c6a85f43b73d5ee4e68", "78b6f05775cdbbad8de161c1377de79aafa41e96", "b2b7dd08c2de55b7103e5e0bdbfe10446368e2a6", "f34eec92aed4851c2da8a8dfd8f1f353b1d582d7"]);
export const A3_RUNTIME = Object.freeze(["api/daily-snapshot/run.ts", "lib/emailDelivery.d.ts", "lib/emailDelivery.js", "tools/daily-delivery/hold.mjs"]);
export const A3_SCOPE = Object.freeze(["api/daily-snapshot/run.ts", "lib/emailDelivery.d.ts", "lib/emailDelivery.js", "test/delivery/daily-email-delivery.test.mjs", "test/delivery/dp1-manual-delivery-policy.test.mjs", "test/delivery/dp2-shared-admission.test.mjs", "test/delivery/dp3-evidence-validation.test.mjs", "test/delivery/dp4-legacy-date-scope.test.mjs", "test/delivery/hr1-daily-hold.test.mjs", "test/delivery/hr3-ot1-drain-evidence-store-shape.test.mjs", "test/emulator/dp1-manual-policy-emulator.mjs", "test/emulator/dp2-admission-worker.mjs", "test/emulator/dp2-shared-admission-emulator.mjs", "test/emulator/dp3-evidence-emulator.mjs", "test/emulator/hr1-daily-hold-emulator.mjs", "test/finance/b2-guard-mutations.test.mjs", "test/finance/b2-snapshot.test.mjs", "test/finance/dp1-daily-policy-guard.test.mjs", "test/finance/dp2-daily-policy-guard.test.mjs", "test/finance/dp3-daily-policy-guard.test.mjs", "test/finance/dp4-daily-policy-guard.test.mjs", "test/finance/m1-a1-inspection-guard.test.mjs", "test/finance/m1-a3-policy-carriage-guard.test.mjs", "test/support/dp1-daily-policy.json", "test/support/dp1-daily-policy.mjs", "test/support/dp2-daily-policy.json", "test/support/dp2-daily-policy.mjs", "test/support/dp3-daily-policy.json", "test/support/dp3-daily-policy.mjs", "test/support/dp4-daily-policy.json", "test/support/dp4-daily-policy.mjs", "test/support/m1-a1-inspection.json", "test/support/m1-a1-inspection.mjs", "test/support/m1-r1-remediation.mjs", "tools/daily-delivery/hold.mjs"]);
export const A3_EDITED = Object.freeze(["test/finance/b2-guard-mutations.test.mjs", "test/finance/b2-snapshot.test.mjs", "test/finance/m1-a1-inspection-guard.test.mjs", "test/support/m1-r1-remediation.mjs"]);
export const A3_POLICY_PIN_FILES = Object.freeze(["api/daily-snapshot/run.ts", "lib/emailDelivery.d.ts", "lib/emailDelivery.js", "test/delivery/daily-email-delivery.test.mjs", "test/delivery/dp1-manual-delivery-policy.test.mjs", "test/delivery/dp2-shared-admission.test.mjs", "test/delivery/dp3-evidence-validation.test.mjs", "test/delivery/dp4-legacy-date-scope.test.mjs", "test/delivery/hr1-daily-hold.test.mjs", "test/delivery/hr3-ot1-drain-evidence-store-shape.test.mjs", "test/emulator/dp1-manual-policy-emulator.mjs", "test/emulator/dp2-admission-worker.mjs", "test/emulator/dp2-shared-admission-emulator.mjs", "test/emulator/dp3-evidence-emulator.mjs", "test/emulator/hr1-daily-hold-emulator.mjs", "test/finance/b2-guard-mutations.test.mjs", "test/finance/b2-snapshot.test.mjs", "test/finance/dp1-daily-policy-guard.test.mjs", "test/finance/dp2-daily-policy-guard.test.mjs", "test/finance/dp3-daily-policy-guard.test.mjs", "test/finance/dp4-daily-policy-guard.test.mjs", "test/finance/hr3-ot4-daily-hold-guard.test.mjs", "test/support/dp1-daily-policy.mjs", "test/support/dp2-daily-policy.mjs", "test/support/dp3-daily-policy.mjs", "test/support/dp4-daily-policy.mjs", "test/support/m1-r1-remediation.mjs", "tools/daily-delivery/hold.mjs"]);
// M1-A3-T1: test-only successor of accepted A3 (PROPOSED). No runtime, Rules, release-pin, dependency or lockfile change.
export const A3T1_PARENT = '2dae86d4c8362212cd7633f05156a257adca7419';
export const A3T1_SCOPE = Object.freeze(["test/emulator/de1-r1-receipt-emulator.mjs", "test/emulator/de1-r2-receipt-emulator.mjs", "test/emulator/dp4-legacy-date-emulator.mjs", "test/finance/m1-a3-policy-carriage-guard.test.mjs", "test/finance/m1-a3t1-test-successor-guard.test.mjs", "test/support/m1-a1-inspection.json", "test/support/m1-a1-inspection.mjs"]);
export const A3T1_EDITED = Object.freeze(["test/emulator/de1-r1-receipt-emulator.mjs", "test/emulator/de1-r2-receipt-emulator.mjs", "test/finance/m1-a3-policy-carriage-guard.test.mjs", "test/support/m1-a1-inspection.mjs"]);
// N22: exact configuration-only child of accepted T1; historical predicates stay unchanged.
export const N22_PARENT = "0c70b41209ed2388e1cd2dea911657ab7e620b2a";
export const N22_SCOPE = Object.freeze(["package-lock.json", "package.json", "test/finance/m1-a1-inspection-guard.test.mjs", "test/finance/m1-a3-policy-carriage-guard.test.mjs", "test/finance/m1-a3t1-test-successor-guard.test.mjs", "test/finance/m1-node22-runtime-guard.test.mjs", "test/support/m1-a1-inspection.json", "test/support/m1-a1-inspection.mjs"]);
export const N22_EDITED = Object.freeze(["package-lock.json", "package.json", "test/finance/m1-a1-inspection-guard.test.mjs", "test/finance/m1-a3-policy-carriage-guard.test.mjs", "test/finance/m1-a3t1-test-successor-guard.test.mjs", "test/support/m1-a1-inspection.mjs"]);
export const A1_RECORD = 'test/support/m1-a1-inspection.json';
const MODULE_ROOT = fileURLToPath(new URL('../../', import.meta.url));
const git = (root,args) => spawnSync('git',['-C',root,...args],{encoding:'utf8',timeout:30000,maxBuffer:64*1024*1024});
const text = (root,args) => { const r=git(root,args); assert.equal(r.status,0,r.stderr); return r.stdout.trim(); };
export const a1Blob = (bytes) => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const load = root => JSON.parse(readFileSync(join(root,A1_RECORD),'utf8'));
export function isA1Tree(root) {
  try { const r=load(root); return r.parent===A1_PARENT && r.status==='PROPOSED_FOR_INDEPENDENT_REVIEW' && JSON.stringify(r.sources)===JSON.stringify(A1_SOURCES); }
  catch { return false; }
}
// A3 predicate: the A1 record, extended by the exact A3 successor entry (DP layering stays off: no DP ancestry).
export function isA3Tree(root) {
  try { const r=load(root); return isA1Tree(root) && !!r.successor && r.successor.parent===A3_PARENT && JSON.stringify(r.successor.source)===JSON.stringify(A3_SOURCE); }
  catch { return false; }
}
// A3-T1 predicate: the A3 record, extended by the exact test-only successor entry.
export function isA3T1Tree(root) {
  try { const r=load(root); return isA3Tree(root) && !!r.testSuccessor && r.testSuccessor.parent===A3T1_PARENT; }
  catch { return false; }
}
// A3-local policy pins: exactly the DP1..DP4 pin-table file set, valued from the A3 record (held by verifyA1Head and A3G-*).
export function a3PolicyPins(root) {
 if(!isA3Tree(root))return {};
 const record=load(root),out={};
 for(const file of A3_POLICY_PIN_FILES){const pin=record.treePins[file];assert.match(pin,/^[a-f0-9]{40}$/);out[file]=pin;}
 return Object.freeze(out);
}
// The independent guard holds these definitions and this module's exact pin directly.
export function verifyA1Head(root=MODULE_ROOT) {
  assert.ok(isA1Tree(root),'explicit A1 record and fixed source references required');
  const r=load(root), head=text(root,['rev-parse','HEAD']);
  // This bounded successor changes only the four authorized consumers and the existing joint-holder support.
  if(r.successor) assert.ok(r.carriage,'A3 extends the recorded A2 carriage');
  if(r.testSuccessor) assert.ok(r.successor,'A3-T1 extends the recorded A3 successor');
  if(r.node22Successor) assert.ok(r.testSuccessor,'N22 extends the recorded T1 successor');
  const expectedParent=r.node22Successor ? N22_PARENT : r.testSuccessor ? A3T1_PARENT : r.successor ? A3_PARENT : r.carriage ? A2_PARENT : A1_PARENT;
  if(r.carriage) {
    assert.deepEqual(r.carriage,{parent:A2_PARENT,scope:[...A2_SCOPE],status:'PROPOSED_FOR_INDEPENDENT_REVIEW'},'fixed A2 carriage, never arbitrary later ancestry');
    assert.deepEqual(text(root,['diff','--name-only',A2_PARENT,r.successor?A3_PARENT:'HEAD','--']).split('\n').filter(Boolean).sort(),[...A2_SCOPE],'exact authorized successor delta');
  }
  if(r.successor) {
    const {edits,...identity}=r.successor;
    assert.deepEqual(identity,{parent:A3_PARENT,source:{...A3_SOURCE},scope:[...A3_SCOPE],status:'PROPOSED_FOR_INDEPENDENT_REVIEW'},'fixed A3 successor, never arbitrary later ancestry');
    assert.deepEqual(text(root,['diff','--name-only',A3_PARENT,r.testSuccessor?A3T1_PARENT:'HEAD','--']).split('\n').filter(Boolean).sort(),[...A3_SCOPE],'exact authorized A3 delta');
    for(let i=0;i<A3_DP_CHAIN.length-1;i++) assert.deepEqual(text(root,['rev-list','--parents','-n1',A3_DP_CHAIN[i]]).split(' '),[A3_DP_CHAIN[i],A3_DP_CHAIN[i+1]],'literal DP provenance chain');
    assert.equal(git(root,['merge-base','--is-ancestor',A3_SOURCE.dp4,'HEAD']).status,1,'DP4 is a provenance reference, never an ancestor');
    assert.deepEqual(Object.keys(edits).sort(),[...A3_EDITED],'fixed A3 recorded-edit set');
  }
  if(r.testSuccessor) {
    const {edits,...identity}=r.testSuccessor;
    assert.deepEqual(identity,{parent:A3T1_PARENT,kind:'test_only',scope:[...A3T1_SCOPE],status:'PROPOSED_FOR_INDEPENDENT_REVIEW'},'fixed A3-T1 test-only successor, never arbitrary later ancestry');
    assert.deepEqual(text(root,['diff','--name-only',A3T1_PARENT,r.node22Successor?N22_PARENT:'HEAD','--']).split('\n').filter(Boolean).sort(),[...A3T1_SCOPE],'exact authorized A3-T1 delta');
    assert.equal(text(root,['diff','--name-only',A3T1_PARENT,r.node22Successor?N22_PARENT:'HEAD','--','.',':!test']),'','A3-T1 changes no file outside test/');
    assert.deepEqual(Object.keys(edits).sort(),[...A3T1_EDITED],'fixed A3-T1 recorded-edit set');
  }
  if(r.node22Successor) {
    const {edits,...identity}=r.node22Successor;
    assert.deepEqual(identity,{parent:N22_PARENT,kind:'node22_configuration_only',scope:[...N22_SCOPE],status:'PROPOSED_FOR_INDEPENDENT_REVIEW'},'fixed N22 successor, never arbitrary later ancestry');
    assert.deepEqual(text(root,['diff','--name-only',N22_PARENT,'HEAD','--']).split('\n').filter(Boolean).sort(),[...N22_SCOPE],'exact N22 scope');
    assert.deepEqual(Object.keys(edits).sort(),[...N22_EDITED],'exact N22 recorded-edit set');
  }
  assert.deepEqual(text(root,['rev-list','--parents','-n1','HEAD']).split(' '),[head,expectedParent],'exact sole inspection parent');
  for(const sha of Object.values(A1_SOURCES)) assert.equal(text(root,['cat-file','-t',sha]),'commit','source object required');
  const names=args=>text(root,args).split('\n').filter(Boolean).sort();
  assert.deepEqual(names(['diff','--name-only',A1_PARENT,'HEAD','--']),r.scope,'fixed committed assembly scope');
  assert.deepEqual(names(['diff','--name-only','--cached',A1_PARENT,'--']),r.scope,'fixed index assembly scope');
  assert.deepEqual(names(['diff','--name-only',A1_PARENT,'--']),r.scope,'fixed working assembly scope');
  assert.deepEqual(untrackedPaths(root),[],'all untracked paths including ignored and opaque nested repositories are accounted for');
  const tree={};
  for(const line of text(root,['ls-tree','-r','-z','HEAD']).split('\0').filter(Boolean)) { const m=/^(\d+) blob ([a-f0-9]{40})\t([\s\S]+)$/.exec(line); assert.ok(m,line); assert.notEqual(m[1],'120000','no tracked symlink'); tree[m[3]]=m[2]; }
  delete tree[A1_RECORD];
  assert.deepEqual(tree,r.treePins,'record covers every current tracked blob except its own non-self-hash');
  const index={}; for(const row of text(root,['ls-files','--stage','-z']).split('\0').filter(Boolean)) {const m=/^\d+ ([a-f0-9]{40}) 0\t([\s\S]+)$/.exec(row);assert.ok(m,'unmerged index');index[m[2]]=m[1];}
  for(const [file,pin] of Object.entries(r.treePins)) {
    assert.equal(index[file],pin,file+' index');
    assert.equal(a1Blob(readFileSync(join(root,file))),pin,file+' checkout');
  }
  assert.equal(text(root,['rev-parse','HEAD:'+A1_RECORD]),text(root,['rev-parse',':'+A1_RECORD]),'record index unchanged');
  assert.equal(a1Blob(readFileSync(join(root,A1_RECORD))),text(root,['rev-parse','HEAD:'+A1_RECORD]),'record working bytes unchanged');
  // Earlier contracts remain evaluated against exact accepted T1; N22's own derivation holds every changed current blob below.
  const provenancePins=r.node22Successor ? Object.fromEntries(text(root,['ls-tree','-r','-z',N22_PARENT]).split('\0').filter(Boolean).map(row=>{const m=/^\d+ blob ([a-f0-9]{40})\t([\s\S]+)$/.exec(row);assert.ok(m,row);return [m[2],m[1]];})) : tree;
  const provenancePin=file=>provenancePins[file];
  for(const [file,source] of Object.entries(r.verbatim)) assert.equal(provenancePin(file),text(root,['rev-parse',source+':'+file]),file+' attributed exact source');
  for(const [file,edits] of Object.entries(r.derivations)) {
    let s=spawnSync('git',['-C',root,'show',A1_PARENT+':'+file],{encoding:'utf8',timeout:30000,maxBuffer:32*1024*1024}).stdout;
    for(const e of edits) { assert.ok(e.from && s.split(e.from).length===2,file+' unique edit anchor'); s=s.replace(e.from,()=>e.to); }
    assert.equal(a1Blob(Buffer.from(s)),provenancePin(file),file+' recorded parent derivation');
  }
  if(r.carriage) for(const [file,edits] of Object.entries(r.legacyEdits)) {
    let s=spawnSync('git',['-C',root,'show',A2_PARENT+':'+file],{encoding:'utf8',timeout:30000,maxBuffer:32*1024*1024}).stdout;
    for(const e of edits){assert.ok(e.from && s.split(e.from).length===2,file+' unique legacy edit');s=s.replace(e.from,()=>e.to);}
    assert.equal(a1Blob(Buffer.from(s)),provenancePin(file),file+' exact authorized legacy derivation');
  }
  if(r.successor) for(const [file,{base,edits}] of Object.entries(r.successor.edits)) {
    assert.ok(base===A3_PARENT||base===A3_SOURCE.dp4,file+' fixed A3 derivation base');
    let s=spawnSync('git',['-C',root,'show',base+':'+file],{encoding:'utf8',timeout:30000,maxBuffer:32*1024*1024}).stdout;
    for(const e of edits){assert.ok(e.from && s.split(e.from).length===2,file+' unique A3 edit');s=s.replace(e.from,()=>e.to);}
    assert.equal(a1Blob(Buffer.from(s)),provenancePin(file),file+' exact A3 derivation');
  }
  if(r.testSuccessor) for(const [file,{base,edits}] of Object.entries(r.testSuccessor.edits)) {
    assert.equal(base,A3T1_PARENT,file+' fixed A3-T1 derivation base');
    let s=spawnSync('git',['-C',root,'show',base+':'+file],{encoding:'utf8',timeout:30000,maxBuffer:32*1024*1024}).stdout;
    for(const e of edits){assert.ok(e.from && s.split(e.from).length===2,file+' unique A3-T1 edit');s=s.replace(e.from,()=>e.to);}
    assert.equal(a1Blob(Buffer.from(s)),provenancePin(file),file+' exact A3-T1 derivation');
  }
  if(r.node22Successor) for(const [file,{base,edits}] of Object.entries(r.node22Successor.edits)) {
    assert.equal(base,N22_PARENT,file+' fixed N22 derivation base');
    let s=spawnSync('git',['-C',root,'show',base+':'+file],{encoding:'utf8',timeout:30000,maxBuffer:32*1024*1024}).stdout;
    for(const e of edits){assert.ok(e.from && s.split(e.from).length===2,file+' unique N22 edit');s=s.replace(e.from,()=>e.to);}
    assert.equal(a1Blob(Buffer.from(s)),tree[file],file+' exact N22 derivation');
  }
  return {ok:true,head,files:Object.keys(tree).length};
}

// Run the unchanged assertions in an isolated literal source view. This is a local shared-object
// test fixture, not the bundle-only delivery proof. Current A1 protection is always checked first.
const views=new Map(), results=new Map();
after(()=>{ for(const dir of views.values()) rmSync(dir,{recursive:true,force:true}); });
function sourceView(root,sha) {
  if(views.has(sha)) return views.get(sha);
  const dir=mkdtempSync(join(tmpdir(),'m1-a1-history-'));
  let r=spawnSync('git',['clone','--shared','--no-checkout','--quiet',root,dir],{encoding:'utf8',timeout:60000});assert.equal(r.status,0,r.stderr);
  r=spawnSync('git',['-C',dir,'checkout','--quiet','--detach',sha],{encoding:'utf8',timeout:60000});assert.equal(r.status,0,r.stderr);
  for(const dep of ['node_modules','test/historical/.deps']) { const p=join(root,dep); if(existsSync(p))symlinkSync(resolve(p),join(dir,dep),'dir'); }
  views.set(sha,dir);return dir;
}
export function historicalTest(rootURL,sha,file) {
  const root=fileURLToPath(rootURL);
  if(!isA1Tree(root)) return nodeTest;
  return (title,options,fn)=> {
    if(typeof options==='function') {fn=options;options={};}
    // No A1 proof is skipped because a source-reference lane isn't an ancestor.
    return nodeTest(title, { ...options, skip:false, todo:false }, t=> {
      verifyA1Head(root);
      const key=sha+':'+file;
      if(!results.has(key)) {
        const view=sourceView(root,sha);
        const childEnv={...process.env}; delete childEnv.NODE_TEST_CONTEXT; // a fresh node:test subprocess, not a recursive inherited runner
        const r=spawnSync(process.execPath,['--test','--test-reporter=tap',file],{cwd:view,env:childEnv,encoding:'utf8',timeout:300000,maxBuffer:64*1024*1024});
        const metrics={};for(const k of ['tests','pass','fail','skipped','cancelled','todo'])metrics[k]=Number(new RegExp('^# '+k+' (\\d+)$','m').exec(r.stdout)?.[1]??NaN);
        const titles=[...r.stdout.matchAll(/^ok \d+ - (.*)$/gm)].map(m=>m[1]);
        results.set(key,{status:r.status,signal:r.signal,stdout:r.stdout,stderr:r.stderr,metrics,titles});
        t.diagnostic('Literal historical execution '+key+'\n'+r.stdout+'\nSTDERR\n'+r.stderr);
      }
      const r=results.get(key);
      assert.equal(r.status,0,'literal source guard must finish successfully: '+key+'\n'+r.stdout+'\n'+r.stderr);
      assert.equal(r.metrics.fail,0);assert.equal(r.metrics.skipped,0);assert.equal(r.metrics.cancelled,0);assert.equal(r.metrics.todo,0);
      assert.ok(r.metrics.pass>0);assert.ok(r.titles.includes(title),'the exact original assertion row executed: '+title);
    });
  };
}

// A1-local projection: the standalone BF2 predicate requires BF1 ancestry, which a
// content-only carry deliberately does not acquire. Preserve the exact BF2 verdict
// and script checks here; the original BF3 module and collector remain unchanged.
export function a1BackfillProjection(root, paths) {
 const all=[...new Set(paths||[])];
 if(!isA1Tree(root))return {ok:true,layered:false,projected:all};
 const verdict=bf2RecordVerdict(root);if(!verdict.ok)return verdict;
 assert.equal(BF2_PIN,'25754ea6e7f81585b0d68101da5c51ebcff6de48');
 let bytes;try{bytes=readFileSync(join(root,BF2_FILE));}catch{return {ok:false,reason:'script_missing'};}
 if(a1Blob(bytes)!==BF2_PIN)return {ok:false,reason:'script_content_mismatch'};
 if(text(root,['rev-parse','HEAD:'+BF2_FILE])!==BF2_PIN || text(root,['rev-parse',':'+BF2_FILE])!==BF2_PIN)return {ok:false,reason:'script_history_mismatch'};
 // N22's two configuration files are a separate exact-content layer, never a widened
 // reader allowlist. Both files must match HEAD, index and working bytes before either
 // is projected; without this layer they remain protected in the reader verdict.
 if(load(root).node22Successor) {
  const {edits,...identity}=load(root).node22Successor;
  if(JSON.stringify(identity)!==JSON.stringify({parent:N22_PARENT,kind:'node22_configuration_only',scope:[...N22_SCOPE],status:'PROPOSED_FOR_INDEPENDENT_REVIEW'}))return {ok:false,reason:'node22_layer_identity'};
  if(text(root,['rev-parse','HEAD^'])!==N22_PARENT)return {ok:false,reason:'node22_parent'};
  const pins={"package.json":"2a935d91920c71e6d1640871be54f1804f384830","package-lock.json":"c9704e950be93f24e2b0449fd0de427d0d6d4bec"};
  for(const [file,pin] of Object.entries(pins)) {
   let bytes;try{bytes=readFileSync(join(root,file));}catch{return {ok:false,reason:'node22_configuration_missing',detail:file};}
   if(a1Blob(bytes)!==pin||text(root,['rev-parse','HEAD:'+file])!==pin||text(root,['rev-parse',':'+file])!==pin)return {ok:false,reason:'node22_configuration_mismatch',detail:file};
  }
  return {ok:true,layered:true,layer:'A1-exact-BF3+N22',projected:all.filter(f=>f!==BF2_FILE&&!Object.hasOwn(pins,f))};
 }
 return {ok:true,layered:true,layer:'A1-exact-BF3',projected:all.filter(f=>f!==BF2_FILE)};
}

// Fixed assembly-local table: only support files already pinned by the inherited
// M1/hold tables may move here. Their content is held by the full A1 record and guard.
export const A1_LOCAL_PIN_FILES = Object.freeze([
 'test/finance/b2-guard-mutations.test.mjs',
 'test/support/m1-r1-remediation.mjs',
 'test/finance/hr3-ot4-daily-hold-guard.test.mjs',
]);
export function a1LocalPins(root) {
 if(!isA1Tree(root))return {};
 const record=load(root),out={};
 for(const file of A1_LOCAL_PIN_FILES){const pin=record.treePins[file];assert.match(pin,/^[a-f0-9]{40}$/);out[file]=pin;}
 return Object.freeze(out);
}
