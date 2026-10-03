// F2 page scope is bounded to the capability checks, cost editor, finance settings write
// interception and global employee write interception. Full byte identity is a separate pin.
import {diffHunks} from './c1-index-scope.mjs';
const HUNKS=[[885,1],[1102,1],[5246,1],[5371,0],[5379,1],[5384,1],[5389,1],[5400,1],[5406,1],[5520,0],[5528,1],[5690,0],[7381,0],[7393,0],[7401,1],[7417,1],[7543,48],[9111,1],[9141,1],[9194,1],[9350,1],[9405,0],[9413,2],[9495,0],[9502,1],[9505,1],[9508,1],[9512,1]];
export function f2IndexVerdict(baseBytes,candidateBytes){
  const base=Buffer.isBuffer(baseBytes)?baseBytes.toString('utf8'):String(baseBytes);
  const next=Buffer.isBuffer(candidateBytes)?candidateBytes.toString('utf8'):String(candidateBytes);
  const hunks=diffHunks(base,next).map(h=>[h.start,h.count]);
  if(JSON.stringify(hunks)!==JSON.stringify(HUNKS))return {ok:false,reason:'f2_scope_changed',detail:hunks};
  if(!next.includes('v.costHistory !== "MARJIN_COSTH/4"')||!next.includes('api.versions.costHistory !== "MARJIN_COSTH/4"'))return {ok:false,reason:'f2_capability_missing'};
  if(!next.includes('data-f2="cost-editor"')||!next.includes('financeLocked={finRaw.bizId!==currentBizId || finRaw.costHistory.kind!=="absent"}'))return {ok:false,reason:'f2_editor_gate_missing'};
  return {ok:true};
}
