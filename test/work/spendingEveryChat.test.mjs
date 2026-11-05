// Spending counts every chat (chat 1's brief, 2026-11-05): a backlog of hundreds of MB is read in a few scans without
// holding the board, and the sessions cleared chats left (.claude/chats cards with `movedTo`) are counted under the chat.
import test from 'node:test'
import assert from 'node:assert/strict'
import {mkdtemp,mkdir,writeFile,appendFile,rm,stat} from 'node:fs/promises'
import {createWriteStream} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSpendingCollector,movedSubjects} from '../../src/work/routing/collector.mjs'
import {attributeUsage} from '../../src/work/routing/metrics.mjs'

const at=Date.UTC(2026,10,5,9)
// The shapes of a real transcript: an answer with its usage, and a tool's output (the bulk of a transcript).
const answer=(id,session='s')=>JSON.stringify({parentUuid:'p',isSidechain:false,type:'assistant',sessionId:session,timestamp:new Date(at).toISOString(),message:{id,model:'claude-opus-5-5',role:'assistant',content:[{type:'text',text:'done'}],usage:{input_tokens:10,cache_creation_input_tokens:0,cache_read_input_tokens:1000,output_tokens:20}}})
const toolOutput=size=>JSON.stringify({parentUuid:'p',isSidechain:false,type:'user',timestamp:new Date(at).toISOString(),message:{role:'user',content:[{type:'tool_result',tool_use_id:'t',content:'x'.repeat(size)}]},toolUseResult:{stdout:'"type":"assistant" inside a tool output is no answer'}})
async function backlog(path,mb,answers){
  const out=createWriteStream(path),block=toolOutput(64*1024)+'\n'
  let n=0
  for(let written=0;written<mb*1024*1024;written+=block.length){
    out.write(block)
    if(n<answers&&written%(4*1024*1024)<block.length)out.write(answer(`m${n++}`)+'\n')
  }
  while(n<answers)out.write(answer(`m${n++}`)+'\n')
  await new Promise(done=>out.end(done))
}
const counted=collector=>Object.fromEntries(collector.summary(7).chats.map(one=>[one.key,one.messages]))
const ledgerOf=async root=>JSON.parse(await (await import('node:fs/promises')).readFile(join(root,'spending.json'),'utf8'))
async function place(fn){const root=await mkdtemp(join(tmpdir(),'spending-every-'));try{const transcripts=join(root,'t'),chats=join(root,'chats');await mkdir(transcripts);await mkdir(chats);await fn({root,transcripts,chats})}finally{await rm(root,{recursive:true,force:true})}}

// Point 1: the Advisor's 1.35 GB was read at 2 MB per visit, one visit per ~12 min. Now a backlog is read on to the
// scan's bytes. Mutant (2 chunks per file, the old reading): 40 MB takes 20 scans, so one scan finds 2 of 20 answers.
test('a backlog of 40 MB is read in one scan, every answer in it counted',async()=>place(async({root,transcripts})=>{
  await backlog(join(transcripts,'advisor.jsonl'),40,20)
  const collector=createSpendingCollector({dir:root,transcripts,clock:()=>at+1});await collector.load()
  await collector.scan([{session:'advisor',name:'Advisor',role:'advisor'}])
  const summary=collector.summary(7)
  assert.equal(summary.messages,20)
  assert.equal(summary.coverage.pendingBytes,0)
}))

// Point 2: the board keeps answering. A timer every 5 ms keeps firing while 64 MB are read; no gap is long.
// Mutant (the backlog read in one buffer and parsed at once): one gap of hundreds of ms.
test('while a 64 MB backlog is read, the board is never held for more than 150 ms',async()=>place(async({root,transcripts})=>{
  await backlog(join(transcripts,'advisor.jsonl'),64,30)
  const collector=createSpendingCollector({dir:root,transcripts,clock:Date.now});await collector.load()
  let last=performance.now(),longest=0,ticks=0
  const timer=setInterval(()=>{const now=performance.now();longest=Math.max(longest,now-last);last=now;ticks++},5)
  await collector.scan([{session:'advisor',name:'Advisor',role:'advisor'}])
  clearInterval(timer)
  assert.equal(collector.summary(7).messages,30)
  assert.ok(ticks>5,`the timer fired ${ticks} times`)
  assert.ok(longest<150,`the board was held ${Math.round(longest)} ms`)
}))

