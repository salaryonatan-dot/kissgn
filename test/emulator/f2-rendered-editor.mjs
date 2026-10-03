// F2 rendered editor + trusted command over the real local RTDB emulator. No external project.
import admin from 'firebase-admin';
import {readFileSync,mkdtempSync,cpSync,mkdirSync,writeFileSync,symlinkSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join,dirname} from 'node:path';
import {fileURLToPath,pathToFileURL} from 'node:url';
import {TextEncoder} from 'node:util';
import {bootHistoricalPage,depsStatus,click,textOf} from '../historical/historical-page-harness.mjs';
import {loadFinance} from '../support/c1-seam.mjs';

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
    if(req.method==='POST')console.log('F2_POST',req.body?.action,res.code,res.body?.status,res.body?.detail||res.body?.reason||'');
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
const node=()=>seedDb.ref(`tenants/${T}/biz:${B}:cost_history`).once('value');
const results=[];
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
  const malformed=JSON.parse(JSON.stringify(hist));malformed.head.revision=99;
  await seedDb.ref(`tenants/${T}/biz:${B}:cost_history`).set(malformed);
  await page.until(()=>page.document.querySelector('[data-f2="unreadable"]'),10000);
  check(!page.document.querySelector('[data-f2="save"]'),'unreadable history must withhold edits');
  results.push('corrupt history renders unavailable with no save');
  await seedDb.ref(`tenants/${T}/biz:${B}:cost_history`).set(hist);
  try{await ownerApp.database().ref(`tenants/${T}/biz:${B}:cost_history`).child('review').set({});throw Error('direct client forgery unexpectedly allowed');}
  catch(e){check(!String(e).includes('unexpectedly allowed'),'direct browser SDK write must be denied');}
  results.push('direct client write denied by real Rules');
  check(page.console.errors.filter(e=>/ReferenceError|TypeError|Minified React error/.test(e)).length===0,'render runtime errors: '+page.console.errors.join(' | '));
  console.log(JSON.stringify({status:'PASS',results,head:before.head}));
}finally{page.detach();await ownerApp.delete();await seedApp.delete();}
