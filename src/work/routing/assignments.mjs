import {randomUUID} from 'node:crypto'
import {resolveRoute,meetsRoute,policyHash} from './policy.mjs'
import {readRoutingRecord} from './records.mjs'
import {enforcementReadiness} from './capabilities.mjs'

export function planAssignment({task,phase='implement',policy,lane,previous,now}){
  if(!lane?.sessionId||!lane.controllerSessionId||lane.sessionId===lane.controllerSessionId)throw Error('A different session must set the target model.')
  const chosen=resolveRoute({policy,phase,role:lane.role??'worker',contract:task,previousFloor:previous?.required,capabilities:lane.capabilities})
  return {id:randomUUID(),taskId:task.id,rootTaskId:task.rootTaskId??task.id,contractHash:task.hash,policyHash:policyHash(policy),profileHash:task.profileHash??null,attemptId:previous?.attemptId??randomUUID(),ownerSessionId:lane.sessionId,controllerSessionId:lane.controllerSessionId,phase,required:chosen.route,actual:null,status:chosen.ok?'proposed':'held',createdAt:now,expiresAt:now+policy.settingTimeoutMs,reason:chosen.why??chosen.reasons.join('; ')}
}
export function assignmentStatus({assignment:a,sessionSnapshot:s,actualEntries=[],now,policy}){
  if(a.status==='completed')return {status:'completed',actual:a.actual,reason:null}
  if(!a.required)return {status:'held',reason:a.reason??'Required route missing.'}
  if(a.status!=='running'&&now>a.expiresAt)return {status:'held',reason:'Setting confirmation timed out; work remains held.'}
  if(!s||s.sessionId!==a.ownerSessionId||s.archived||s.sampledAt<a.createdAt||!meetsRoute(s,a.required,policy.registry))return {status:'setting',reason:'Waiting for fresh model and effort confirmation.'}
  const actual=actualEntries.filter(e=>e.type==='assistant'&&!e.isSidechain&&e.at>=a.createdAt&&e.model).at(-1)
  if(actual&&!meetsRoute(actual,a.required,policy.registry))return {status:'held',reason:'Actual execution was below the assigned model or effort.'}
  return actual?{status:'running',actual:{model:actual.model,effort:actual.effort},reason:null}:{status:'ready',actual:null,reason:null}
}
export function assignmentGuard({record,sessionId,operation,snapshot,policy}){
  if(['checkpoint','pause','route-state','list','read'].includes(operation))return {ok:true}
  if(!record?.managed)return {ok:true}
  const a=record.assignments?.findLast(one=>one.ownerSessionId===sessionId&&one.status!=='completed')
  if(!a)return {ok:false,why:'Managed work has no confirmed assignment for this session.'}
  if(!['ready','running'].includes(a.status))return {ok:false,why:a.reason??'Assigned model not confirmed.'}
  if(operation!=='take'&&a.status!=='running')return {ok:false,why:'Actual model and effort must be observed before changing managed work.'}
  if(!policy||!snapshot||snapshot.sessionId!==sessionId||snapshot.sampledAt<a.createdAt||!meetsRoute(snapshot,a.required,policy.registry))return {ok:false,why:'Fresh session settings do not satisfy the assignment.'}
  return {ok:true,assignment:a}
}
export function controllerRequest(a){return {to:a.controllerSessionId,command:'model-route',about:a.taskId,key:`route ${a.id}`,text:['set route',`Assignment: ${a.id}`,`Session: ${a.ownerSessionId}`,`Model: ${a.required?.model??'unknown'}`,`Effort: ${a.required?.effort??'unknown'}`,`Why: ${a.reason}`].join('\n')}}
export function routingHolds(items,parsed,capabilities=null){
  const held=new Set()
  for(const item of items){
    if(item.head.get('Kind')!=='step'||['done','dropped'].includes(item.head.get('State')))continue
    const read=readRoutingRecord(item),managed=read.ok&&read.record.managed
    if(!read.ok||parsed?.ok===false||managed||parsed?.policy?.mode==='enforce'){
      const assignment=read.ok?read.record.assignments.at(-1):null
      if(!enforcementReadiness(capabilities).ok||!assignment||!['ready','running'].includes(assignment.status))held.add(item.head.get('Id'))
    }
  }
  return held
}
