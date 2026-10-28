import test from 'node:test'
import assert from 'node:assert/strict'
import {attributeUsage,routingSummary,estimateUsage,spendingCsv} from '../../src/work/routing/metrics.mjs'
const at=Date.UTC(2026,9,21,12)
const entry=(id,usage,extra={})=>({type:'assistant',messageId:id,at,model:'claude-sonnet-5-5',effort:'medium',usage,blocks:[],...extra})
test('streamed usage and copied fork history count once while observed usage increases are retained',()=>{
  const first=attributeUsage({entries:[entry('one',{input:100,cacheRead:1000,cacheWrite:0,output:20}),entry('one',{input:100,cacheRead:1000,cacheWrite:0,output:40})],sourceSessionId:'s',chat:'Worker',role:'worker'})
  assert.equal(first.events.length,1)
  assert.equal(first.events[0].output,40)
  const again=attributeUsage({entries:[entry('one',{input:100,cacheRead:1000,cacheWrite:0,output:40})],sourceSessionId:'fork',chat:'Worker copy',previous:first.events})
  assert.equal(again.events.length,1)
  assert.equal(again.events[0].sourceSessionId,'s')
})
test('prices distinguish cached reads and unknown model costs never become zero',()=>{
  const known=estimateUsage({actualModel:'claude-sonnet-5-5',input:1000000,cacheRead:1000000,cacheWrite:0,output:1000000})
  assert.equal(known.low,12.1)
  assert.equal(estimateUsage({actualModel:'unlisted',input:100}).known,false)
  assert.equal(estimateUsage({actualModel:'claude-sonnet-5-5',input:null,cacheRead:0,cacheWrite:0,output:100}).known,false)
})
test('all-in spending includes reviewers and failed work and keeps unattributed usage visible',()=>{
  const events=[{taskId:'B1',chat:'Worker',phase:'implement',sourceAt:at,actualModel:'claude-sonnet-5-5',actualEffort:'medium',input:1000000,cacheRead:0,cacheWrite:0,output:0},{taskId:'B1',chat:'Advisor',phase:'review',sourceAt:at,actualModel:'claude-opus-5-5',actualEffort:'high',input:1000000,cacheRead:0,cacheWrite:0,output:0},{taskId:'B2',chat:'Worker',phase:'repair',sourceAt:at,actualModel:'claude-sonnet-5-5',actualEffort:'high',input:1000000,cacheRead:0,cacheWrite:0,output:0},{taskId:null,chat:'Main',phase:'coordinate',sourceAt:at,actualModel:'unknown',actualEffort:null,input:100,cacheRead:0,cacheWrite:0,output:0}]
  const summary=routingSummary({events,outcomes:[{id:'B1',accepted:true,attempts:1},{id:'B2',accepted:false,attempts:2}],now:at+1,days:7})
  assert.equal(summary.knownCost.low,8)
  assert.equal(summary.unknownCostMessages,1)
  assert.equal(summary.accepted,1)
  assert.equal(summary.attributedCostPerAccepted.low,8)
  assert.equal(summary.tasks.find(t=>t.key==='B2').low,2)
  assert.equal(summary.comparison.savingsPercent,null)
  assert.match(spendingCsv(summary),/Estimated cost/)
  assert.ok(spendingCsv({...summary,chats:[{key:'=FORMULA',low:1,high:1,messages:1}]}).includes("'=FORMULA"))
})
test('task phase can come from an actual work call and absent IDs remain unknown',()=>{
  const e=entry('review',{input:1,cacheRead:0,cacheWrite:0,output:1},{blocks:[{type:'tool_use',name:'mcp__workers__work',input:{action:'checked',id:'B9'}}]})
  const found=attributeUsage({entries:[e,entry(null,null)],sourceSessionId:'advisor',chat:'Advisor',role:'advisor'})
  assert.equal(found.events[0].taskId,'B9')
  assert.equal(found.events[0].phase,'review')
  assert.equal(found.unknown,1)
})
test('later streaming lines can complete task attribution, and wholly unknown tokens stay unknown',()=>{
  const initial=entry('stream',{input:null,cacheRead:null,cacheWrite:null,output:null})
  const complete={...initial,blocks:[{type:'tool_use',name:'mcp__workers__work',input:{action:'checked',id:'B8'}}]}
  const found=attributeUsage({entries:[initial,complete],sourceSessionId:'s',chat:'Advisor',role:'advisor'})
  assert.equal(found.events[0].taskId,'B8')
  const summary=routingSummary({events:found.events,now:at+1})
  assert.equal(summary.tokens.input,null)
})
