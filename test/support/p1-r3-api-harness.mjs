// Actual API + domain + repository; only token verification, email and Admin construction are seams.
import {mkdtempSync,cpSync,mkdirSync,symlinkSync,writeFileSync} from 'node:fs';
import {tmpdir} from 'node:os';
import {join} from 'node:path';
import {pathToFileURL,fileURLToPath} from 'node:url';
export const ROOT=fileURLToPath(new URL('../../',import.meta.url));
export const clone=x=>x===undefined?undefined:JSON.parse(JSON.stringify(x));
export const T='tenantA',B='bizA',NODE=`tenants/${T}/biz:${B}:supplier_credits`;
export const cid=n=>`c0000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const oid=n=>`0a000000-0000-4000-8000-${String(n).padStart(12,'0')}`;
export const env=x=>({_v:JSON.stringify(x)});
export function seed(){return {tenants:{tenantA:{members:{own:true,mgr:true,super:true,view:true},roles:{own:'owner',mgr:'manager',super:'super_owner',view:'viewer'},
 biz_access:{bizA:{mgr:true,view:true},ghost:{mgr:true}},app:{business:env([{id:B},{id:'bizB'}])},
 'biz:bizA:suppliers':env([{id:'s1'},{id:'s2'}]),'biz:bizB:suppliers':env([{id:'s1'}]),'biz:ghost:suppliers':env([{id:'s1'}])},
 tenantB:{members:{foreign:true},roles:{foreign:'owner'},app:{business:env([{id:'foreignBiz'}])}}}};}
export function memoryDb(initial=seed()){
 let data=clone(initial);const db={reads:[],writes:[],beforeGet:null,beforeTransaction:null,afterTransaction:null};
 db.value=()=>clone(data);db.read=p=>clone(p.split('/').filter(Boolean).reduce((v,k)=>v?.[k],data)??null);
 db.put=(p,value)=>{const keys=p.split('/').filter(Boolean);if(!keys.length){data=clone(value);return;}let v=data;for(const k of keys.slice(0,-1))v=v[k]??={};if(value===null)delete v[keys.at(-1)];else v[keys.at(-1)]=clone(value);};
 const snap=v=>({val:()=>clone(v),exists:()=>v!==null&&v!==undefined});
 db.ref=p=>({get:async()=>{db.reads.push(p);await db.beforeGet?.(p,db);return snap(db.read(p));},once:async()=>db.ref(p).get(),
 set:async v=>db.put(p,v),update:async o=>{for(const[k,v]of Object.entries(o))db.put(p+'/'+k,v);},
 transaction:async fn=>{await db.beforeTransaction?.(p,db);const value=fn(db.read(p));if(value===undefined)return {committed:false};db.put(p,value);db.writes.push(p);await db.afterTransaction?.(p,db);return {committed:true,snapshot:snap(value)};}});
 return db;
}
export async function apiHarness(db=memoryDb()){
 const dir=mkdtempSync(join(tmpdir(),'p1r3-api-'));for(const f of ['lib','fincore'])cpSync(join(ROOT,f),join(dir,f),{recursive:true});
 mkdirSync(join(dir,'api'));cpSync(join(ROOT,'api/admin.js'),join(dir,'api/admin.js'));symlinkSync(join(ROOT,'node_modules'),join(dir,'node_modules'),'dir');
 const key=dir;globalThis[key]=db;
 writeFileSync(join(dir,'lib/adminSdk.js'),`export function getAdminDb(){return globalThis[${JSON.stringify(key)}]} export function getAdminAuth(){return {getUser:async()=>({})}}`);
 writeFileSync(join(dir,'lib/verifyToken.js'),'export async function requireAuth(req){if(!req.__claims)throw Error("no auth");return req.__claims} export async function verifyToken(){return null}');
 writeFileSync(join(dir,'lib/sendEmail.js'),'export async function sendEmail(){} export async function sendAlertDigest(){}');
 const handler=(await import(pathToFileURL(join(dir,'api/admin.js')))).default;
 return {db,call:async(action,body={},actor='mgr',method='POST')=>{const res={code:0,body:null,setHeader(){},status(n){this.code=n;return this},json(v){this.body=v;return this}};
  await handler({method,query:{action,...(method==='GET'?body:{})},body,headers:{},__claims:actor?{uid:actor,email:actor+'@example.test'}:null},res);return res;}};
}
export const createBody=(n=1,extra={})=>({tenantId:T,bizId:B,creditId:cid(n),operationId:oid(n),supplierId:'s1',issueDate:'2026-10-01',amount:'10',documentNumber:'CR-'+n,...extra});
