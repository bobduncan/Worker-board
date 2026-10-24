import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,readFile,rm} from 'node:fs/promises'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSpendingCollector} from '../../src/work/routing/collector.mjs'
test('local collection survives a restart, counts Main and helpers and never stores chat text',async()=>{
  const root=await mkdtemp(join(tmpdir(),'spending-'))
  try{
    const transcripts=join(root,'transcripts');await mkdir(transcripts)
    const line={type:'assistant',timestamp:'2026-10-21T12:00:00Z',effort:'low',message:{id:'m1',model:'claude-sonnet-5-5',content:[{type:'text',text:'PRIVATE CONTENT'}],usage:{input_tokens:1000,output_tokens:100,cache_creation_input_tokens:0,cache_read_input_tokens:0}}}
    await writeFile(join(transcripts,'s1.jsonl'),JSON.stringify(line)+'\n')
    const now=Date.UTC(2026,9,21,13)
    const subjects=[{session:'s1',name:'Main',role:'main'}]
    const collector=createSpendingCollector({dir:root,transcripts,clock:()=>now});await collector.load();await collector.scan(subjects)
    assert.equal(collector.summary(7).messages,1)
    assert.equal(collector.summary(7).phases[0].key,'coordinate')
    const {readFile}=await import('node:fs/promises');assert.equal((await readFile(join(root,'spending.json'),'utf8')).includes('PRIVATE CONTENT'),false)
    const restarted=createSpendingCollector({dir:root,transcripts,clock:()=>now});await restarted.load();await restarted.scan(subjects)
    assert.equal(restarted.summary(7).messages,1)
    await writeFile(join(transcripts,'s1.jsonl'),JSON.stringify({...line,message:{...line.message,id:'m2'}})+'\n',{flag:'a'})
    await restarted.scan(subjects)
    assert.equal(restarted.summary(7).messages,2)
  }finally{await rm(root,{recursive:true,force:true})}
})

test('an oversized image/chat line does not permanently hide later usage',async()=>{
  const root=await mkdtemp(join(tmpdir(),'spending-long-'))
  try{
    const transcripts=join(root,'transcripts');await mkdir(transcripts)
    const at=Date.UTC(2026,9,21,12)
    const line={type:'assistant',timestamp:new Date(at).toISOString(),effort:'medium',message:{id:'after-image',model:'claude-sonnet-5-5',content:[],usage:{input_tokens:1,output_tokens:1,cache_creation_input_tokens:0,cache_read_input_tokens:0}}}
    await writeFile(join(transcripts,'s.jsonl'),'x'.repeat(1100000)+'\n'+JSON.stringify(line)+'\n')
    const collector=createSpendingCollector({dir:root,transcripts,clock:()=>at+1});await collector.load();await collector.scan([{session:'s',name:'Worker'}])
    assert.equal(collector.summary(7).messages,1)
    assert.equal(collector.summary(7).coverage.skippedLongLines,1)
  }finally{await rm(root,{recursive:true,force:true})}
})

test('missing token categories and absent usage remain unknown through real transcript parsing',async()=>{
  const root=await mkdtemp(join(tmpdir(),'spending-partial-'))
  try{
    const transcripts=join(root,'transcripts');await mkdir(transcripts)
    const at=Date.UTC(2026,9,21,12),line=(id,usage)=>({type:'assistant',timestamp:new Date(at).toISOString(),message:{id,model:'claude-sonnet-5-5',content:[],...(usage?{usage}:{})}})
    await writeFile(join(transcripts,'s.jsonl'),[line('partial',{output_tokens:100}),line('absent')].map(JSON.stringify).join('\n')+'\n')
    const collector=createSpendingCollector({dir:root,transcripts,clock:()=>at+1});await collector.load();await collector.scan([{session:'s',name:'Worker'}])
    const summary=collector.summary(7)
    assert.equal(summary.messages,2)
    assert.equal(summary.unknownCostMessages,2)
    assert.equal(summary.tokens.input,null)
    assert.equal(summary.knownCost.high,0)
  }finally{await rm(root,{recursive:true,force:true})}
})

test('child transcripts contribute costs with parent identity and no invented task attribution',async()=>{
  const root=await mkdtemp(join(tmpdir(),'spending-child-'))
  try{
    const transcripts=join(root,'transcripts');await mkdir(join(transcripts,'s','subagents'),{recursive:true})
    const at=Date.UTC(2026,9,21,12),line=(id)=>JSON.stringify({type:'assistant',timestamp:new Date(at).toISOString(),message:{id,model:'claude-opus-5-5',content:[],usage:{input_tokens:1000000,output_tokens:0,cache_creation_input_tokens:0,cache_read_input_tokens:0}}})+'\n'
    await writeFile(join(transcripts,'s.jsonl'),line('parent'))
    await writeFile(join(transcripts,'s','subagents','agent-one.jsonl'),line('child'))
    const collector=createSpendingCollector({dir:root,transcripts,clock:()=>at+1});await collector.load();await collector.scan([{session:'s',name:'Main',role:'main'}])
    const summary=collector.summary(7)
    assert.equal(summary.messages,2)
    assert.equal(summary.knownCost.low,8)
    assert.equal(summary.coverage.childTranscripts,1)
    const {readFile}=await import('node:fs/promises'),ledger=JSON.parse(await readFile(join(root,'spending.json'),'utf8'))
    const child=ledger.events.find(e=>e.messageId==='child')
    assert.equal(child.parentSessionId,'s')
    assert.equal(child.isChild,true)
    assert.equal(child.taskId,null)
    assert.equal(child.phase,'unattributed')
    const restarted=createSpendingCollector({dir:root,transcripts,clock:()=>at+1});await restarted.load();await restarted.scan([{session:'s',name:'Main',role:'main'}])
    assert.equal(restarted.summary(7).messages,2)
  }finally{await rm(root,{recursive:true,force:true})}
})

test('invalid persisted ledgers cannot break summaries or overwrite recoverable history',async()=>{
  for(const raw of ['{broken',JSON.stringify({version:1,events:[null],scans:{}}),JSON.stringify({version:1,events:[],scans:{s:null}})]){
    const root=await mkdtemp(join(tmpdir(),'spending-corrupt-'))
    try{
      const transcripts=join(root,'transcripts');await mkdir(transcripts)
      await writeFile(join(root,'spending.json'),raw)
      await writeFile(join(transcripts,'s.jsonl'),JSON.stringify({type:'assistant',timestamp:'2026-10-21T12:00:00Z',message:{id:'m',model:'claude-sonnet-5-5',content:[]}})+'\n')
      const collector=createSpendingCollector({dir:root,transcripts});await collector.load()
      assert.match(collector.summary(7).coverage.problem,/preserved|unavailable/i)
      await collector.scan([{session:'s',name:'Main'}])
      assert.equal(await readFile(join(root,'spending.json'),'utf8'),raw)
    }finally{await rm(root,{recursive:true,force:true})}
  }
})