// Point 2: a scan stops on its time (the clock here moves 1 s per look) and the next goes on from the same offset:
// every answer counted once. Mutant (no time limit): the first scan reads all 40 MB.
test('a scan stops on its time and the next goes on where it stopped, every answer once',async()=>place(async({root,transcripts})=>{
  await backlog(join(transcripts,'advisor.jsonl'),40,20)
  let now=at;const clock=()=>(now+=1000)
  const collector=createSpendingCollector({dir:root,transcripts,clock});await collector.load()
  const lanes=[{session:'advisor',name:'Advisor',role:'advisor'}]
  await collector.scan(lanes)
  assert.ok(collector.summary(7).coverage.pendingBytes>0,'the first scan stopped on its time')
  for(let scans=1;scans<40&&collector.summary(7).coverage.pendingBytes>0;scans++)await collector.scan(lanes)
  assert.equal(collector.summary(7).coverage.pendingBytes,0)
  assert.equal(collector.summary(7).messages,20)
}))

// Point 2: a chat's own session is never starved by a backlog. A left session behind by 40 MB, written last, would be
// read first; the chats' own sessions get their turn before it. Mutant (no own turn first): Worker 1's answer waits.
test('a chat\'s own new answer is read in the same scan as a big backlog',async()=>place(async({root,transcripts,chats})=>{
  await writeFile(join(transcripts,'now.jsonl'),answer('fresh','now')+'\n')
  await backlog(join(transcripts,'old.jsonl'),40,5)
  await writeFile(join(chats,'old.json'),JSON.stringify({movedTo:'now',at}))
  await writeFile(join(chats,'now.json'),JSON.stringify({name:'Worker 1',role:'worker',at}))
  let now=at;const clock=()=>(now+=1000)
  const collector=createSpendingCollector({dir:root,transcripts,chats,clock});await collector.load()
  await collector.scan([{session:'now',name:'Worker 1',role:'worker'}])
  const {readFile}=await import('node:fs/promises'),ledger=JSON.parse(await readFile(join(root,'spending.json'),'utf8'))
  assert.ok(ledger.events.some(e=>e.messageId==='fresh'),'the chat\'s own answer is in')
  assert.ok(ledger.scans.old.offset<(await stat(join(transcripts,'old.jsonl'))).size,'the backlog is still behind')
}))

