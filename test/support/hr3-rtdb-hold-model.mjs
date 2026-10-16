// Offline model of RTDB's null / empty-container elision on the hold subtree only.
// This is a serialization regression seam, not transport / emulator coverage. Receipts and provider seams are unchanged.
export function rtdbHoldValue(value) {
  if (value == null) return null;
  if (typeof value !== 'object') return value;
  const entries = Object.entries(value).map(([k,v]) => [k,rtdbHoldValue(v)]).filter(([,v]) => v !== null);
  if (!entries.length) return null;
  return Array.isArray(value) ? Object.assign([],Object.fromEntries(entries)) : Object.fromEntries(entries);
}
export function withRtdbHoldSerialization(db) {
  const seed=db.seed,ref=db.ref;
  const hold=p=>String(p).startsWith('delivery_control/');
  db.seed=(p,v)=>seed(p,hold(p)?rtdbHoldValue(v):v);
  db.ref=(p,q)=>{
    const x=ref(p,q);if(!hold(p))return x;
    return {...x,set:v=>x.set(rtdbHoldValue(v)),update:v=>x.update(rtdbHoldValue(v)),
      transaction:fn=>x.transaction(cur=>{const next=fn(cur);return next===undefined?undefined:rtdbHoldValue(next);})};
  };
  return db;
}
