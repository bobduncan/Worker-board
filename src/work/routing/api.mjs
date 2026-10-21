import {readItemFile,writeItem,appendHistory} from '../store.mjs'
import {valueOf} from '../item.mjs'
import {validateContract,contractHash,contractOf} from './contract.mjs'
import {readRoutingRecord,writeRoutingSections} from './records.mjs'
import {resolveRoute,meetsRoute,FAMILIES,EFFORTS} from './policy.mjs'
import {assignmentGuard,assignmentStatus,planAssignment,controllerRequest} from './assignments.mjs'
import {candidateOfSubmission,validateReview,candidateStatus} from './candidates.mjs'
import {enforcementReadiness} from './capabilities.mjs'

export const ROUTING_ACTIONS=['contract','route-raise','route-confirm','submit','candidate-review','integrate','quality-job-result']
export const ROUTING_READS=['route-state']
const refuse=(status,why)=>({ok:false,status,why})
const safe=new Set(['next','list','route-state','pause-state','pause-all','resume-all','resumed','end-resume','note','ask','withdraw','answered-in-chat','read','instruction','turn-ended','seen'])
const boundary=new Set(['take','report','check','checked','advance','tick','overturn','close','drop','unblock','delete','requeue','unqueue','queue','refined','refine','refine-text','refine-accept'])
const done=(text,extra={})=>({ok:true,result:{text,changed:false,...extra}})