// Point 3: every clear starts a new session; the old one's card names the next. Worker 3 cleared twice: both old
// sessions count under Worker 3, and so does a second named session of it that is not its own now; a chain that ends in
// no named card counts under "Earlier chat", and a session that left the board under its app title.
// Mutant (only the chats' own sessions, as before): Worker 3 has 1 message, not 3, and "Earlier chat" none.
test('the sessions a cleared chat left are counted under that chat',async()=>place(async({root,transcripts,chats})=>{
  for(const [session,id] of [['old1','a'],['old2','b'],['now','c'],['gone','d'],['away','e'],['second','f']])await writeFile(join(transcripts,`${session}.jsonl`),answer(id,session)+'\n')
  await writeFile(join(chats,'away.json'),JSON.stringify({left:true}))
  await writeFile(join(chats,'second.json'),JSON.stringify({name:'Worker 3',role:'worker',state:'waiting',task:null,at}))
  await writeFile(join(chats,'old1.json'),JSON.stringify({movedTo:'old2',at}))
  await writeFile(join(chats,'old2.json'),JSON.stringify({movedTo:'now',at}))
  await writeFile(join(chats,'now.json'),JSON.stringify({name:'Worker 3',role:'worker',state:'working',task:null,at}))
  await writeFile(join(chats,'gone.json'),JSON.stringify({movedTo:'deleted',at}))
  assert.deepEqual((await movedSubjects(chats)).map(one=>[one.session,one.name]).sort(),[['away','Earlier chat'],['gone','Earlier chat'],['now','Worker 3'],['old1','Worker 3'],['old2','Worker 3'],['second','Worker 3']])
  // The app's title names the session that left the board, without the project's prefix.
  const appSessions=join(root,'app','account','org');await mkdir(appSessions,{recursive:true})
  await writeFile(join(appSessions,'local_1.json'),JSON.stringify({sessionId:'local_1',cliSessionId:'away',title:'Project - Units'}))
  const collector=createSpendingCollector({dir:root,transcripts,chats,appSessions:join(root,'app'),clock:()=>at+1});await collector.load()
  await collector.scan([{session:'now',name:'Worker 3',role:'worker'}])
  const chatsSeen=Object.fromEntries(collector.summary(7).chats.map(one=>[one.key,one.messages]))
  assert.deepEqual(chatsSeen,{'Worker 3':4,'Earlier chat':1,'Units':1})
}))

// Point 3, kept cheap: a left session read to its end, its children too, is marked with the bytes of all its files and
// not read again; a transcript gone since is no "unavailable" one. (Skipping only saves reading: no count shows it.)
test('a left session read to its end is marked with all its bytes, and a gone transcript is not unavailable',async()=>place(async({root,transcripts,chats})=>{
  await writeFile(join(transcripts,'old.jsonl'),answer('a','old')+'\n')
  await mkdir(join(transcripts,'old','subagents'),{recursive:true})
  await writeFile(join(transcripts,'old','subagents','agent-1.jsonl'),answer('a1','old')+'\n')
  await writeFile(join(transcripts,'now.jsonl'),answer('b','now')+'\n')
  await writeFile(join(chats,'old.json'),JSON.stringify({movedTo:'now',at}))
  await writeFile(join(chats,'now.json'),JSON.stringify({name:'Worker 1',role:'worker',at}))
  const collector=createSpendingCollector({dir:root,transcripts,chats,clock:()=>at+1});await collector.load()
  const lanes=[{session:'now',name:'Worker 1',role:'worker'}]
  await collector.scan(lanes)
  assert.equal(collector.summary(7).coverage.childTranscripts,1)
  const bytes=(await stat(join(transcripts,'old.jsonl'))).size+(await stat(join(transcripts,'old','subagents','agent-1.jsonl'))).size
  assert.equal((await ledgerOf(root)).readOut.old,bytes)
  await rm(join(transcripts,'old.jsonl'))
  await appendFile(join(transcripts,'now.jsonl'),answer('c','now')+'\n')
  await collector.scan(lanes)
  const summary=collector.summary(7)
  assert.equal(summary.messages,4)
  assert.equal(summary.coverage.unavailableTranscripts,0)
  // Every child read so far counts.
  assert.equal(summary.coverage.childTranscripts,1)
}))

