// R2 changes only the two Cost History capability checks from /2 to /3.
// The fixed pin in r2-candidate-pin.mjs supplies content identity in addition to this scope check.
import { diffHunks } from './c1-index-scope.mjs';

export function r2IndexVerdict(baseBytes, candidateBytes) {
  const base=Buffer.isBuffer(baseBytes)?baseBytes.toString('utf8'):String(baseBytes);
  const next=Buffer.isBuffer(candidateBytes)?candidateBytes.toString('utf8'):String(candidateBytes);
  const hunks=diffHunks(base,next).map(h=>[h.start,h.count]);
  if(JSON.stringify(hunks)!==JSON.stringify([[885,1],[1102,1]])) return {ok:false,reason:'r2_scope_changed',detail:hunks};
  const expected=base.replace('v.costHistory !== "MARJIN_COSTH/2"','v.costHistory !== "MARJIN_COSTH/3"')
    .replace('api.versions.costHistory !== "MARJIN_COSTH/2"','api.versions.costHistory !== "MARJIN_COSTH/3"');
  return next===expected?{ok:true}:{ok:false,reason:'r2_unapproved_page_content'};
}
