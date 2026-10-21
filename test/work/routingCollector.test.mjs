import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,rm} from 'node:fs/promises'
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