// Point 4: writes stay quick. The ledger keeps no transcript text and stays as small as before: a tool output's
// words never reach it, and the index kept between chunks gives the same events as building them anew.
// Mutant (the index not filled in place): no events at all.
test('the events kept by message id between chunks are the ones built anew, and the ledger holds no text',async()=>place(async({root,transcripts})=>{
  const entry=(id,output)=>({type:'assistant',messageId:id,at,model:'claude-opus-5-5',usage:{input:1,cacheRead:0,cacheWrite:0,output},blocks:[]})
  const index=new Map()
  attributeUsage({entries:[entry('one',5)],sourceSessionId:'s',chat:'Worker',role:'worker',index})
  attributeUsage({entries:[entry('one',9),entry('two',1)],sourceSessionId:'fork',chat:'Copy',role:'worker',index})
  const anew=attributeUsage({entries:[entry('one',9),entry('two',1)],sourceSessionId:'fork',chat:'Copy',role:'worker',previous:attributeUsage({entries:[entry('one',5)],sourceSessionId:'s',chat:'Worker',role:'worker'}).events})
  assert.deepEqual([...index.values()],anew.events)
  await backlog(join(transcripts,'s.jsonl'),2,3)
  const collector=createSpendingCollector({dir:root,transcripts,clock:()=>at+1});await collector.load()
  await collector.scan([{session:'s',name:'Worker',role:'worker'}])
  const {readFile}=await import('node:fs/promises'),written=await readFile(join(root,'spending.json'),'utf8')
  assert.equal(written.includes('xxxx'),false)
  assert.equal(written.includes('inside a tool output'),false)
  assert.ok((await stat(join(root,'spending.json'))).size<10000)
}))

// The review of 2026-11-05 (chat 1): a read-out mark that never lets go loses a chat's new answers.

// Review 1: chat 2's card is only {"left":true}, yet it is in use. Read out, then 2 new answers: both counted.
// Mutant (the mark skips the session whatever its size): 1 counted, not 3.
test('a session that left the board and goes on is read on after it was read out',async()=>place(async({root,transcripts,chats})=>{
  await writeFile(join(transcripts,'side.jsonl'),answer('a','side')+'\n')
  await writeFile(join(chats,'side.json'),JSON.stringify({left:true}))
  const collector=createSpendingCollector({dir:root,transcripts,chats,clock:()=>at+1});await collector.load()
  await collector.scan([]);await collector.scan([])
  assert.equal(typeof (await ledgerOf(root)).readOut.side,'number','read out at its size')
  await appendFile(join(transcripts,'side.jsonl'),answer('b','side')+'\n'+answer('c','side')+'\n')
  await collector.scan([]);await collector.scan([])
  assert.equal(collector.summary(7).messages,3)
}))

// Review 1: a moved session a chat resumed (Worker 4's 1ec8713a on 11-04) gets answers after its move.
// Mutant (the mark skips the session whatever its size): the resumed answer is lost.
test('a moved session that a chat resumes is read on',async()=>place(async({root,transcripts,chats})=>{
  await writeFile(join(transcripts,'old.jsonl'),answer('a','old')+'\n')
  await writeFile(join(transcripts,'now.jsonl'),answer('b','now')+'\n')
  await writeFile(join(chats,'old.json'),JSON.stringify({movedTo:'now',at}))
  await writeFile(join(chats,'now.json'),JSON.stringify({name:'Worker 4',role:'worker',at}))
  const collector=createSpendingCollector({dir:root,transcripts,chats,clock:()=>at+1});await collector.load()
  const lanes=[{session:'now',name:'Worker 4',role:'worker'}]
  await collector.scan(lanes);await collector.scan(lanes)
  await appendFile(join(transcripts,'old.jsonl'),answer('resumed','old')+'\n')
  await collector.scan(lanes)
  assert.deepEqual(counted(collector),{'Worker 4':3})
}))

// Review 1: a read-out session that becomes a chat's own again (chat 2 rejoining) is read, also after a restart.
// Mutant (the mark is looked at before the chat's own sessions): the new answer is never read.
test('a read-out session that is a chat\'s own again is read on, after a restart too',async()=>place(async({root,transcripts,chats})=>{
  await writeFile(join(transcripts,'side.jsonl'),answer('a','side')+'\n')
  await writeFile(join(chats,'side.json'),JSON.stringify({left:true}))
  const first=createSpendingCollector({dir:root,transcripts,chats,clock:()=>at+1});await first.load()
  await first.scan([]);await first.scan([])
  await appendFile(join(transcripts,'side.jsonl'),answer('b','side')+'\n')
  // The mark is kept at the size it had; the own lane is read whatever the mark says.
  const restarted=createSpendingCollector({dir:root,transcripts,chats,clock:()=>at+1});await restarted.load()
  const lanes=[{session:'side',name:'Goal chat',role:'worker'}]
  await restarted.scan(lanes)
  assert.equal(restarted.summary(7).messages,2)
  assert.equal((await ledgerOf(root)).readOut.side,undefined)
}))

