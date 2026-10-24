import test from 'node:test'
import assert from 'node:assert/strict'
import {runValidation,createValidationQueue} from '../../src/work/routing/validation.mjs'
test('validation records failed checks and cannot run an altered profile',async()=>{
  const candidate={id:'c',profileHash:'profile',fingerprint:'tree'}
  const profile={hash:'profile',cwd:process.cwd(),commands:[{id:'pass',executable:process.execPath,args:['-e','process.exit(0)']},{id:'fail',executable:process.execPath,args:['-e','process.exit(2)']}]}
  const checked=await runValidation({candidate,profile})
  assert.equal(checked.passed,false);assert.equal(checked.checks[1].exitCode,2);assert.equal(checked.candidateId,'c')
  assert.equal((await runValidation({candidate,profile:{...profile,hash:'changed'}})).passed,false)
})
test('queued validation never overlaps and returns jobs without holding a caller lock',async()=>{
  let running=0,largest=0
  const queue=createValidationQueue(async value=>{running++;largest=Math.max(largest,running);await new Promise(resolve=>setTimeout(resolve,10));running--;return value})
  assert.deepEqual(await Promise.all([queue(1),queue(2),queue(3)]),[1,2,3]);assert.equal(largest,1)
})
