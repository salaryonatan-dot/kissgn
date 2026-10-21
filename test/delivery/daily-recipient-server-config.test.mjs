// Owner scope amendment 2026-10-20 17:31. Actual module + routes/Builder/admission, fake persistence/SMTP only.
import {test,after} from 'node:test';import assert from 'node:assert/strict';import {rmSync} from 'node:fs';
import {buildSandbox,seedWorld,installSmtp,SMTP,freezeClock,runCron,runManual,captureConsole,T,B,B2,T2,B3} from '../support/daily-email-harness.mjs';
const KEY='MARJIN_DAILY_RECIPIENTS_JSON',initial=process.env[KEY],S=await buildSandbox(),M=await S.import('src/server/dailyRecipientConfig.js'),E=await S.import('lib/emailDelivery.js');
after(()=>{if(initial===undefined)delete process.env[KEY];else process.env[KEY]=initial;rmSync(S.dir,{recursive:true,force:true});});
const AT=Date.UTC(2026,8,8,4,5),D='2026-09-08',C=`tenants/${T}/biz:${B}:config`,roots=['email_delivery','email_delivery_manual','email_delivery_admission','delivery_control'];
const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
const configure=x=>{if(x===undefined)delete process.env[KEY];else process.env[KEY]=typeof x==='string'?x:JSON.stringify(x);};
const valid=email=>[[T,B,email]];
const state=db=>Object.fromEntries(roots.map(p=>[p,clone(db.read(p))]));
const setup=()=>seedWorld({withSecondBiz:false,withSecondTenant:false});
async function call(lane){const restore=freezeClock(AT);try{return (await captureConsole(()=>lane==='scheduled'?runCron(S.route):runManual(S.route)));}finally{restore();}}
const code=(lane,r)=>lane==='scheduled'?r.body.results[0].code:r.body.code;
const look=(raw,t=T,b=B)=>{configure(raw);return M.resolveDailyRecipient(t,b);};
test('SC-01 exact pair lookup; colon tenant, case/space distinction and pair boundaries; no identity normalization',()=>{
 const rows=[[T,B,'a@example.test'],[T,B2,'b@example.test'],[T2,B,'c@example.test'],['acme:il','bizX','d@example.test'],[' '+T,B,'space@example.test']];
 for(const [t,b,email]of rows)assert.deepEqual(look(rows,t,b),{ok:true,email,selection:'server_configured'});
 for(const [t,b]of [[T.toUpperCase(),B],[T,B+' '],[T+' ',B],['acme','ilbizX']])assert.equal(look(rows,t,b).code,'no_recipient');
 for(const [t,b]of [[7,B],[T,null],['bad/id',B],[T,'bad:biz'],['a\n',B]])assert.equal(look(rows,t,b).code,'recipient_data_invalid');
});
test('SC-02 complete strict tuple schema; duplicate/conflicting pairs never select a winner, including after matching row',()=>{
 const good=valid('a@example.test');
 for(const raw of [undefined,'',' ',null,7,{},'{}','null','[','{"tenant":"a","tenant":"b"}',[{}],[null],[[T,B]],[[T,B,'a@example.test','extra']],[[7,B,'a@example.test']],[[T,{},'a@example.test']],[[T,B,'a@example.test'],[T,B,'a@example.test']],[[T,B,'a@example.test'],[T,B,'b@example.test']],[[T,B,'a@example.test'],['bad/id',B,'x@example.test']]]){const out=look(raw);assert.equal(out.ok,false,JSON.stringify(raw));}
 assert.equal(look([]).code,'no_recipient');assert.equal(look([...good,[T2,B,'bad']]).code,'recipient_invalid','invalid unmatched row invalidates complete config');
});
for(const lane of ['scheduled','manual']){
 test('SC-03 '+lane+' explicit per-business recipient uses actual Builder; RTDB user/recipient data grants no eligibility',async()=>{
  const db=setup();configure(valid('configured@example.test'));db.seed(`tenants/${T}/app/users`,{_v:'malformed-user-evidence'});const raw={_v:'{"businessName":"Synthetic","dailyRecipientEmail":"a@example.test","dailyRecipientEmail":"b@example.test"}',dailyRecipientEmail:'outside@example.test'};db.seed(C,raw);const smtp=installSmtp([SMTP.accept()]);const {value:r,logs}=await call(lane);assert.equal(r.statusCode,200);assert.deepEqual(smtp.calls.map(x=>x.to),['configured@example.test']);assert.deepEqual(db.read(C),raw);assert.ok(!JSON.stringify([r.body,logs]).includes('configured@example.test'));
 });
 test('SC-04 '+lane+' server configuration missing/malformed/unmapped refuses visibly with no state/budget/config writes',async()=>{
  for(const [raw,want,http]of [[undefined,'recipient_unavailable',503],['','recipient_unavailable',503],['[','recipient_data_invalid',422],[[[T,B,'a@example.test'],[T,B,'b@example.test']],'recipient_data_invalid',422],[[],'no_recipient',404],[[[T,B,'bad']],'recipient_invalid',422]]){
   const db=setup();configure(raw);const before=state(db),config=clone(db.read(C));const smtp=installSmtp([SMTP.accept()]);const {value:r}=await call(lane);assert.equal(r.statusCode,lane==='scheduled'?500:http);assert.equal(code(lane,r),want);assert.equal(smtp.calls.length,0);assert.deepEqual(state(db),before);assert.deepEqual(db.read(C),config);if(lane==='scheduled'){assert.equal(r.body.successCount,0);assert.equal(r.body.results[0].receipt,'not_written');}else assert.match(r.body.error,/deployment operator/);
  }
 });
 test('SC-05 '+lane+' RTDB designation create/change/delete/corrupt cannot redirect or populate missing server eligibility',async()=>{
  for(const evidence of [undefined,null,'redirect@example.test',['a@example.test','b@example.test'],{},'bad'])for(const configured of [true,false]){
   const db=setup(),base=JSON.parse(db.read(C)._v);if(evidence!==undefined)base.dailyRecipientEmail=evidence;db.seed(C,{_v:JSON.stringify(base)});configure(configured?valid('configured@example.test'):[]);const before=clone(db.read(C)),smtp=installSmtp([SMTP.accept()]);const {value:r}=await call(lane);assert.equal(smtp.calls.length,configured?1:0);if(configured)assert.equal(smtp.calls[0].to,'configured@example.test');else assert.equal(code(lane,r),'no_recipient');assert.deepEqual(db.read(C),before);
  }
 });
 test('SC-06 '+lane+' exact restricted address syntax and placeholder exclusion, no lists/Unicode/normalization',async()=>{
  for(const email of ['bad','A <x@example.test>','x@example.test,y@example.test',' x@example.test','x@example.test\nBcc:bad@example.test','י@example.test','x@דוגמה.test','x@localhost','a'.repeat(65)+'@example.test','x@temp.marjin.app']){
   setup();configure(valid(email));const smtp=installSmtp([SMTP.accept()]);const {value:r}=await call(lane);assert.equal(smtp.calls.length,0);assert.equal(code(lane,r),'recipient_invalid');
  }
 });
 test('SC-07 '+lane+' complete configuration and unmatched mappings never enter responses/logs',async()=>{
  setup();const canary='private-config-canary@example.test',tenant='private-config-tenant';configure([...valid('configured@example.test'),[tenant,'privateBusiness',canary]]);const smtp=installSmtp([SMTP.accept()]);const {value:r,logs}=await call(lane);assert.equal(smtp.calls.length,1);const text=JSON.stringify([r.body,logs]);for(const secret of [canary,tenant,process.env[KEY],'configured@example.test'])assert.ok(!text.includes(secret));
 });
}
test('SC-08 configuration changes cannot bypass accepted/unknown/in-progress for all four path orders',async()=>{
 for(const from of ['scheduled','manual'])for(const to of ['scheduled','manual'])for(const status of ['accepted','unknown','in_flight']){
  const db=setup();configure(valid('old@example.test'));const A=E.admissionPath('daily_snapshot',T,B,D);let smtp;
  if(status==='in_flight'){await db.ref(A).set(E.decideAdmission(null,{ids:{kind:'daily_snapshot',tenantId:T,bizId:B,businessDate:D},route:from,ref:'synthetic-live-ref',nowMs:AT,attempt:1}).next);smtp=installSmtp([SMTP.accept()]);}
  else{smtp=installSmtp([status==='accepted'?SMTP.accept():SMTP.closedAfterData()]);await call(from);assert.equal(smtp.calls.length,1);assert.equal(db.read(A).state,status);}
  const before=clone(db.read(A)),n=smtp.calls.length;configure(valid('new@example.test'));db.seed(C,{_v:'{"dailyRecipientEmail":"ignored@example.test"}'});await call(to);assert.equal(smtp.calls.length,n);assert.deepEqual(db.read(A),before);
 }
});
test('SC-09 refusal does not consume retry budget; configuration changes do not reset three-attempt budget',async()=>{
 const db=setup();configure([]);let smtp=installSmtp([SMTP.accept()]);await call('scheduled');assert.equal(smtp.calls.length,0);assert.equal(db.read(E.receiptPath('daily_snapshot',T,B,D)),null);
 configure(valid('first@example.test'));smtp=installSmtp([SMTP.transient(),SMTP.transient(),SMTP.transient(),SMTP.accept()]);await call('scheduled');assert.equal(smtp.calls.length,2);configure(valid('second@example.test'));await call('scheduled');configure(valid('third@example.test'));await call('scheduled');assert.equal(smtp.calls.length,3);assert.equal(db.read(E.receiptPath('daily_snapshot',T,B,D)).attempt,3);assert.deepEqual(smtp.calls.map(x=>x.to),['first@example.test','first@example.test','second@example.test']);
});
test('SC-10 holds remain fail-closed before and after source changes; ordinary manual deliverWithoutReceipt has no scheduled receipt',async()=>{
 for(const lane of ['scheduled','manual']){const db=setup();configure(valid('first@example.test'));db.seed('delivery_control/daily_snapshot',{bad:'shape'});const smtp=installSmtp([SMTP.accept()]);await call(lane);configure(valid('second@example.test'));await call(lane);assert.equal(smtp.calls.length,0);assert.equal(db.read(E.admissionPath('daily_snapshot',T,B,D)),null);}
 const db=setup();configure(valid('manual@example.test'));const smtp=installSmtp([SMTP.accept()]);const {value:r}=await call('manual');assert.equal(r.statusCode,200);assert.equal(smtp.calls.length,1);assert.equal(db.read(E.receiptPath('daily_snapshot',T,B,D)),null);
});
test('SC-11 scheduled multi-business/tenant mapping uses exact Builder targets and distinct configured addresses',async()=>{
 const db=seedWorld();configure([[T,B,'a@example.test'],[T,B2,'b@example.test'],[T2,B3,'c@example.test']]);const smtp=installSmtp([SMTP.accept()]);const {value:r}=await call('scheduled');assert.equal(r.statusCode,200);assert.deepEqual(smtp.calls.map(x=>x.to).sort(),['a@example.test','b@example.test','c@example.test']);for(const [t,b]of [[T,B],[T,B2],[T2,B3]])assert.equal(db.read(E.admissionPath('daily_snapshot',t,b,D)).state,'accepted');
});