// Review 2: the read-out compares with the size found in this scan, not the one of the last read. A left session grows
// while the scan's time goes to a bigger, newer backlog: it is still behind, never marked read out.
// Mutant (the size of the last read): it is marked read out with its new answer unread, and nothing shows as behind.
test('a left session that grew since its last read is not marked read out before it is read',async()=>place(async({root,transcripts,chats})=>{
  await writeFile(join(transcripts,'old.jsonl'),answer('a','old')+'\n')
  await writeFile(join(chats,'old.json'),JSON.stringify({movedTo:'gone',at}))
  let now=at;const clock=()=>(now+=1000)
  const collector=createSpendingCollector({dir:root,transcripts,chats,clock});await collector.load()
  await collector.scan([])
  await appendFile(join(transcripts,'old.jsonl'),answer('b','old')+'\n')
  await backlog(join(transcripts,'big.jsonl'),40,5)
  await writeFile(join(chats,'big.json'),JSON.stringify({movedTo:'gone',at}))
  const {utimes}=await import('node:fs/promises');await utimes(join(transcripts,'old.jsonl'),new Date(at),new Date(at))
  await collector.scan([])
  const ledger=await ledgerOf(root)
  assert.equal(ledger.readOut.old,undefined)
  assert.ok(ledger.scans.old.offset<ledger.scans.old.size,'the old session shows as behind')
}))

// Review 3: four cards were cut at 70 bytes (24-26 Oct); a chain of moves through one still ends in its chat.
// Mutant (a card that does not parse is dropped): the sessions count under "Earlier chat" or not at all.
test('a card cut short still names its chat and carries its move',async()=>place(async({root,transcripts,chats})=>{
  for(const session of ['a','b','c'])await writeFile(join(transcripts,`${session}.jsonl`),answer(`m-${session}`,session)+'\n')
  await writeFile(join(chats,'a.json'),JSON.stringify({movedTo:'b',at}))
  await writeFile(join(chats,'b.json'),'{"movedTo":"c","at":17927')
  await writeFile(join(chats,'c.json'),'{\n  "name": "Supervisor",\n  "role": "worker",\n  "state": "waiting",\n  ')
  const collector=createSpendingCollector({dir:root,transcripts,chats,clock:()=>at+1});await collector.load()
  await collector.scan([])
  assert.deepEqual(counted(collector),{Supervisor:3})
}))

// Review 4: the ledger keeps the latest 50 000 messages; a period that starts before the oldest kept one says so.
// Mutant (no line): the 30-day and All views say nothing about the days they miss.
test('a period longer than the kept history says from when it covers',async()=>{
  const {readFile}=await import('node:fs/promises'),vm=await import('node:vm')
  const context={window:{},Intl,Blob,URL,setTimeout};vm.runInNewContext(await readFile(new URL('../../public/spending.js',import.meta.url),'utf8'),context)
  const kept=Date.UTC(2026,9,24)
  const line=summary=>context.window.BoardSpending.coversLine(summary)
  assert.match(line({from:null,coverage:{retainedFrom:kept}}),/^Covers only from /)
  assert.match(line({from:kept-6*86400000,coverage:{retainedFrom:kept}}),/^Covers only from /)
  assert.equal(line({from:kept+86400000,coverage:{retainedFrom:kept}}),null)
  assert.equal(line({from:null,coverage:{retainedFrom:null}}),null)
})