export async function routingAction(body,w){
  const isOurs=ROUTING_ACTIONS.includes(body.action)||ROUTING_READS.includes(body.action)
  const parsed=w.routingPolicy??{ok:true,policy:{mode:'off'}},enforce=parsed.ok&&parsed.policy.mode==='enforce'
  if(!isOurs&&safe.has(body.action))return null
  if(typeof body.id!=='string'||!/^B\d+$/.test(body.id)){
    if(body.action==='route-state')return done('Routing readiness.',{routing:{mode:parsed.policy?.mode??'invalid',readiness:enforcementReadiness(w.routingCapabilities)}})
    return isOurs?refuse(400,'Name a task ID, B followed by digits.'):null
  }
  const found=await readItemFile(w.dir,body.id,w.fs)
  if(!found)return isOurs?refuse(404,`${body.id}: no such task.`):null
  const read=readRoutingRecord(found.item)
  if(!read.ok)return refuse(409,read.why)
  const record=read.record,policy=record.managed?record.policy:parsed.policy
  const managed=record.managed||enforce
  const snapshot=w.sessionOf?.(w.who)??null
  const owner=valueOf(found.item,'Owner'),isOwner=owner===w.who||owner===`${w.prefix??''}${w.who}`
  const save=async(text)=>{
    const item=appendHistory(writeRoutingSections(found.item,record),w.who,text,w.now)
    const result=await writeItem(w.dir,item,w.fs,{expected:found.text})
    return result.ok?{ok:true,result:{text,changed:true,id:body.id,routing:{managed:record.managed,assignments:record.assignments,candidates:record.candidates}}}:result
  }
  if(body.action==='route-state')return done(`${body.id}: ${record.managed?'managed':'legacy / observed'} routing.`,{routing:{...record,mode:parsed.policy?.mode??'invalid',readiness:enforcementReadiness(w.routingCapabilities)}})
  if(!isOurs){
    if(!managed)return parsed.ok===false&&boundary.has(body.action)?refuse(409,'Routing policy is invalid; execution is held.'):null
    if(body.action==='step'&&(body.commit!==undefined||body.next!==undefined))return null
    if(!boundary.has(body.action)&&body.action!=='step')return null
    if(!enforcementReadiness(w.routingCapabilities).ok)return refuse(409,enforcementReadiness(w.routingCapabilities).why)
    const contract=contractOf(found.item);if(!contract.ok)return refuse(409,contract.why)
    if(['advance','check','checked','tick','overturn','close','unblock'].includes(body.action)){
      const candidate=record.candidates.at(-1)
      if(!candidate||candidate.integration?.status!=='completed'||!candidateStatus({candidate,currentFacts:{contractHash:contract.contract.hash,policyHash:record.policyHash,profileHash:candidate.profileHash,components:candidate.components}}).approved)return refuse(409,'Managed quality checks, independent review and integration are not complete.')
      return null
    }
    const allowed=assignmentGuard({record:{...record,managed:true},sessionId:snapshot?.sessionId,operation:body.action,snapshot,policy})
    return allowed.ok?null:refuse(409,allowed.why)
  }
  if(body.action==='contract'){
    if(w.role!=='advisor')return refuse(403,'An eligible Advisor or helper approves specifications.')
    const validated=validateContract(body.contract);if(!validated.ok)return refuse(400,validated.why)
    const required=resolveRoute({policy:parsed.policy,phase:'spec',role:'reviewer',contract:body.contract}).route
    if(!required||!snapshot||!meetsRoute(snapshot,required,parsed.policy.registry))return refuse(409,'The observed specification approver does not meet its model/effort floor.')
    if(record.contract&&body.expectedContractHash!==record.contract.hash)return refuse(409,'The contract changed; read its current hash before amending it.')
    if(record.assignments.some(a=>a.ownerSessionId===snapshot.sessionId&&a.phase==='implement'))return refuse(409,'An implementer cannot approve its own specification amendment.')
    const next=validated.contract
    if(next.implementationPlan){
      if(typeof w.verifyImplementationPlan!=='function')return refuse(409,'Saved implementation-plan approval cannot be independently verified.')
      const verified=await w.verifyImplementationPlan(next.implementationPlan,snapshot);if(!verified?.ok)return refuse(409,verified?.why??'Implementation plan is not approved.');next.implementationPlan=verified.plan
    }
    next.approvedBy=snapshot.sessionId;next.approvedAt=w.now;next.hash=contractHash(next);record.contract=next
    record.assignments=record.assignments.map(a=>({...a,status:'held',reason:'Contract amended; confirmation required.'}));record.candidates=record.candidates.map(c=>({...c,review:null,checks:null,integration:null}))
    return save('Approved task contract; prior candidate approvals invalidated.')
  }
  if(body.action==='route-raise'){
    if(!isOwner&&!['main','advisor'].includes(w.role))return refuse(403,'Only the owner, Main or Advisor raises a route.')
    if(!FAMILIES.includes(body.family)||!EFFORTS.includes(body.effort)||['xhigh','max'].includes(body.effort))return refuse(400,'Choose haiku, sonnet or opus with low, medium or high effort.')
    const a=record.assignments.at(-1);if(!a)return refuse(409,'There is no assignment to raise.')
    const proposed={family:body.family,model:policy.registry[body.family].model,effort:body.effort}
    if(!meetsRoute(proposed,a.required,policy.registry))return refuse(409,'A route cannot be lowered during an attempt.')
    a.required=proposed;a.status='setting';a.actual=null;a.createdAt=w.now;a.expiresAt=w.now+120000;a.reason='Higher route requested.'
    return save('Raised model/effort; waiting for confirmation.')
  }
  if(!managed)return refuse(409,'Candidate execution requires an enforced managed assignment; observe mode makes no execution changes.')
  if(!enforcementReadiness(w.routingCapabilities).ok)return refuse(409,enforcementReadiness(w.routingCapabilities).why)
  if(body.action==='route-confirm'){
    if(w.role!=='server')return refuse(403,'Only the board confirms observed settings.')
    const current=contractOf(found.item);if(!current.ok)return refuse(409,current.why)
    const target=w.sessionOf?.(owner);if(!target)return refuse(409,'Owner session metadata is unavailable.')
    record.managed=true;record.policy??=parsed.policy;record.policyHash??=parsed.hash
    let a=record.assignments.at(-1)
    if(!a){try{a=planAssignment({task:{...current.contract,id:body.id},phase:'implement',policy:record.policy,lane:{...target,capabilities:w.routingCapabilities},now:w.now})}catch(error){return refuse(409,error.message)}record.assignments.push(a)}
    Object.assign(a,assignmentStatus({assignment:a,sessionSnapshot:target,actualEntries:target.actualEntries??[],now:w.now,policy:record.policy}))
    const saved=await save(`Assignment ${a.status}.`);if(saved.ok&&a.status==='setting')saved.result.controller=controllerRequest(a);return saved
  }
  const current=contractOf(found.item);if(!current.ok)return refuse(409,current.why)
  if(body.action==='submit'){
    if(!isOwner)return refuse(403,'Only the owner submits a candidate.')
    const guard=assignmentGuard({record,sessionId:snapshot?.sessionId,operation:'submit',snapshot,policy});if(!guard.ok)return refuse(409,guard.why)
    const made=candidateOfSubmission({body,contract:current.contract,assignment:guard.assignment,gitFacts:w.candidateFacts,authorSessions:w.implementationSessions??[snapshot.sessionId]});if(!made.ok)return refuse(409,made.why)
    record.candidates.push(made.candidate);return save('Candidate submitted; validation and independent review required.')
  }
  const candidate=record.candidates.at(-1);if(!candidate)return refuse(409,'No candidate has been submitted.')
  if(body.action==='candidate-review'){
    if(w.role!=='advisor')return refuse(403,'An eligible independent Advisor/helper reviews the candidate.')
    if(body.candidateId!==candidate.id)return refuse(409,'Candidate changed; read the current candidate ID.')
    const floor=resolveRoute({policy,phase:'review',role:'reviewer',contract:current.contract}).route
    const checked=validateReview({candidate,review:{...body.review,reviewerSessionId:snapshot?.sessionId,actual:snapshot},contract:current.contract,actor:{sessionId:snapshot?.sessionId},reviewFloor:floor,registry:policy.registry});if(!checked.ok)return refuse(409,checked.why)
    candidate.review=checked.review;return save('Independent candidate review approved.')
  }
  if(body.action==='quality-job-result'){
    if(w.role!=='server'||!w.verifiedJobResult||body.candidateId!==candidate.id)return refuse(403,'Only a verified current board-run job can record validation or integration.')
    if(w.verifiedJobResult.kind==='validation')candidate.checks=w.verifiedJobResult.record
    else if(w.verifiedJobResult.kind==='integration')candidate.integration=w.verifiedJobResult.record
    else return refuse(400,'Unknown quality job.')
    return save('Recorded exact-candidate job result.')
  }
  if(body.action==='integrate'){
    if(!isOwner)return refuse(403,'Only the owner requests integration.')
    const status=candidateStatus({candidate,currentFacts:w.currentCandidateFacts});if(!status.approved)return refuse(409,status.reasons.join('; '))
    if(typeof w.queueIntegration!=='function')return refuse(503,'The guarded integration runner is not configured; work remains held.')
    candidate.integration={status:'queued',candidateId:candidate.id};const saved=await save('Approved integration queued.');if(saved.ok)saved.result.qualityJob={kind:'integration',candidateId:candidate.id};return saved
  }
  return refuse(400,'Unsupported routing action.')
}
