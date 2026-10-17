import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, rmSync, appendFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { untrackedPaths } from '../support/bf2-backfill-layer.mjs';
import { verifyA1Head } from '../support/m1-a1-inspection.mjs';
import { REPO } from '../support/fincore-load.mjs';
test('A1R-01 BF3 discovery retains ignored/global-excluded/non-ASCII/nested-Git files by name',()=>{
 const p=mkdtempSync(join(tmpdir(),'a1-collector-'));
 const git=(...a)=>{const r=spawnSync('git',['-C',p,...a],{encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);};
 try {
  git('init','--quiet');writeFileSync(join(p,'.git/info/exclude'),'vendor/\n');
  const nested=join(p,'vendor','nested');mkdirSync(nested,{recursive:true});
  let r=spawnSync('git',['init','--quiet',nested],{encoding:'utf8',timeout:30000});assert.equal(r.status,0,r.stderr);
  mkdirSync(join(nested,'scripts'));writeFileSync(join(nested,'scripts','נסיון\n.mjs'),'// protected\n');
  const global=join(p,'global-excludes');writeFileSync(global,'vendor/\n');git('config','core.excludesFile',global);
  writeFileSync(join(nested,'.gitignore'),'scripts/\n');
  assert.ok(untrackedPaths(p).includes('vendor/nested/scripts/נסיון\n.mjs'),'the protected descendant itself is named');
  mkdirSync(join(p,'node_modules'));writeFileSync(join(p,'node_modules','excluded.mjs'),'');assert.ok(!untrackedPaths(p).some(f=>f.startsWith('node_modules/')));
 } finally {rmSync(p,{recursive:true,force:true});}
});
test('A1R-02 current runtime dirt is refused in a disposable clone',()=>{
 const p=mkdtempSync(join(tmpdir(),'a1-runtime-tamper-'));
 const git=(...a)=>spawnSync('git',a,{encoding:'utf8',timeout:60000,maxBuffer:32*1024*1024});
 try {
  let r=git('clone','--shared','--quiet',REPO,p);assert.equal(r.status,0,r.stderr);
  appendFileSync(join(p,'lib/emailDelivery.js'),'\n// A1 current-state negative control\n');
  assert.throws(()=>verifyA1Head(p),/scope|assembly|lib\/emailDelivery/);
 } finally {rmSync(p,{recursive:true,force:true});}
 assert.equal(verifyA1Head(REPO).ok,true);
});
