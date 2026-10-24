import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,rm} from 'node:fs/promises'
import {join} from 'node:path'
import {tmpdir} from 'node:os'
import {migrateBacklog} from '../../src/work/migrate.mjs'
import {writeStore,readStore,writeItem} from '../../src/work/store.mjs'
import {workApi} from '../../src/work/api.mjs'
import {writeRoutingSections} from '../../src/work/routing/records.mjs'
import {parseRoutingPolicy} from '../../src/work/routing/policy.mjs'

test('direct take and even server advance cannot bypass managed routing when global policy is off',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'routing-take-'))
  try{
    await writeStore(dir,migrateBacklog('## Work\n- [ ] B1 Fix one label (for Worker)\n'))
    const item=(await readStore(dir)).items.get('B1')
    await writeItem(dir,writeRoutingSections(item,{managed:true,assignments:[],candidates:[],repair:null,policy:parseRoutingPolicy().policy}))
    const ctx={dir,now:10000,roleOf:n=>n==='Worker'?'worker':null,sessionOf:()=>({sessionId:'worker',sampledAt:10000}),routingPolicy:parseRoutingPolicy(),freeChats:new Set(['Worker'])}
    const take=await workApi({chat:'Worker',action:'take',id:'B1'},ctx)
    assert.equal(take.ok,false);assert.match(take.why,/assignment|confirmed|managed/i)
    const advance=await workApi({action:'advance',id:'B1',to:'done'},{...ctx,as:'server'})
    assert.equal(advance.ok,false)
    const state=await workApi({chat:'Worker',action:'route-state',id:'B1'},ctx)
    assert.equal(state.ok,true);assert.equal(state.result.routing.managed,true)
    assert.notEqual((await readStore(dir)).items.get('B1').head.get('State'),'done')
  }finally{await rm(dir,{recursive:true,force:true})}
})
test('enforce without capability proof and missing specs never falls back to cheap legacy take',async()=>{
  const dir=await mkdtemp(join(tmpdir(),'routing-enforce-'))
  try{
    await writeStore(dir,migrateBacklog('## Work\n- [ ] B1 Fix one label (for Worker)\n'))
    const answer=await workApi({chat:'Worker',action:'take',id:'B1'},{dir,roleOf:()=> 'worker',routingPolicy:parseRoutingPolicy({mode:'enforce'}),freeChats:new Set(['Worker'])})
    assert.equal(answer.ok,false);assert.match(answer.why,/capabilit|confirmed|contract|routing/i)
  }finally{await rm(dir,{recursive:true,force:true})}
})
