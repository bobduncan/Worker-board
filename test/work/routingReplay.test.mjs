import test from 'node:test'
import assert from 'node:assert/strict'
import {readFile} from 'node:fs/promises'
import {replayCases} from '../../tools/routing-replay.mjs'
test('the twenty independently specified task shapes never select a model below their expected floor',async()=>{
  const cases=JSON.parse(await readFile(new URL('../../fixtures/routing/replay-cases.json',import.meta.url),'utf8'))
  assert.equal(cases.length,20)
  const registry=Object.fromEntries(['haiku','sonnet','opus'].map(family=>[family,{model:`claude-${family}-5-5`,verified:true,efforts:['low','medium','high','xhigh','max']}]))
  const result=replayCases(cases,{mode:'observe',registry,r0Canary:true,r1Canary:true})
  assert.equal(result.failed,0,JSON.stringify(result.results.filter(r=>!r.passed)))
})