// The second review (chat 1, 2026-11-05).
// Review 2.1: chat 2 runs agents for hours with no word in its own transcript. A child that grows undoes the read-out mark.
// Mutant (the mark is the main transcript's size only): the child's new answer waits for the next main write, or forever.
test('a read-out session whose child grows is read on',async()=>place(async({root,transcripts,chats})=>{
  await writeFile(join(transcripts,'side.jsonl'),answer('a','side')+'\n')
  await mkdir(join(transcripts,'side','subagents'),{recursive:true})
  await writeFile(join(transcripts,'side','subagents','agent-1.jsonl'),answer('a1','side')+'\n')
  await writeFile(join(chats,'side.json'),JSON.stringify({left:true}))
  const collector=createSpendingCollector({dir:root,transcripts,chats,clock:()=>at+1});await collector.load()
  await collector.scan([]);await collector.scan([])
  assert.equal(typeof (await ledgerOf(root)).readOut.side,'number')
  await appendFile(join(transcripts,'side','subagents','agent-1.jsonl'),answer('a2','side')+'\n')
  await collector.scan([])
  assert.equal(collector.summary(7).messages,3)
}))

// Review 2.2: four transcripts the 24-26 Oct crashes cut end in zeros and no newline (7570a22a: 761,535 bytes). Their
// tail is read as done, so "Incomplete coverage" clears after the catch-up. Mutant (a tail of zeros waits for a newline):
// the bytes stay pending for good.
test('a transcript that ends in a crash\'s zeros is read to its end and nothing stays pending',async()=>place(async({root,transcripts,chats})=>{
  await writeFile(join(transcripts,'cut.jsonl'),Buffer.concat([Buffer.from(answer('a','cut')+'\n'),Buffer.alloc(761535)]))
  await writeFile(join(chats,'cut.json'),JSON.stringify({movedTo:'gone',at}))
  const collector=createSpendingCollector({dir:root,transcripts,chats,clock:()=>at+1});await collector.load()
  await collector.scan([]);await collector.scan([])
  const summary=collector.summary(7)
  assert.equal(summary.messages,1)
  assert.equal(summary.coverage.pendingBytes,0)
  assert.equal(typeof (await ledgerOf(root)).readOut.cut,'number')
}))

// Review 2.2: the old Advisor's card (8cf33317) names a transcript that is gone; it is read out, never "unavailable".
// Mutant (a gone transcript is read like any other): "1 transcripts unavailable" for good.
test('a left session whose transcript is gone is read out, not unavailable',async()=>place(async({root,transcripts,chats})=>{
  await writeFile(join(chats,'gone.json'),JSON.stringify({name:'Advisor',role:'advisor',at}))
  const collector=createSpendingCollector({dir:root,transcripts,chats,clock:()=>at+1});await collector.load()
  await collector.scan([]);await collector.scan([])
  const summary=collector.summary(7)
  assert.equal(summary.coverage.unavailableTranscripts,0)
  assert.equal((await ledgerOf(root)).readOut.gone,0)
}))

// Review 2.3: a left transcript replaced by a smaller one is read again from its start.
// Mutant (behind only while the offset is below the size): the smaller file's answers are never read.
test('a left transcript that shrinks is read again from its start',async()=>place(async({root,transcripts,chats})=>{
  await writeFile(join(transcripts,'old.jsonl'),answer('a','old')+'\n'+answer('b','old')+'\n')
  await writeFile(join(chats,'old.json'),JSON.stringify({movedTo:'gone',at}))
  const collector=createSpendingCollector({dir:root,transcripts,chats,clock:()=>at+1});await collector.load()
  await collector.scan([])
  await writeFile(join(transcripts,'old.jsonl'),answer('c','old')+'\n')
  await collector.scan([]);await collector.scan([])
  assert.equal(collector.summary(7).messages,3)
}))

