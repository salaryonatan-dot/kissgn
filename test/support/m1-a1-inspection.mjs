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
// The independent guard holds these definitions and this module's exact pin directly.
export function verifyA1Head(root=MODULE_ROOT) {
  assert.ok(isA1Tree(root),'explicit A1 record and fixed source references required');
  const r=load(root), head=text(root,['rev-parse','HEAD']);
  // This bounded successor changes only the four authorized consumers and the existing joint-holder support.
  const expectedParent=r.carriage ? A2_PARENT : A1_PARENT;
  if(r.carriage) {
    assert.deepEqual(r.carriage,{parent:A2_PARENT,scope:[...A2_SCOPE],status:'PROPOSED_FOR_INDEPENDENT_REVIEW'},'fixed A2 carriage, never arbitrary later ancestry');
    assert.deepEqual(text(root,['diff','--name-only',A2_PARENT,'HEAD','--']).split('\n').filter(Boolean).sort(),[...A2_SCOPE],'exact authorized successor delta');
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
  for(const [file,source] of Object.entries(r.verbatim)) assert.equal(tree[file],text(root,['rev-parse',source+':'+file]),file+' attributed exact source');
  for(const [file,edits] of Object.entries(r.derivations)) {
    let s=spawnSync('git',['-C',root,'show',A1_PARENT+':'+file],{encoding:'utf8',timeout:30000,maxBuffer:32*1024*1024}).stdout;
    for(const e of edits) { assert.ok(e.from && s.split(e.from).length===2,file+' unique edit anchor'); s=s.replace(e.from,()=>e.to); }
    assert.equal(a1Blob(Buffer.from(s)),tree[file],file+' recorded parent derivation');
  }
  if(r.carriage) for(const [file,edits] of Object.entries(r.legacyEdits)) {
    let s=spawnSync('git',['-C',root,'show',A2_PARENT+':'+file],{encoding:'utf8',timeout:30000,maxBuffer:32*1024*1024}).stdout;
    for(const e of edits){assert.ok(e.from && s.split(e.from).length===2,file+' unique legacy edit');s=s.replace(e.from,()=>e.to);}
    assert.equal(a1Blob(Buffer.from(s)),tree[file],file+' exact authorized legacy derivation');
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
