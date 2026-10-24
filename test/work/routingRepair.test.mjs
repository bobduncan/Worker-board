import test from 'node:test'
import assert from 'node:assert/strict'
import {repairDecision} from '../../src/work/routing/repair.mjs'
test('quality failures promote while transport failures preserve request identity and tier',()=>{
  const group={attemptsInEpoch:1,lifetimeAttempts:1,strategyCount:1,failures:{AC1:1},route:{family:'haiku',effort:'medium'}}
  assert.equal(repairDecision({group,failure:{kind:'quality',id:'AC1'}}).kind,'promote')
  assert.equal(repairDecision({group,failure:{kind:'transport',retries:0}}).kind,'retry-transport')
  assert.equal(repairDecision({group,failure:{kind:'transport',retries:1}}).kind,'hold')
  assert.equal(repairDecision({group:{...group,attemptsInEpoch:3},failure:{kind:'quality',id:'AC2'}}).kind,'evaluate')
  assert.equal(repairDecision({group:{...group,lifetimeAttempts:12},failure:{kind:'quality',id:'AC1'}}).kind,'hold')
  assert.equal(repairDecision({group,failure:{kind:'quality',id:'AC1'},quota:{exhausted:true}}).kind,'hold')
})
