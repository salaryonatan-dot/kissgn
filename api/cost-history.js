// F2 trusted cost-history command boundary. No browser RTDB write grant is introduced.
import { createProductionCostHistoryWriter } from '../lib/finance/costHistoryWriter.js';
import { requireBizContext } from '../lib/securityContext.js';

const ACTIONS = Object.freeze({
  activate: 'activateCostHistory',
  edit: 'recordCostEdit',
  attest: 'attestHistoricalCostEdit',
  accept_flag: 'acknowledgeFlaggedVersion',
});
const statusCode = (status) =>
  status === 'unauthenticated' ? 401 :
  status === 'unauthorized' || status === 'role_not_allowed' ? 403 :
  status === 'head_conflict' || status === 'review_unresolved' || status === 'identity_reused' || status === 'operation_identity_reused' ? 409 :
  status === 'outcome_unknown' || status === 'authorization_unavailable' || status === 'history_unavailable' || status === 'unreadable' || status.startsWith('history_unreadable') ? 503 :
  status === 'committed_current' || status === 'committed_superseded' || status === 'resolved' || status.startsWith('already_') || status === 'present' || status === 'absent' || status === 'reconciled' ? 200 : 400;

export default async function handler(req,res) {
  res.setHeader('Cache-Control','no-store');
  if(req.method!=='GET'&&req.method!=='POST') return res.status(405).json({status:'method_not_allowed'});
  const source=req.method==='GET'?req.query:req.body;
  const tenantId=source?.tenantId, bizId=source?.bizId;
  const writer=createProductionCostHistoryWriter();
  try {
    let result;
    if(req.method==='GET') result=await writer.readCostHistory(req,{tenantId,bizId});
    else {
      const action=source?.action;
      if(action==='reconcile') {
        const ctx=await requireBizContext(req,{tenantId,bizId,mode:'write'});
        if(ctx.role!=='owner') return res.status(403).json({status:'role_not_allowed'});
        const authorize=async()=>{
          const current=await requireBizContext(req,{tenantId,bizId,mode:'write'});
          if(current.uid!==ctx.uid||current.role!=='owner') throw Object.assign(new Error('current owner required'),{status:403});
        };
        result=await writer.reconcilePendingReviews({tenantId,bizId,authorize});
      } else if(action==='accept_flag') result=await writer.acknowledgeFlaggedVersion(req,{tenantId,bizId,versionId:source.versionId,intentDigest:source.intentDigest,operationId:source.operationId});
      else if(Object.prototype.hasOwnProperty.call(ACTIONS,action)) result=await writer[ACTIONS[action]](req,{tenantId,bizId,body:source.body});
      else return res.status(400).json({status:'action_invalid'});
    }
    return res.status(statusCode(result.status)).json(result);
  } catch(e) {
    return res.status(e?.status===401?401:e?.status===403?403:503).json({status:e?.status===401?'unauthenticated':e?.status===403?'unauthorized':'outcome_unknown'});
  }
}
