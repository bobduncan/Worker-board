import test from 'node:test'
import assert from 'node:assert/strict'
import { parseRoutingPolicy, resolveRoute, meetsRoute } from '../../src/work/routing/policy.mjs'

const registry = Object.fromEntries(['haiku','sonnet','opus'].map(family => [family,{model:`claude-${family}-5-5`,verified:true,efforts:['low','medium','high','xhigh','max']}]))
const policy = options => parseRoutingPolicy({mode:'observe',registry,...options}).policy
test('ordinary work uses Sonnet and unknown risk cannot be cheaply assigned', () => {
  assert.equal(resolveRoute({policy:policy(),role:'main',phase:'coordinate'}).route.effort,'low')
  assert.equal(resolveRoute({policy:policy(),role:'worker',contract:{risk:{class:'R2',factors:[]}}}).route.family,'sonnet')
  assert.equal(resolveRoute({policy:policy(),role:'worker',contract:{}}).ok,false)
  assert.equal(resolveRoute({policy:policy(),role:'worker',contract:{risk:{class:'R2',factors:['persistence']}}}).route.effort,'high')
})
test('small protected changes and effort cannot evade model floors', () => {
  const found=resolveRoute({policy:policy({r1Canary:true}),role:'worker',contract:{risk:{class:'R1',factors:[]},allowedPaths:{board:['src/work/guards.mjs']}}})
  assert.equal(found.risk.class,'R3')
  assert.equal(found.route.family,'opus')
  assert.equal(meetsRoute({model:'claude-haiku-5-5',effort:'max'}, {family:'sonnet',model:'claude-sonnet-5-5',effort:'medium'},registry),false)
  assert.equal(meetsRoute({model:'claude-opus-5-5',effort:'high'}, {family:'sonnet',model:'claude-sonnet-5-5',effort:'medium'},registry),true)
})
test('cheap execution requires its canary and exact verified model support', () => {
  const contract={risk:{class:'R1',factors:[]},implementationFiles:2}
  assert.equal(resolveRoute({policy:policy(),role:'worker',contract}).route.family,'sonnet')
  assert.equal(resolveRoute({policy:policy({r1Canary:true}),role:'worker',contract}).route.family,'haiku')
  assert.equal(resolveRoute({policy:policy({r1Canary:true}),role:'worker',contract:{...contract,implementationFiles:4}}).route.family,'sonnet')
  assert.equal(resolveRoute({policy:parseRoutingPolicy().policy,role:'main',phase:'coordinate'}).ok,false)
  assert.equal(parseRoutingPolicy({mode:'bad'}).ok,false)
  assert.equal(parseRoutingPolicy({registry:{haiku:{model:'x',efforts:['fiction'],verified:true}}}).ok,false)
})
test('review is independent of cheap author floors and an escalation never lowers', () => {
  const contract={risk:{class:'R0',factors:[]}}
  assert.equal(resolveRoute({policy:policy({r0Canary:true}),role:'reviewer',phase:'review',contract}).route.family,'sonnet')
  assert.equal(resolveRoute({policy:policy({r0Canary:true}),role:'worker',contract,previousFloor:{family:'opus',model:'claude-opus-5-5',effort:'high'}}).route.family,'opus')
})
export {registry}
