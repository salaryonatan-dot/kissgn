// F2 rendered editor + trusted command over the real local RTDB emulator. No external project.
// Core/F1 R4: the canonical lifecycle in the rendered editor — pending / flagged withhold edits; the owner REJECTS
// (stored rejected + decision audit rejected) and ACCEPTS (stored cleared + decision audit accepted) through the real
// route; a rejected activation withholds everything until the owner explicitly re-activates; corrupt history is
// unavailable; super_owner decisions are refused; direct client writes are denied by the real Rules.
import admin from 'firebase-admin';
import {readFileSync,mkdtempSync,cpSync,mkdirSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {TextEncoder} from 'node:util';
import {bootHistoricalPage,depsStatus,click,textOf} from '../historical/historical-page-harness.mjs';
import {loadFinance} from '../support/c1-seam.mjs';
import {FLAG_AUDIT_SCHEMA,flagOperationIdOf} from '../../fincore/v1/finance/costHistory.js';
import {reviewEntry} from '../support/f1-history-fixtures.mjs';

const ROOT=join(dirname(fileURLToPath(import.meta.url)),'..','..');
const HOST='127.0.0.1:9000', PROJECT='demo-marjin-rules', NS='demo-marjin-rules-default-rtdb';
if(process.env.GCLOUD_PROJECT!==PROJECT||process.env.FIREBASE_DATABASE_EMULATOR_HOST!==HOST||process.env.GOOGLE_APPLICATION_CREDENTIALS||process.env.FIREBASE_DATABASE_URL)
  throw Error('local emulator safety precondition failed');
if(!depsStatus().ok)throw Error('pinned rendered-page dependencies missing');
const DB_URL=`http://${HOST}?ns=${NS}`, T='tenantA',B='bizA',UID='u_owner';
const USER={uid:UID,email:'owner@demo.example',displayName:'owner1'};
const env=x=>({_v:JSON.stringify(x)});
const baseRules=JSON.parse(readFileSync(join(ROOT,'database.rules.json'),'utf8'));
const rulesResponse=await fetch(`http://${HOST}/.settings/rules.json?ns=${NS}`,{method:'PUT',headers:{Authorization:'Bearer owner','Content-Type':'application/json'},body:JSON.stringify(baseRules)});
if(!rulesResponse.ok)throw Error('local Rules load failed');
const seedApp=admin.initializeApp({databaseURL:DB_URL},'f2-seed');
const ownerApp=admin.initializeApp({databaseURL:DB_URL,databaseAuthVariableOverride:{uid:UID,token:{email:USER.email}}},'f2-owner');
const seedDb=seedApp.database();
await seedDb.ref('/').set({tenants:{[T]:{
  members:{[UID]:true},roles:{[UID]:'owner'},biz_access:{[B]:{[UID]:true}},
  app:{users:env([{id:1,username:'owner1',name:'Owner',email:USER.email,role:'owner',firebaseUid:UID}]),business:env([{id:B,name:'Branch'}])},
  [`biz:${B}:config`]:env({businessName:'Branch',employees:[{id:'g1',name:'Global',type:'global',monthlySalary:'9000'}],rentType:'fixed',rentFixed:'2000',hasRoyalty:false}),
  [`biz:${B}:fixed`]:env([{id:'f1',name:'Utilities',amount:'3000'}]),
  [`biz:${B}:entries`]:env([]),[`biz:${B}:suppliers`]:env([]),
}},user_tenants:{[UID]:T},user_active_biz:{[UID]:B},username_index:{owner1:{tenantId:T,email:USER.email}}});

// Copy real trusted modules into a disposable module graph; replace only Admin construction
// and identity verification. The route, writer, Rules, browser SDK and RTDB are otherwise real.
const dir=mkdtempSync(join(tmpdir(),'f2-rendered-'));
cpSync(join(ROOT,'lib'),join(dir,'lib'),{recursive:true});
mkdirSync(join(dir,'api'));cpSync(join(ROOT,'api','cost-history.js'),join(dir,'api','cost-history.js'));
mkdirSync(join(dir,'fincore'),{recursive:true});cpSync(join(ROOT,'fincore','v1'),join(dir,'fincore','v1'),{recursive:true});
symlinkSync(join(ROOT,'node_modules'),join(dir,'node_modules'),'dir');
writeFileSync(join(dir,'lib','adminSdk.js'),`export function getAdminDb(){return globalThis.__F2_DB; }\nexport function getAdminAuth(){return {}; }\n`);
writeFileSync(join(dir,'lib','verifyToken.js'),`export async function requireAuth(){return globalThis.__F2_CLAIMS; }\nexport async function verifyIdToken(){return globalThis.__F2_CLAIMS; }\n`);
globalThis.__F2_DB=seedDb;globalThis.__F2_CLAIMS={uid:UID,email:USER.email};
const handler=(await import(pathToFileURL(join(dir,'api','cost-history.js')).href)).default;
let commits=0;
const fetchImpl=async(url,options={})=>{
  const u=String(url);
  if(u.startsWith('/api/config'))return {ok:true,status:200,json:async()=>({apiKey:'demo',authDomain:'demo.local',databaseURL:DB_URL,projectId:PROJECT})};
  if(u.startsWith('/api/admin?action=list-entry-exceptions')){
    const q=new URL(u,'http://local').searchParams;
    return {ok:true,status:200,json:async()=>({ok:true,tenantId:q.get('tenantId'),bizId:q.get('bizId'),fromDate:q.get('fromDate'),toDate:q.get('toDate'),exceptions:{}})};
  }
  if(u.startsWith('/api/cost-history')){
    const q=Object.fromEntries(new URL(u,'http://local').searchParams);
    const req={method:options.method||'GET',query:q,body:options.body?JSON.parse(options.body):undefined,headers:{}};
    const res={code:200,setHeader(){},status(n){this.code=n;return this;},json(data){this.body=data;return this;}};
    await handler(req,res);
    if(req.method==='POST')console.log('F2_POST',req.body?.action,res.code,res.body?.status,res.body?.detail||res.body?.reason||'',res.body?.cause||'');
    if(req.method==='POST'&&res.body?.status==='committed_current')commits++;
    return {ok:res.code<400,status:res.code,json:async()=>res.body};
  }
  return {ok:false,status:404,json:async()=>({status:'missing_mock'})};
};
const html=readFileSync(join(ROOT,'index.html'),'utf8');
const page=await bootHistoricalPage({html,fincore:'ok',loadFincore:loadFinance,adminApp:ownerApp,user:USER,
  session:{[`marjin_tid_${UID}`]:T,[`marjin_biz_${UID}`]:B},signedIn:true,fetchImpl});
// jsdom omits the browser's standard TextEncoder; the real F2 attestation digest uses it.
page.window.TextEncoder=TextEncoder;
const check=(ok,msg)=>{if(!ok)throw Error(msg)};
const setInput=(el,value)=>{
  const p=el.tagName==='TEXTAREA'?page.window.HTMLTextAreaElement.prototype:page.window.HTMLInputElement.prototype;
  Object.getOwnPropertyDescriptor(p,'value').set.call(el,value);
  el.dispatchEvent(new page.window.Event('input',{bubbles:true}));
  el.dispatchEvent(new page.window.Event('change',{bubbles:true}));
};
// The test's own authoritative reads use a SEPARATE Admin app: the writer's app (seedDb) must never carry a concurrent
// test listener on the node it transacts on (the Admin SDK asserts on a duplicate listen for one path in one client).
const readDb=admin.initializeApp({databaseURL:DB_URL},'f2-read').database();
const node=()=>readDb.ref(`tenants/${T}/biz:${B}:cost_history`).once('value');
// The editor disables every control while a command or its readback is in flight (`busy`); a control is driven only
// once the editor is idle again (the reload control is enabled), so no scenario races a previous step's readback.
const idle=(pg=page)=>pg.until(()=>{const b=Array.from(pg.document.querySelectorAll('[data-f2="cost-editor"] button')).find(x=>textOf(x)==='רענן מהשרת');return b&&!b.disabled;},15000);
const results=[];let mgrPage=null;
try{
  await page.until(()=>page.document.querySelector('button[title="הוצאות קבועות"]'),20000);
  click(page.document.querySelector('button[title="הוצאות קבועות"]'));
  await page.until(()=>page.document.querySelector('[data-f2="cost-editor"]'),10000);
  await page.until(()=>textOf(page.document.querySelector('[data-f2="state"]')).includes('טרם הופעלה'),10000);
  check(!(await node()).exists(),'opening editor must not activate');results.push('unactivated rendered, no write');
  const activate=page.document.querySelector('[data-f2="save"]');
  check(!!activate,'activation button rendered');
  click(activate);await page.until(()=>textOf(page.document.querySelector('[data-f2="result"]')).includes('לאשר'),5000);
  check(!(await node()).exists(),'activation without confirmation must not write');results.push('confirmation gate');
  click(page.document.querySelector('[data-f2="activation-confirm"]'));
  click(page.document.querySelector('[data-f2="save"]'));
  await page.until(()=>commits>=1,15000);
  await page.until(()=>textOf(page.document.querySelector('[data-f2="state"]')).includes('פעילה'),10000);
  results.push('owner activation through rendered UI, actual route and emulator');
  const before=(await node()).val();
  check(before.versions[before.head.headVersionId].globalEmployees[0].monthlyEmployerCost==='9000','global employer cost carried into first version');
  check(before.versions[before.head.headVersionId].fixedItems[0].monthlyAmount==='3000','fixed cost carried into first version');
  await page.until(()=>page.document.querySelector('[data-f2="save"]:not([disabled])'),10000);
  click(page.document.querySelector('[data-f2="save"]'));
  try{await page.until(()=>commits>=2,15000);}catch{throw Error('normal edit did not commit: result='+textOf(page.document.querySelector('[data-f2="result"]'))+' state='+textOf(page.document.querySelector('[data-f2="state"]'))+' errors='+JSON.stringify(page.console.errors));}
  check((await node()).val().head.revision===2,'normal today edit did not create revision 2');results.push('normal today edit through rendered UI');
  const historicalButton=Array.from(page.document.querySelectorAll('[data-f2="cost-editor"] button')).find(b=>textOf(b)==='תיקון היסטורי מאומת');
  check(historicalButton,'separate historical edit control rendered');click(historicalButton);
  const F=await loadFinance();
  const today=F.finance.businessDate.israelBusinessDate(Date.now());
  const past=F.finance.businessDate.addDays(today,-1);
  setInput(page.document.querySelector('[data-f2="effective-date"]'),past);
  setInput(page.document.querySelector('[aria-label="הקלד שוב תאריך תחולה"]'),past);
  setInput(page.document.querySelector('[aria-label="סיבת תיקון היסטורי"]'),'Documented invoice correction');
  click(page.document.querySelector('[data-f2="attestation"] input[type="checkbox"]'));
  await page.until(()=>page.document.querySelector('[data-f2="save"]:not([disabled])'),10000);
  click(page.document.querySelector('[data-f2="save"]'));
  try{await page.until(()=>commits>=3,15000);}catch{throw Error('historical edit did not commit: result='+textOf(page.document.querySelector('[data-f2="result"]'))+' date='+page.document.querySelector('[data-f2="effective-date"]')?.value+' typed='+page.document.querySelector('[aria-label="הקלד שוב תאריך תחולה"]')?.value+' reason='+page.document.querySelector('[aria-label="סיבת תיקון היסטורי"]')?.value+' errors='+JSON.stringify(page.console.errors));}
  const hist=(await node()).val();
  check(hist.versions[hist.head.headVersionId].schema==='MARJIN_COSTV/2','historical path stores version schema /2');
  check(hist.versions[hist.head.headVersionId].attestationReason==='Documented invoice correction','historical reason durably stored');
  results.push('separate attested historical edit through rendered UI');
  const pending=JSON.parse(JSON.stringify(hist)), id=pending.head.headVersionId, r=pending.review[id];
  pending.review[id]={schema:r.schema,state:'pending',intentDigest:r.intentDigest,actor:r.actor,committedAt:r.committedAt};
  await seedDb.ref(`tenants/${T}/biz:${B}:cost_history`).set(pending);
  await page.until(()=>page.document.querySelector('[data-f2="pending"]'),10000);
  check(!page.document.querySelector('[data-f2="save"]'),'pending version must withhold edits');
  results.push('pending state renders as non-authoritative');
  // R3: a FLAGGED head (in-window revocation evidence) → the owner REJECTS it through the rendered UI and the real route;
  // the version and its audit stay immutable, calculations exclude it, and a corrected successor continues the chain.
  const stable=x=>JSON.stringify(x,(_,v)=>(v&&typeof v==='object'&&!Array.isArray(v)?Object.fromEntries(Object.keys(v).sort().map(k=>[k,v[k]])):v));
  const flaggedNode=JSON.parse(JSON.stringify(hist));
  const fv=flaggedNode.versions[id], resolvedAt=fv.recordedAt+1, resolution='revoked_during_commit';
  const flagEntry=(rv,v,vid)=>({schema:rv.schema,state:'flagged',intentDigest:rv.intentDigest,actor:rv.actor,committedAt:rv.committedAt,resolvedAt:v.recordedAt+1,resolution,
    flagAudit:{schema:FLAG_AUDIT_SCHEMA,operationId:flagOperationIdOf({tenantId:T,bizId:B,versionId:vid,intentDigest:rv.intentDigest,outcome:resolution}),tenantId:T,bizId:B,versionId:vid,intentDigest:rv.intentDigest,recordedBy:v.recordedBy,recordedAt:v.recordedAt,outcome:resolution,resultingState:'flagged',detectedAt:v.recordedAt+1}});
  flaggedNode.review[id]=flagEntry(r,fv,id);
  await seedDb.ref(`tenants/${T}/biz:${B}:cost_history`).set(flaggedNode);
  await page.until(()=>page.document.querySelector('[data-f2="reject-flag"]'),10000);
  check(!page.document.querySelector('[data-f2="save"]'),'flagged version must withhold edits');
  // a super_owner cannot reject through the real route (fresh identity check), the manager-free tenant owner can
  await seedDb.ref(`tenants/${T}/members/u_super`).set(true);await seedDb.ref(`tenants/${T}/roles/u_super`).set('super_owner');
  globalThis.__F2_CLAIMS={uid:'u_super',email:'super@demo.example'};
  const superTry=await fetchImpl('/api/cost-history',{method:'POST',body:JSON.stringify({action:'reject_flag',tenantId:T,bizId:B,versionId:id,intentDigest:r.intentDigest,operationId:'11111111-1111-4111-8111-111111111111'})});
  check(superTry.status===403&&(await node()).val().review[id].state==='flagged','super_owner rejection must be refused with 403 and no change');
  globalThis.__F2_CLAIMS={uid:UID,email:USER.email};
  await idle();await page.until(()=>page.document.querySelector('[data-f2="reject-flag"]:not([disabled])'),10000);
  click(page.document.querySelector('[data-f2="reject-flag"]'));
  await page.until(()=>page.document.querySelector('[data-f2="rejected"]'),15000);
  const rejectedNode=(await node()).val();
  const rj=rejectedNode.review[id];
  check(rj.state==='rejected'&&rj.decision==='rejected'&&rj.decisionAudit&&rj.decisionAudit.decision==='rejected'&&rj.decisionAudit.resultingState==='rejected'&&rj.decisionAudit.decidedBy===UID&&typeof rj.decisionAudit.operationId==='string'&&rj.decisionAudit.tenantId===T&&rj.decisionAudit.bizId===B&&rj.decisionAudit.versionId===id,'owner rejection stored as rejected + bound decision audit rejected');
  check(!JSON.stringify(rejectedNode).includes('acknowledged'),'no fifth state anywhere in the stored node');
  check(stable(rejectedNode.review[id].flagAudit)===stable(flaggedNode.review[id].flagAudit)&&stable(rejectedNode.versions)===stable(flaggedNode.versions),'audit and versions immutable through rejection');
  check(F.costHistory.codec.decodeHistory({exists:true,value:rejectedNode},{tenantId:T,bizId:B}).versions.every(v=>v.versionId!==id),'rejected version excluded from the effective timeline');
  results.push('owner rejection through rendered UI and real route; super_owner refused');
  await idle();await page.until(()=>page.document.querySelector('[data-f2="save"]:not([disabled])'),10000);
  const commitsBefore=commits;
  click(page.document.querySelector('[data-f2="save"]'));
  try{await page.until(()=>commits>commitsBefore,15000);}catch{throw Error('corrected successor did not commit: result='+textOf(page.document.querySelector('[data-f2="result"]')));}
  const afterSucc=(await node()).val();
  check(afterSucc.head.revision===rejectedNode.head.revision+1&&afterSucc.versions[afterSucc.head.headVersionId].predecessorVersionId===id&&afterSucc.review[id].state==='rejected','corrected successor continues the chain from the rejected head');
  results.push('corrected successor after rejection through rendered UI');
  // R4: a FLAGGED head is ACCEPTED by the owner through the rendered UI ⇒ stored cleared + decision audit accepted; the editor shows the acceptance
  const succId=afterSucc.head.headVersionId, sr=afterSucc.review[succId];
  const flaggedSucc=JSON.parse(JSON.stringify(afterSucc));flaggedSucc.review[succId]=flagEntry(sr,afterSucc.versions[succId],succId);
  await seedDb.ref(`tenants/${T}/biz:${B}:cost_history`).set(flaggedSucc);
  await page.until(()=>page.document.querySelector('[data-f2="flagged"]'),10000);await idle();
  const acceptButton=Array.from(page.document.querySelectorAll('[data-f2="cost-editor"] button')).find(b=>textOf(b)==='אשר לאחר בדיקה');
  check(acceptButton&&!acceptButton.disabled,'owner accept control rendered (enabled) for a flagged head');click(acceptButton);
  await page.until(()=>page.document.querySelector('[data-f2="accepted"]'),15000);
  const acceptedNode=(await node()).val(), ae=acceptedNode.review[succId];
  check(ae.state==='cleared'&&ae.decision==='accepted'&&ae.decisionAudit.decision==='accepted'&&ae.decisionAudit.resultingState==='cleared'&&ae.decisionAudit.decidedBy===UID&&typeof ae.decisionAudit.operationId==='string','owner acceptance stored as cleared + bound decision audit accepted');
  check(stable(ae.flagAudit)===stable(flaggedSucc.review[succId].flagAudit),'flag evidence retained through acceptance');
  check(F.costHistory.codec.decodeHistory({exists:true,value:acceptedNode},{tenantId:T,bizId:B}).state==='present','accepted history authoritative');
  check(textOf(page.document.querySelector('[data-f2="state"]')).includes('אושרה על ידי בעלים'),'editor label discloses the owner acceptance');
  results.push('owner acceptance through rendered UI and real route: cleared + accepted');
  // R4: a rejected ACTIVATION (every version rejected) withholds cost outputs until the owner explicitly re-activates
  const allRejected=JSON.parse(JSON.stringify(acceptedNode));
  for(const vid of Object.keys(allRejected.versions)) allRejected.review[vid]=reviewEntry(allRejected.versions[vid],'rejected');
  await seedDb.ref(`tenants/${T}/biz:${B}:cost_history`).set(allRejected);
  await page.until(()=>textOf(page.document.querySelector('[data-f2="state"]')).includes('נדרשת הפעלה מחדש'),10000);
  check(F.costHistory.codec.decodeHistory({exists:true,value:allRejected},{tenantId:T,bizId:B}).versions.length===0,'all-rejected history has no effective version');
  check(page.document.querySelector('[data-f2="activation-confirm"]'),'owner sees the explicit re-activation confirmation');
  await idle();const reCommits=commits;
  click(page.document.querySelector('[data-f2="activation-confirm"]'));
  await page.until(()=>page.document.querySelector('[data-f2="save"]:not([disabled])'),10000);
  click(page.document.querySelector('[data-f2="save"]'));
  try{await page.until(()=>commits>reCommits,15000);}catch{throw Error('re-activation did not commit: result='+textOf(page.document.querySelector('[data-f2="result"]')));}
  const reactivated=(await node()).val();
  check(reactivated.head.revision===allRejected.head.revision+1&&F.costHistory.codec.decodeHistory({exists:true,value:reactivated},{tenantId:T,bizId:B}).versions.length===1,'owner re-activation creates the single effective version over the rejected history');
  await page.until(()=>textOf(page.document.querySelector('[data-f2="state"]')).includes('פעילה')&&!textOf(page.document.querySelector('[data-f2="state"]')).includes('נדרשת'),10000);
  results.push('rejected activation withholds until the owner re-activates through the rendered UI');
  const malformed=JSON.parse(JSON.stringify(hist));malformed.head.revision=99;
  await seedDb.ref(`tenants/${T}/biz:${B}:cost_history`).set(malformed);
  await page.until(()=>page.document.querySelector('[data-f2="unreadable"]'),10000);
  check(!page.document.querySelector('[data-f2="save"]'),'unreadable history must withhold edits');
  results.push('corrupt history renders unavailable with no save');
  await seedDb.ref(`tenants/${T}/biz:${B}:cost_history`).set(hist);
  try{await ownerApp.database().ref(`tenants/${T}/biz:${B}:cost_history`).child('review').set({});throw Error('direct client forgery unexpectedly allowed');}
  catch(e){check(!String(e).includes('unexpectedly allowed'),'direct browser SDK write must be denied');}
  results.push('direct client write denied by real Rules');
  // R4: a NON-OWNER (manager) never SEES or INVOKES decision / re-activation controls — a second real page, real route
  const MGR='u_mgr', MUSER={uid:MGR,email:'mgr@demo.example',displayName:'mgr1'};
  await seedDb.ref(`tenants/${T}/members/${MGR}`).set(true);await seedDb.ref(`tenants/${T}/roles/${MGR}`).set('manager');await seedDb.ref(`tenants/${T}/biz_access/${B}/${MGR}`).set(true);
  await seedDb.ref(`tenants/${T}/app/users`).set(env([{id:1,username:'owner1',name:'Owner',email:USER.email,role:'owner',firebaseUid:UID},{id:2,username:'mgr1',name:'Manager',email:MUSER.email,role:'manager',firebaseUid:MGR}]));
  await seedDb.ref(`user_tenants/${MGR}`).set(T);await seedDb.ref(`user_active_biz/${MGR}`).set(B);await seedDb.ref('username_index/mgr1').set({tenantId:T,email:MUSER.email});
  await seedDb.ref(`tenants/${T}/biz:${B}:cost_history`).set(flaggedSucc);
  const mgrApp=admin.initializeApp({databaseURL:DB_URL,databaseAuthVariableOverride:{uid:MGR,token:{email:MUSER.email}}},'f2-mgr');
  globalThis.__F2_CLAIMS={uid:MGR,email:MUSER.email};
  mgrPage=await bootHistoricalPage({html,fincore:'ok',loadFincore:loadFinance,adminApp:mgrApp,user:MUSER,session:{[`marjin_tid_${MGR}`]:T,[`marjin_biz_${MGR}`]:B},signedIn:true,fetchImpl});
  mgrPage.window.TextEncoder=TextEncoder;
  await mgrPage.until(()=>mgrPage.document.querySelector('button[title="הוצאות קבועות"]'),20000);
  click(mgrPage.document.querySelector('button[title="הוצאות קבועות"]'));
  await mgrPage.until(()=>mgrPage.document.querySelector('[data-f2="flagged"]'),10000);
  const mgrButtons=()=>Array.from(mgrPage.document.querySelectorAll('[data-f2="cost-editor"] button')).map(textOf);
  check(!mgrPage.document.querySelector('[data-f2="reject-flag"]')&&!mgrButtons().includes('אשר לאחר בדיקה')&&!mgrPage.document.querySelector('[data-f2="save"]'),'manager sees no accept / reject / save control on a flagged head: '+mgrButtons().join(','));
  const mgrAccept=await fetchImpl('/api/cost-history',{method:'POST',body:JSON.stringify({action:'accept_flag',tenantId:T,bizId:B,versionId:succId,intentDigest:sr.intentDigest,operationId:'22222222-2222-4222-8222-222222222222'})});
  const mgrReject=await fetchImpl('/api/cost-history',{method:'POST',body:JSON.stringify({action:'reject_flag',tenantId:T,bizId:B,versionId:succId,intentDigest:sr.intentDigest,operationId:'33333333-3333-4333-8333-333333333333'})});
  check(mgrAccept.status===403&&mgrReject.status===403&&(await node()).val().review[succId].state==='flagged'&&!(await node()).val().review[succId].decision,'manager acceptance / rejection refused with 403 and no change');
  await seedDb.ref(`tenants/${T}/biz:${B}:cost_history`).set(allRejected);
  await mgrPage.until(()=>mgrPage.document.querySelector('[data-f2="activation-owner-only"]'),10000);
  check(!mgrPage.document.querySelector('[data-f2="save"]')&&!mgrPage.document.querySelector('[data-f2="activation-confirm"]'),'manager cannot re-activate a rejected activation from the rendered editor');
  const rv0=reactivated.versions[reactivated.head.headVersionId];
  const mgrActivate=await fetchImpl('/api/cost-history',{method:'POST',body:JSON.stringify({action:'activate',tenantId:T,bizId:B,body:{versionId:'44444444-4444-4444-8444-444444444444',expectedHead:allRejected.head,effectiveFrom:today,basis:'recorded',globalEmployees:rv0.globalEmployees,fixedItems:rv0.fixedItems,rent:rv0.rent,royalty:rv0.royalty}})});
  check(mgrActivate.status===403&&(await node()).val().head.revision===allRejected.head.revision,'manager re-activation refused by the route with no commit');
  check(mgrPage.console.errors.filter(e=>/ReferenceError|TypeError|Minified React error/.test(e)).length===0,'manager render runtime errors: '+mgrPage.console.errors.join(' | '));
  globalThis.__F2_CLAIMS={uid:UID,email:USER.email};
  await seedDb.ref(`tenants/${T}/biz:${B}:cost_history`).set(hist);
  results.push('non-owner never sees or invokes decision / re-activation controls (rendered + real route)');
  check(page.console.errors.filter(e=>/ReferenceError|TypeError|Minified React error/.test(e)).length===0,'render runtime errors: '+page.console.errors.join(' | '));
  if(results.length!==13)throw Error('scenario count '+results.length);
  console.log(JSON.stringify({status:'PASS',results,head:before.head}));
}finally{page.detach();if(mgrPage)mgrPage.detach();for(const a of admin.apps.filter(Boolean))await a.delete();}
