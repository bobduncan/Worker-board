import test from 'node:test'
import assert from 'node:assert/strict'
import {planAssignment,assignmentStatus,assignmentGuard,controllerRequest,routingHolds} from '../../src/work/routing/assignments.mjs'
import {parseRoutingPolicy} from '../../src/work/routing/policy.mjs'
const registry=Object.fromEntries(['haiku','sonnet','opus'].map(family=>[family,{model:`claude-${family}-5-5`,verified:true,efforts:['low','medium','high']}]))
const policy=parseRoutingPolicy({registry}).policy
const task={id:'B1',hash:'contract',risk:{class:'R2',factors:[]}}
test('setting timeouts, stale metadata and self-setting never release work',()=>{
  const a=planAssignment({task,policy,lane:{sessionId:'worker',controllerSessionId:'main'},now:1000})
  assert.equal(controllerRequest(a).to,'main')
  assert.equal(assignmentStatus({assignment:a,sessionSnapshot:null,now:2000,policy}).status,'setting')
  assert.equal(assignmentStatus({assignment:a,sessionSnapshot:null,now:122000,policy}).status,'held')
  assert.equal(assignmentStatus({assignment:a,sessionSnapshot:{sessionId:'worker',model:'claude-sonnet-5-5',effort:'medium',sampledAt:999},now:2000,policy}).status,'setting')
  assert.throws(()=>planAssignment({task,policy,lane:{sessionId:'worker',controllerSessionId:'worker'},now:1000}),/different/)
})
test('automatic delivery remains held for managed work even when the global mode is off',()=>{
  const item={head:new Map([['Id','B1'],['Kind','step'],['State','queued']]),sections:new Map([['Routing',[JSON.stringify({version:1,managed:true,assignments:[]})]]])}
  assert.equal(routingHolds([item],{ok:true,policy:{mode:'off'}}).has('B1'),true)
  assert.equal(routingHolds([{...item,sections:new Map()}],{ok:true,policy:{mode:'off'}}).has('B1'),false)
})
test('a verified configuration is ready but actual weaker execution is held',()=>{
  const a=planAssignment({task,policy,lane:{sessionId:'worker',controllerSessionId:'main'},now:1000})
  const snapshot={sessionId:'worker',model:'claude-sonnet-5-5',effort:'medium',sampledAt:2000}
  assert.equal(assignmentStatus({assignment:a,sessionSnapshot:snapshot,now:2000,policy}).status,'ready')
  const wrong=[{type:'assistant',at:1500,model:'claude-haiku-5-5',effort:'high',isSidechain:false}]
  assert.equal(assignmentStatus({assignment:a,sessionSnapshot:snapshot,actualEntries:wrong,now:2000,policy}).status,'held')
  assert.equal(assignmentGuard({record:{managed:true,assignments:[]},sessionId:'worker',operation:'take',policy}).ok,false)
  assert.equal(assignmentGuard({record:{managed:true,assignments:[]},sessionId:'worker',operation:'checkpoint',policy}).ok,true)
})