// Review 2.4: workflow agents write one folder deeper, <session>/subagents/workflows/<run>/agent-*.jsonl (467 files here).
// Mutant (only subagents/*.jsonl): the workflow's answers are not counted.
test('a workflow agent\'s transcript is counted under its chat',async()=>place(async({root,transcripts})=>{
  await writeFile(join(transcripts,'now.jsonl'),answer('a','now')+'\n')
  await mkdir(join(transcripts,'now','subagents','workflows','wf_1'),{recursive:true})
  await writeFile(join(transcripts,'now','subagents','workflows','wf_1','agent-1.jsonl'),answer('w1','now')+'\n')
  const collector=createSpendingCollector({dir:root,transcripts,clock:()=>at+1});await collector.load()
  await collector.scan([{session:'now',name:'Worker 2',role:'worker'}])
  assert.deepEqual(counted(collector),{'Worker 2':2})
  assert.ok((await ledgerOf(root)).scans['now/subagents/workflows/wf_1/agent-1.jsonl'])
}))

// Review 2.5: every chat is counted, also a side chat that never had a card ("Worker board task reliability"), under its
// app title. Mutant (only sessions a card names): the side chat is missing.
test('a session no card names is counted under its app title',async()=>place(async({root,transcripts,chats})=>{
  await writeFile(join(transcripts,'side.jsonl'),answer('a','side')+'\n')
  const appSessions=join(root,'app','account','org');await mkdir(appSessions,{recursive:true})
  await writeFile(join(appSessions,'local_1.json'),JSON.stringify({sessionId:'local_1',cliSessionId:'side',title:'Worker board task reliability'}))
  const collector=createSpendingCollector({dir:root,transcripts,chats,appSessions:join(root,'app'),clock:()=>at+1});await collector.load()
  await collector.scan([])
  assert.deepEqual(counted(collector),{'Worker board task reliability':1})
}))

// Round 4 (c): 1,291 lines over 1 MB, none an answer (user lines, request blobs): "N oversized lines ... usage unknown"
// was a false alarm. Only an answer's line is counted. Mutant (every long line counted): 2, not 1.
test('only an oversized answer line is counted as usage left out',async()=>place(async({root,transcripts})=>{
  const huge=JSON.stringify({type:'assistant',timestamp:new Date(at).toISOString(),message:{id:'big',model:'claude-opus-5-5',content:[{type:'text',text:'y'.repeat(1100000)}],usage:{input_tokens:1,output_tokens:1,cache_creation_input_tokens:0,cache_read_input_tokens:0}}})
  await writeFile(join(transcripts,'s.jsonl'),toolOutput(1100000)+'\n'+huge+'\n'+answer('after','s')+'\n')
  const collector=createSpendingCollector({dir:root,transcripts,clock:()=>at+1});await collector.load()
  await collector.scan([{session:'s',name:'Worker',role:'worker'}])
  const summary=collector.summary(7)
  assert.equal(summary.coverage.skippedLongLines,1)
  assert.equal(summary.messages,1)
}))

// Round 4 (c): the live ledger counted 1,295 lines that were no answers; it is started anew once.
// Mutant (the old count kept): the false notice stays.
test('the old count of long lines is started anew once',async()=>place(async({root,transcripts})=>{
  await writeFile(join(root,'spending.json'),JSON.stringify({version:1,events:[],scans:{},skippedLongLines:1295}))
  const first=createSpendingCollector({dir:root,transcripts,clock:()=>at+1});await first.load()
  assert.equal(first.summary(7).coverage.skippedLongLines,0)
  await writeFile(join(transcripts,'s.jsonl'),answer('a','s')+'\n')
  await first.scan([{session:'s',name:'Worker',role:'worker'}])
  const ledger=await ledgerOf(root)
  ledger.skippedLongLines=1
  await writeFile(join(root,'spending.json'),JSON.stringify(ledger))
  const again=createSpendingCollector({dir:root,transcripts,clock:()=>at+1});await again.load()
  assert.equal(again.summary(7).coverage.skippedLongLines,1,'a count under the new rule is kept')
}))
