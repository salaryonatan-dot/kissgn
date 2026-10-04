// Run explicitly: node test/support/p1-r3-mutations.mjs <absolute log directory>
// Every mutant is a new disposable copy. Targeted COMMITTED behavioral tests must fail;
// syntax/generator failures are not accepted as detection.
import {mkdtempSync,cpSync,symlinkSync,readFileSync,writeFileSync,mkdirSync} from 'node:fs';
import {tmpdir} from 'node:os';import {join} from 'node:path';import {fileURLToPath} from 'node:url';import {spawnSync} from 'node:child_process';
const root=fileURLToPath(new URL('../../',import.meta.url)),out=process.argv[2];if(!out)throw Error('log directory required');mkdirSync(out,{recursive:true});
const core='src/finance/supplierCredits.ts',writer='lib/supplierCredits.js',repo='lib/repositories/supplierCreditsRepo.js';
const cases=[
 ['state-ack',writer,'? "cleared" : "rejected"','? "acknowledged" : "rejected"'],
 ['decision-ack',writer,'to === "cleared" ? "accepted" : "rejected"','to === "cleared" ? "acknowledged" : "rejected"'],
 ['registry-remove','api/admin.js','  await scRequireRegisteredBusiness(db, tenantId, bizId);','  // removed registry check'],
 ['registry-stale-access','api/admin.js','if (!businesses.some(b => String(b.id) === bizId))','if (false)'],
 ['case-config',core,'normalizeDocumentNumber(raw: unknown)','normalizeDocumentNumber(raw: unknown, caseSensitive = false)',null,
  [core,'const canonical = display.toLowerCase().normalize("NFKC");','const canonical = (caseSensitive ? display : display.toLowerCase()).normalize("NFKC");']],
 ['separator-delete',core,'const key = [...canonical].map((ch) => SEP_CHAR.test(ch) ? "~" + (ch.codePointAt(0) as number).toString(16) + "~" : ch).join("");','const key = fingerprint;'],
 ['uniqueness-scope',core,'=> "s_" + supplierId;','=> "s_all";'],
 ...['tenant','business','supplier','credit'].map((name,i)=>['audit-'+name,core,
  ['a.tenantId !== bind.tenantId','a.bizId !== bind.bizId','a.supplierId !== evidence.supplierId','a.creditId !== e.creditId'][i],'false']),
 ['numeric-op',core,'typeof a.operationId !== "string" || !OPERATION_ID_RE.test(a.operationId)','!OPERATION_ID_RE.test(String(a.operationId))'],
 ['readback-existence',repo,'if (!stored || stored !== ledger.intentDigest || stored !== expected)','if (false)'],
 ['lost-ack-failure',repo,'return readbackOperation(cmd, db);','return { outcome: "conflict", code: "write_failed" };'],
 ['partial',core,'const allInvalid = st.state !== "present" || st.issues.some((i) => i.dates.length === 0);','const allInvalid = st.state !== "present";', 'test/finance/p1-supplier-credits-core.test.mjs'],
 ['legacy','database.rules.json',null,null,'test/finance/p1-r2-rules-guard.test.mjs'],
 ['decision-window','api/admin.js','if (!CREDIT_REVIEW_DECIDER_ROLES.includes(checked.role))','if (false)'],
];
const results=[];
for(const [id,file,from,to,target,extra]of cases.filter(c=>!process.argv[3]||c[0]===process.argv[3])){
 const dir=mkdtempSync(join(tmpdir(),'p1r3-mut-'+id+'-'));cpSync(root,dir,{recursive:true,filter:p=>!['.git','node_modules','.deps'].includes(p.split('/').at(-1))});symlinkSync(join(root,'node_modules'),join(dir,'node_modules'),'dir');
 // Rules guard needs the historical baseline; an isolated init/import avoids shared indexes.
 if(file==='database.rules.json'){
  spawnSync('git',['init','-q'],{cwd:dir});spawnSync('git',['fetch','-q',root,'f3f5315920e38f79da1506d58b60625d7de67b60'],{cwd:dir});
  const r=JSON.parse(readFileSync(join(dir,file)));r.rules.tenants.$tenantId.$dataKey['.write']='auth != null';writeFileSync(join(dir,file),JSON.stringify(r));
 }else{
  const change=(f,a,b)=>{let s=readFileSync(join(dir,f),'utf8');if(!s.includes(a))throw Error('missing anchor '+id);writeFileSync(join(dir,f),s.split(a).join(b))};change(file,from,to);if(extra)change(...extra);
 }
 if(file.startsWith('src/')){const g=spawnSync(process.execPath,['tools/finance-core/gen-browser.mjs'],{cwd:dir,encoding:'utf8'});writeFileSync(join(out,id+'-regen.log'),g.stdout+g.stderr);if(g.status!==0)throw Error('invalid mutant '+id)}
 const test=target||'test/finance/p1-r3-contract.test.mjs';
 const r=spawnSync(process.execPath,['--test','--test-reporter=tap',test],{cwd:dir,encoding:'utf8',timeout:120000,maxBuffer:8e6});writeFileSync(join(out,id+'.log'),r.stdout+r.stderr);
 const detected=r.status===1&&/^not ok /m.test(r.stdout)&&!r.stdout.includes('SyntaxError');results.push({id,file,target:test,exit:r.status,detected});console.log(id,detected?'DETECTED':'SURVIVED');writeFileSync(join(out,'summary.json'),JSON.stringify(results,null,2));
}
if(results.some(x=>!x.detected))process.exitCode=1;
