// Spending counts every chat (chat 1's brief, 2026-11-05): a backlog of hundreds of MB is read in a few scans without
// holding the board, and the sessions cleared chats left (.claude/chats cards with `movedTo`) are counted under the chat.
import test from 'node:test'
import assert from 'node:assert/strict'
import {createHash} from 'node:crypto'
import {mkdtemp,mkdir,writeFile,appendFile,rm,stat} from 'node:fs/promises'
import {createWriteStream} from 'node:fs'
import {tmpdir} from 'node:os'
import {join} from 'node:path'
import {createSpendingCollector,movedSubjects} from '../../src/work/routing/collector.mjs'
import {attributeUsage,compactFolded,estimateUsage,foldEvents,routingSummary,FOLD_MERGE_DAYS} from '../../src/work/routing/metrics.mjs'

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
  // The clock is the fixture's day (2026-11-05): with the real clock the 7-day summary had left its answers behind by 2026-11-13.
  const collector=createSpendingCollector({dir:root,transcripts,clock:()=>at+1});await collector.load()
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

// ---- Round 4 (final check, 2026-11-05) ----
const lineAt=(id,session,time)=>JSON.stringify({type:'assistant',sessionId:session,timestamp:new Date(time).toISOString(),message:{id,model:'claude-opus-5-5',content:[],usage:{input_tokens:10,cache_creation_input_tokens:0,cache_read_input_tokens:1000,output_tokens:20}}})+'\n'
const seeded=extra=>({version:1,events:[],scans:{},foldVersion:2,folded:[],oversizedRule:1,...extra})

// (a) Discovery grew with the sessions and ate the read budget (781 sessions, ~3,000 in months). The budget starts after
// it; a read-out session whose files are gone is not walked; one whose transcript is newer than its mark is, outside its turn.
// Mutant (the budget started before discovery): with a clock that runs, the chat's answer is not read.
test('many read-out sessions do not eat the read budget, a gone one is left alone and a grown one is read',async()=>place(async({root,transcripts,chats})=>{
  const base=Date.now(),readOut={},readOutAt={},scans={},names=Array.from({length:150},(_,n)=>`r${String(n).padStart(3,'0')}`)
  for(const name of names){
    const text=answer(`${name}-a`,name)+'\n';await writeFile(join(transcripts,`${name}.jsonl`),text)
    readOut[name]=Buffer.byteLength(text);readOutAt[name]=base+1e9;scans[name]={offset:readOut[name],size:readOut[name],taskId:null}
  }
  // 'zgone' has a mark but no transcript and no folder; 'zgrown' grows after its mark (both sort outside the first 100).
  readOut.zgone=10;readOutAt.zgone=0;readOut.zgrown=10;readOutAt.zgrown=0;scans.zgrown={offset:0,size:0,taskId:null}
  await writeFile(join(chats,'zgone.json'),JSON.stringify({movedTo:'now',at}));await writeFile(join(chats,'zgrown.json'),JSON.stringify({movedTo:'now',at}))
  await writeFile(join(transcripts,'zgrown.jsonl'),answer('grown','zgrown')+'\n')
  await writeFile(join(transcripts,'now.jsonl'),answer('fresh','now')+'\n')
  await writeFile(join(root,'spending.json'),JSON.stringify(seeded({scans,readOut,readOutAt})))
  let t=base;const clock=()=>(t+=100)
  const collector=createSpendingCollector({dir:root,transcripts,chats,clock});await collector.load()
  await collector.scan([{session:'now',name:'Worker 1',role:'worker'}])
  const ledger=await ledgerOf(root),ids=new Set(ledger.events.map(e=>e.messageId))
  assert.ok(ids.has('fresh'),'the chat\'s own answer is read although discovery took 10 s of the clock')
  assert.ok(ids.has('grown'),'a session whose transcript is newer than its mark is read outside its turn')
  assert.equal(ledger.readOut.zgone,10,'a mark whose transcript and folder are gone is left as it is')
}))

// (b) The 50,000-event cap kept ~10 days, so 30 days and All were incomplete. Dropped events are folded into per-day,
// per-chat, per-model totals (cost worked out per message first). Mutant (dropped events left out): All is 50,000.
const CAP_TOTAL=50300
async function bigTranscripts(transcripts){
  // two chats, one answer a minute for 34.9 days, plus a 1.1 MB tool output (no answer: it must not be a notice).
  const start=Date.now()-36*86400000,lines={a:[toolOutput(1100000)+'\n'],b:[]}
  for(let n=0;n<CAP_TOTAL;n++){const who=n%5===0?'b':'a';lines[who].push(lineAt(`${who}${n}`,who,start+n*60000))}
  await writeFile(join(transcripts,'a.jsonl'),lines.a.join(''));await writeFile(join(transcripts,'b.jsonl'),lines.b.join(''))
  return start
}
const scanAll=async collector=>{for(let n=0;n<20;n++){await collector.scan([{session:'a',name:'Worker A',role:'worker'},{session:'b',name:'Worker B',role:'worker'}]);const c=collector.summary(null).coverage;if(!c.pendingBytes&&!c.pendingFiles)return}}
test('days the cap drops are folded: 30 days and All equal the unfolded count, and the dropped messages are not lost',async()=>place(async({root,transcripts})=>{
  const start=await bigTranscripts(transcripts)
  const collector=createSpendingCollector({dir:root,transcripts,clock:()=>start+CAP_TOTAL*60000+1000});await collector.load();await scanAll(collector)
  const all=collector.summary(null)
  assert.equal(all.messages,CAP_TOTAL)
  assert.equal(all.chats.find(c=>c.key==='Worker B').messages,CAP_TOTAL/5)
  assert.equal(all.chats.find(c=>c.key==='Worker A').messages,CAP_TOTAL*4/5)
  assert.equal(all.models[0].messages,CAP_TOTAL)
  assert.equal(all.daily.reduce((sum,d)=>sum+d.messages,0),CAP_TOTAL)
  assert.ok(all.daily.length>=35,'the dropped days are still listed')
  // The cost is worked out per message before folding: the same as the unfolded one (all answers cost the same).
  const one=estimateUsage({input:10,cacheRead:1000,cacheWrite:0,output:20,actualModel:'claude-opus-5-5'})
  assert.ok(Math.abs(all.knownCost.high-one.high*CAP_TOTAL)<1e-4,`${all.knownCost.high} against ${one.high*CAP_TOTAL}`)
  const month=collector.summary(30)
  assert.equal(month.messages,Array.from({length:CAP_TOTAL},(_,n)=>start+n*60000).filter(t=>t>=month.from).length)
  assert.equal(all.coverage.retentionLimited,true)
  assert.equal(all.coverage.retainedFrom,null,'no "covers only from" line when the days are folded')
  assert.equal(all.coverage.skippedLongLines,0);assert.equal(all.coverage.problem,null,'a 1.1 MB tool output is no notice')
}))

// (b) A ledger kept before the day totals existed is read again once from the start: the dropped days come back.
// Mutant (no re-read): All stays at the 50,000 kept. The oversized notice does not come back during the re-read.
test('a ledger from before the day totals is read again once and the dropped messages come back',async()=>place(async({root,transcripts})=>{
  const start=await bigTranscripts(transcripts),clock=()=>start+CAP_TOTAL*60000+1000
  const first=createSpendingCollector({dir:root,transcripts,clock});await first.load();await scanAll(first)
  // Make it the old ledger: the newest 50,000 events, no day totals, no fold version, the transcripts read to their end.
  const old=await ledgerOf(root);delete old.folded;delete old.foldVersion;delete old.oversizedRule;old.skippedLongLines=7
  assert.equal(old.events.length,50000)
  await writeFile(join(root,'spending.json'),JSON.stringify(old))
  const again=createSpendingCollector({dir:root,transcripts,clock});await again.load()
  assert.equal(again.summary(null).messages,50000,'before the re-read only the kept ones count')
  assert.equal(again.summary(null).coverage.skippedLongLines,0)
  await scanAll(again)
  const all=again.summary(null)
  assert.equal(all.messages,CAP_TOTAL)
  assert.equal(all.coverage.skippedLongLines,0);assert.equal(all.coverage.problem,null)
  // And once: a restart does not read it all again.
  const third=createSpendingCollector({dir:root,transcripts,clock});await third.load()
  assert.equal(third.summary(null).messages,CAP_TOTAL)
  assert.equal(third.summary(null).coverage.pendingBytes,0)
}))

// (d) A zero tail over 1 MB (a crash's zeros) went the oversized-line way and was never marked read out. An all-zero chunk
// advances the offset: no skipped line, no problem. Mutant (zeros go the oversized way): the session is never read out.
test('a zero tail of 2 MB is read out with no skipped line',async()=>place(async({root,transcripts,chats})=>{
  await writeFile(join(transcripts,'cut.jsonl'),Buffer.concat([Buffer.from(answer('a','cut')+'\n'),Buffer.alloc(1990258)]))
  await writeFile(join(chats,'cut.json'),JSON.stringify({movedTo:'gone',at}))
  const collector=createSpendingCollector({dir:root,transcripts,chats,clock:()=>at+1});await collector.load()
  await collector.scan([]);await collector.scan([])
  const summary=collector.summary(7)
  assert.equal(summary.messages,1);assert.equal(summary.coverage.skippedLongLines,0);assert.equal(summary.coverage.problem,null)
  assert.equal(summary.coverage.pendingBytes,0)
  assert.equal(typeof (await ledgerOf(root)).readOut.cut,'number','read out')
}))

// (b) A fork copies old lines under their message ids. Read after the originals were folded, the copies must not be
// counted a second time (live check: 157,501 against 149,482 fold-free). Mutant (folded ids not remembered): All is higher.
test('a fork\'s copy of a folded message is not counted twice',async()=>place(async({root,transcripts})=>{
  const start=await bigTranscripts(transcripts)
  const copies=Array.from({length:300},(_,n)=>lineAt(`b${n*5}`,'c',start+n*5*60000)).join('')
  await writeFile(join(transcripts,'c.jsonl'),copies)
  const {utimes}=await import('node:fs/promises');const old=new Date(Date.now()-86400000);await utimes(join(transcripts,'c.jsonl'),old,old)
  // The clock runs 3 s a call, so a scan reads about a chunk: the copies are read after the originals were folded.
  let t=start+CAP_TOTAL*60000;const collector=createSpendingCollector({dir:root,transcripts,clock:()=>(t+=3000)});await collector.load()
  for(let n=0;n<200;n++){await collector.scan([{session:'a',name:'Worker A',role:'worker'},{session:'b',name:'Worker B',role:'worker'},{session:'c',name:'Worker C',role:'worker'}]);const c=collector.summary(null).coverage;if(!c.pendingBytes&&!c.pendingFiles&&n>3)break}
  const ledger=await ledgerOf(root)
  assert.ok(ledger.folded.length>0)
  assert.equal(collector.summary(null).messages,CAP_TOTAL)
}))

// Round 4 review (1): a folded row lost the task of its messages, so 30 days and All showed too few linked messages, too few
// finished tasks and the folded tasks under "Unassigned". Mutant (taskId out of the fold key and the row): the task figures differ.
const hourly=(from,count,taskOf)=>Array.from({length:count},(_,n)=>({messageId:`h${n}`,sourceAt:from+n*3600000,chat:'c',actualModel:'claude-opus-5-5',actualEffort:'high',phase:'implement',taskId:taskOf(n),input:1,cacheRead:0,cacheWrite:0,output:1}))
test('a folded day keeps its tasks: linked share, finished tasks and the tasks table equal the unfolded ones',()=>{
  const DAY=86400000,from=Date.UTC(2026,9,1,0,30),all=hourly(from,40*24,n=>n<24*3?'B1':n%3===0?'B2':null)
  const now=from+40*DAY,outcomes=[{id:'B1',accepted:true,attempts:1},{id:'B2',accepted:true,attempts:2}]
  const folded=foldEvents([],all.slice(0,-240)),kept=all.slice(-240)
  for(const days of [30,null]){
    const a=routingSummary({events:kept,folded,outcomes,now,days})
    const inside=days===null?all:all.filter(e=>e.sourceAt>=a.from)
    const c=routingSummary({events:inside,folded:[],outcomes,now,days:null})
    assert.equal(a.attributionPercent,c.attributionPercent,`linked share, ${days}`);assert.equal(a.attributedMessages,c.attributedMessages)
    assert.equal(a.accepted,c.accepted,`finished tasks, ${days}`);assert.equal(a.firstPassPercent,c.firstPassPercent)
    assert.deepEqual(a.tasks.map(t=>[t.key,t.messages]),c.tasks.map(t=>[t.key,t.messages]))
  }
  assert.ok(routingSummary({events:kept,folded,outcomes,now,days:null}).tasks.some(t=>t.key==='B1'&&t.messages===72),'a task seen only on folded days is listed')
})

// Round 4 review (2): a folded day is one row at its day's start, and the window filter dropped the day that holds the
// window's start. Now the window begins at that day's start and says so. Mutant (from = asked): 30 days miss the boundary day.
test('30 days count the folded day that holds the window\'s start whole, and the summary says from when',()=>{
  const DAY=86400000,from=Date.UTC(2026,9,1,0,30),all=hourly(from,40*24,()=>null),folded=foldEvents([],all.slice(0,-240)),kept=all.slice(-240)
  for(const iso of ['2026-11-09T00:01:00Z','2026-11-09T10:25:00Z','2026-11-09T23:59:00Z']){
    const now=Date.parse(iso),got=routingSummary({events:kept,folded,outcomes:[],now,days:30}),start=Math.floor((now-30*DAY)/DAY)*DAY
    assert.equal(got.messages,all.filter(e=>e.sourceAt>=start&&e.sourceAt<=now).length,iso)
    assert.equal(got.from,start);assert.equal(got.coverage.widenedFrom,start)
  }
  const exact=routingSummary({events:kept,folded,outcomes:[],now:Date.parse('2026-11-09T00:00:00Z'),days:30})
  assert.equal(exact.coverage.widenedFrom,null,'a window that starts on a day\'s start is not widened')
  const week=routingSummary({events:kept,folded,outcomes:[],now:Date.parse('2026-11-09T10:25:00Z'),days:7})
  assert.equal(week.coverage.widenedFrom,null,'kept events reach back past the window: nothing to widen');assert.equal(week.messages,kept.filter(e=>e.sourceAt>=week.from&&e.sourceAt<=week.until).length)
  assert.equal(routingSummary({events:all,folded:[],outcomes:[],now:Date.parse('2026-11-09T10:25:00Z'),days:30}).coverage.widenedFrom,null,'nothing folded, nothing widened')
})

// Round 4 review (3): the folded ids grew for ever. Only the newest 300,000 are kept. Mutant (no trim): the string grows.
const hashOf=id=>createHash('sha1').update(id).digest('hex').slice(0,12)
test('the ids of folded messages are kept for the newest 300,000 only',async()=>place(async({root,transcripts})=>{
  const events=Array.from({length:50010},(_,n)=>({messageId:`e${n}`,sourceSessionId:'s',chat:'Worker A',phase:'unattributed',sourceAt:at+(n+1)*1000,actualModel:'claude-opus-5-5',actualEffort:null,input:1,cacheWrite:0,cacheRead:0,output:1}))
  await writeFile(join(root,'spending.json'),JSON.stringify(seeded({events,foldedIds:'ab'.repeat(6*300000),foldedBefore:1,retentionLimited:true,retainedFrom:at})))
  await writeFile(join(transcripts,'a.jsonl'),answer('fresh','a')+'\n')
  const collector=createSpendingCollector({dir:root,transcripts,clock:()=>at+1e8});await collector.load()
  await collector.scan([{session:'a',name:'Worker A',role:'worker'}])
  const ledger=await ledgerOf(root)
  assert.equal(ledger.events.length,50000);assert.equal(ledger.foldedIds.length,12*300000)
  assert.ok(ledger.foldedIds.endsWith(hashOf('e9')),'the newest ids are the ones kept')
}))

// Round 4 review (4): the notice said history stops at 50,000 messages.
test('the coverage panel does not say that history is limited to 50,000 messages',async()=>{
  const {readFile}=await import('node:fs/promises'),page=await readFile(new URL('../../public/spending.js',import.meta.url),'utf8')
  assert.ok(!page.includes('History is limited to the latest 50,000'));assert.ok(page.includes('kept as day totals'))
})

// Round 4 review (5): older code (a rollback by land.ps1) keeps foldVersion, trims without folding and writes lastScanAt.
// The ledger it wrote last is read again once. Mutant (foldScanAt not compared): the lost messages stay lost.
test('a ledger that older code wrote after the day totals is read again once',async()=>place(async({root,transcripts})=>{
  const start=await bigTranscripts(transcripts),clock=()=>start+CAP_TOTAL*60000+1000
  const first=createSpendingCollector({dir:root,transcripts,clock});await first.load();await scanAll(first)
  const same=createSpendingCollector({dir:root,transcripts,clock});await same.load()
  assert.equal(same.summary(null).coverage.pendingBytes,0,'a restart of the same code reads nothing again')
  // Older code trims the oldest kept events without folding them, and writes lastScanAt alone.
  const ledger=await ledgerOf(root);ledger.events=ledger.events.slice(100);ledger.lastScanAt+=60000
  await writeFile(join(root,'spending.json'),JSON.stringify(ledger))
  const again=createSpendingCollector({dir:root,transcripts,clock});await again.load();await scanAll(again)
  assert.equal(again.summary(null).messages,CAP_TOTAL)
}))

// Round 4 review (6): a message whose lines are split between two scans was folded after its first line, and its later
// lines (more output tokens) were dropped as a fork's copy. A message of a file that is read only part way stays kept.
// Mutant (fold the oldest whatever is read): the output of the message stays at its first line.
test('a message still being read is not folded before its last line',async()=>place(async({root,transcripts})=>{
  const out=(id,time,tokens)=>JSON.stringify({type:'assistant',sessionId:'q',timestamp:new Date(time).toISOString(),message:{id,model:'claude-opus-5-5',content:[],usage:{input_tokens:10,cache_creation_input_tokens:0,cache_read_input_tokens:1000,output_tokens:tokens}}})+'\n'
  const early=at-86400000,first=Array.from({length:50010},(_,n)=>out(`n${n}`,at+n*60000,20)).join('')+out('split',early,8)
  const filler=toolOutput(900000)+'\n'
  await writeFile(join(transcripts,'q.jsonl'),first+filler+filler+out('split',early,215))
  // The first scan ends after its 12th chunk, the one that holds the first line of 'split' (it ends 12,541,649 bytes in; a
  // chunk is 1 MiB): the clock jumps at its 16th call (the 13th chunk's check), then runs on quietly.
  let calls=0,ended=false
  const collector=createSpendingCollector({dir:root,transcripts,clock:()=>at+40*86400000+(!ended&&++calls>=16?10000:0)});await collector.load()
  await collector.scan([{session:'q',name:'Worker Q',role:'worker'}]);ended=true
  assert.ok(collector.offsetOf('q')>=12541649&&collector.offsetOf('q')<12541649+1048576,'the first scan stopped after the first line of the split message')
  assert.equal(collector.summary(null).messages,50011)
  for(let n=0;n<10;n++)await collector.scan([{session:'q',name:'Worker Q',role:'worker'}])
  const all=collector.summary(null)
  assert.equal(all.messages,50011);assert.equal(all.tokens.output,50010*20+215,'the later line of the split message counts')
}))

// ---- Round 5: follow-ups of the fold ----
const usage={input:1,cacheWrite:0,cacheRead:0,output:1}
const takeCall=id=>[{type:'tool_use',name:'mcp__workers__work',input:{action:'take',id}}]
const msg=(id,time,blocks=[])=>({type:'assistant',messageId:id,at:time,model:'claude-sonnet-5-5',effort:'medium',usage,blocks})
const taskOf=(events,id)=>events.get(id).taskId

// (a) A compaction writes an older stretch of the chat again (same message ids) while a later task is the cursor. The old
// message was never that task's: it is not linked. The take time rides in the cursor between chunks.
// Mutant (no take time: the replayed message takes the task): 'old' is linked to B30.
test('a replayed message older than the take of the current task is not linked to it',()=>{
  const index=new Map(),T=Date.UTC(2026,9,18,8)
  let cursor=attributeUsage({entries:[msg('old',T-3*86400000)],sourceSessionId:'s',chat:'W',role:'worker',index}).cursor
  cursor=attributeUsage({entries:[msg('take',T,takeCall('B30'))],sourceSessionId:'s',chat:'W',role:'worker',index,cursor}).cursor
  assert.equal(cursor.takenAt,T)
  // the next chunk (the cursor comes back from the ledger): the replay, then a message after the take
  cursor=attributeUsage({entries:[msg('old',T-3*86400000),msg('older2',T-86400000),msg('after',T+1000)],sourceSessionId:'s',chat:'W',role:'worker',index,cursor:JSON.parse(JSON.stringify(cursor))}).cursor
  assert.equal(taskOf(index,'old'),null,'a replayed message');assert.equal(taskOf(index,'older2'),null,'a first copy that is older than the take');assert.equal(index.get('older2').phase,'unattributed')
  assert.equal(taskOf(index,'take'),'B30');assert.equal(taskOf(index,'after'),'B30')
  attributeUsage({entries:[msg('rep',T+2000,[{type:'tool_use',name:'mcp__workers__work',input:{action:'report',id:'B30'}}])],sourceSessionId:'s',chat:'W',role:'worker',index,cursor})
  assert.equal(taskOf(index,'rep'),'B30')
})

// (b) The 30-day window widens to the folded day that holds its start when no kept message reaches back past the asked start.
// A held message (its file ends in a cut line) is kept for good and must not switch that off.
// Mutant (held ignored): the window is not widened and the boundary day is left out.
test('a held message does not switch off the widening of the 30-day window',async()=>place(async({root})=>{
  const DAY=86400000,now=Date.UTC(2026,10,7,10),dayStart=Date.UTC(2026,9,8)
  const row={folded:true,sourceAt:dayStart,chat:'c',actualModel:'claude-opus-5-5',actualEffort:'high',phase:'implement',taskId:null,messages:222,unknown:0,low:1,high:2,input:1,cacheRead:0,cacheWrite:0,output:1}
  const ev=(id,time)=>({messageId:id,sourceSessionId:'s',chat:'c',phase:'implement',sourceAt:time,actualModel:'claude-opus-5-5',actualEffort:'high',input:1,cacheWrite:0,cacheRead:0,output:1})
  const events=[ev('stuck',now-40*DAY),ev('k1',now-5*DAY),ev('k2',now-DAY)]
  await writeFile(join(root,'spending.json'),JSON.stringify(seeded({events,folded:[row],retentionLimited:true,scans:{s:{offset:5,size:50,taskId:null,lastMessageId:'stuck'}}})))
  const collector=createSpendingCollector({dir:root,transcripts:join(root,'t'),clock:()=>now});await collector.load()
  const month=collector.summary(30)
  assert.equal(month.coverage.widenedFrom,dayStart);assert.equal(month.messages,222+2,'the boundary day is counted whole')
  assert.equal(routingSummary({events,folded:[row],now,days:30}).coverage.widenedFrom,null,'without the held ids a kept old message reaches back')
}))

// (c) The in-memory set of folded ids follows the cut of the stored string: an id that was cut is not known any more,
// as after a restart. Mutant (the set only grows): the copy of the cut id is dropped as folded.
test('the set of folded ids is rebuilt when the stored string is cut',async()=>place(async({root,transcripts})=>{
  const events=Array.from({length:50010},(_,n)=>({messageId:`e${n}`,sourceSessionId:'s',chat:'Worker A',phase:'unattributed',sourceAt:at+(n+1)*1000,actualModel:'claude-opus-5-5',actualEffort:null,input:1,cacheWrite:0,cacheRead:0,output:1}))
  await writeFile(join(root,'spending.json'),JSON.stringify(seeded({events,foldedIds:hashOf('oldest')+'ab'.repeat(6*299999),foldedBefore:at+1000,retentionLimited:true,retainedFrom:at})))
  await writeFile(join(transcripts,'a.jsonl'),answer('fresh','a')+'\n')
  const collector=createSpendingCollector({dir:root,transcripts,clock:()=>at+1e8});await collector.load()
  const subjects=[{session:'a',name:'Worker A',role:'worker'},{session:'b',name:'Worker B',role:'worker'}]
  await collector.scan(subjects)
  assert.ok(!(await ledgerOf(root)).foldedIds.startsWith(hashOf('oldest')),'the oldest id was cut')
  // a fork copies the cut message; it is counted again, as it is after a restart
  await writeFile(join(transcripts,'b.jsonl'),lineAt('oldest','b',at))
  await collector.scan(subjects)
  assert.equal(collector.summary(null).messages,50010+1+1)
}))

// (d) After a rollback the ledger is read again but its day totals stay: a re-read message at or before foldedBefore is in
// them already. A transcript that is gone or rewritten no longer takes its folded days with it.
// Mutant (the re-read wipes folded as before): the folded days of the emptied transcript are lost.
test('a re-read after a rollback keeps the day totals and does not fold their messages again',async()=>place(async({root,transcripts})=>{
  const start=await bigTranscripts(transcripts),clock=()=>start+CAP_TOTAL*60000+1000
  const first=createSpendingCollector({dir:root,transcripts,clock});await first.load();await scanAll(first)
  const ledger=await ledgerOf(root);ledger.lastScanAt+=60000
  await writeFile(join(root,'spending.json'),JSON.stringify(ledger))
  await writeFile(join(transcripts,'b.jsonl'),'')
  const again=createSpendingCollector({dir:root,transcripts,clock});await again.load();await scanAll(again)
  assert.equal(again.summary(null).messages,CAP_TOTAL,'nothing lost, nothing twice')
  assert.equal(again.summary(null).chats.find(c=>c.key==='Worker B').messages,CAP_TOTAL/5)
  assert.equal((await ledgerOf(root)).rereadBefore,undefined,'the re-read is over')
  const third=createSpendingCollector({dir:root,transcripts,clock});await third.load()
  assert.equal(third.summary(null).messages,CAP_TOTAL);assert.equal(third.summary(null).coverage.pendingBytes,0)
}))

// (e) Rows older than 60 days are split in dimension rows (chat, model, effort, phase, linked; every table but Tasks) and task
// rows (task; only the Tasks table), both merged per month. Each table's totals stay the same; newer rows stay per day.
// Mutant (a task row counted in the totals): messages and costs double. Mutant (a dimension row counted in the Tasks table):
// the Unassigned and task rows double.
test('folded rows older than 60 days are split in dimension and task rows and every table keeps its totals',()=>{
  const DAY=86400000,now=Date.UTC(2026,10,7,10),chats=['A','B','C'],models=['claude-opus-5-5','claude-sonnet-5-5'],efforts=['high','medium',null],phases=['implement','spec','coordinate']
  const events=Array.from({length:150*24},(_,n)=>({messageId:`x${n}`,sourceAt:now-150*DAY+n*3600000,chat:chats[n%3],actualModel:models[n%2],actualEffort:efforts[n%3],phase:phases[n%7%3],taskId:n%11===0?null:`B${Math.floor(n/240)}`,input:n%5,cacheRead:n,cacheWrite:1,output:2}))
  const rows=foldEvents([],events),cutoff=now-FOLD_MERGE_DAYS*DAY,merged=compactFolded(rows,cutoff)
  const months=new Set(merged.filter(r=>r.sourceAt<cutoff).map(r=>r.sourceAt))
  assert.ok(months.size>=4,`the old rows span ${months.size} months`)
  assert.ok(merged.length<rows.length/2,`${rows.length} rows became ${merged.length}`)
  assert.ok(merged.filter(r=>r.sourceAt>=cutoff).length===rows.filter(r=>r.sourceAt>=cutoff).length,'recent rows stay per day')
  assert.ok(merged.filter(r=>r.sourceAt>=cutoff).every(r=>r.part===undefined),'recent rows are not split')
  assert.ok(merged.filter(r=>r.sourceAt<cutoff).every(r=>new Date(r.sourceAt).getUTCDate()===1&&r.sourceAt%DAY===0&&(r.part==='dims'||r.part==='task')),'old rows sit on a month start and are split')
  assert.ok(merged.filter(r=>r.part==='task').every(r=>r.chat===undefined&&r.phase===undefined),'a task row has no dimensions')
  assert.ok(merged.filter(r=>r.part==='dims').every(r=>r.taskId===undefined&&typeof r.linked==='boolean'),'a dimension row has no task')
  const outcomes=['B0','B1','B2','B3','B4','B5','B6'].map((id,n)=>({id,accepted:n%2===0,attempts:1+n%3}))
  const opts={events:[],now,days:null,outcomes}
  const a=routingSummary({...opts,folded:rows}),b=routingSummary({...opts,folded:merged})
  const trim=t=>t.map(r=>[r.key,r.messages,r.unknown,r.low,r.high,r.input,r.cacheRead,r.cacheWrite,r.output])
  for(const table of ['models','efforts','chats','phases','tasks'])assert.deepEqual(trim(b[table]),trim(a[table]),table)
  assert.ok(b.tasks.some(t=>t.key==='Unassigned')&&b.tasks.some(t=>t.outcome),'the tasks table has an Unassigned row and outcomes')
  for(const k of ['messages','unknownCostMessages','attributedMessages','attributionPercent','accepted','qualitySample','firstPassPercent'])assert.equal(b[k],a[k],k)
  assert.deepEqual(b.knownCost,a.knownCost);assert.deepEqual(b.tokens,a.tokens);assert.deepEqual(b.attributedCostPerAccepted,a.attributedCostPerAccepted);assert.deepEqual(b.suggestions,a.suggestions)
  assert.equal(b.coverage.earliestMessage,a.coverage.earliestMessage)
  // The daily table: the days of the last 60 stay; a month before shows as one row on its first day, with the month's total.
  const monthOf=k=>k.slice(0,7),perMonth=d=>{const m={};for(const r of d.filter(r=>r.key<=new Date(cutoff).toISOString().slice(0,10))){const t=m[monthOf(r.key)]??=[0,0,0,0,0,0,0,0];[r.messages,r.unknown,r.low,r.high,r.input,r.cacheRead,r.cacheWrite,r.output].forEach((v,i)=>t[i]+=v)}return m}
  const close=(x,y)=>{assert.deepEqual(Object.keys(x),Object.keys(y));for(const m of Object.keys(x))x[m].forEach((v,i)=>assert.ok(Math.abs(v-y[m][i])<1e-6,`${m} ${i}`))}
  close(perMonth(b.daily),perMonth(a.daily))
  assert.equal(b.daily.reduce((n,d)=>n+d.messages,0),a.daily.reduce((n,d)=>n+d.messages,0))
  assert.deepEqual(trim(b.daily.filter(d=>d.key>new Date(cutoff).toISOString().slice(0,10))),trim(a.daily.filter(d=>d.key>new Date(cutoff).toISOString().slice(0,10))),'the last 60 days stay per day')
  assert.deepEqual(compactFolded(merged,cutoff),merged,'merging again changes nothing')
  // Rows folded later join the split rows of their month.
  const more=foldEvents(merged,[{messageId:'late',sourceAt:Date.UTC(2026,8,1,5),chat:'A',actualModel:'claude-opus-5-5',actualEffort:'high',phase:'implement',taskId:'B1',input:1,cacheRead:0,cacheWrite:0,output:1}])
  const both=compactFolded(more,cutoff),after=routingSummary({...opts,folded:both})
  assert.equal(after.messages,a.messages+1);assert.equal(after.tasks.reduce((n,t)=>n+t.messages,0),a.messages+1)
  // A window cuts a split month in both parts alike.
  for(const d of [30,200]){const x=routingSummary({...opts,folded:rows,days:d,now}),y=routingSummary({...opts,folded:merged,days:d,now});assert.equal(y.tasks.reduce((n,t)=>n+t.messages,0),y.messages,`window ${d}: the tasks table and the totals agree`);if(d===30)assert.deepEqual(trim(y.tasks),trim(x.tasks))}
})
test('a fold in the collector merges the rows of the old days',async()=>place(async({root,transcripts})=>{
  const DAY=86400000,now=Date.UTC(2026,10,7,10)
  const events=Array.from({length:50010},(_,n)=>({messageId:`e${n}`,sourceSessionId:'s',chat:'Worker A',phase:'unattributed',sourceAt:now-100*DAY+Math.floor(n/10)*60000+(n<10?-DAY:0),actualModel:'claude-opus-5-5',actualEffort:null,input:1,cacheWrite:0,cacheRead:0,output:1}))
  const day=k=>({folded:true,sourceAt:Date.UTC(2026,7,k),chat:'Worker A',actualModel:'claude-opus-5-5',actualEffort:null,phase:'unattributed',taskId:null,messages:3,unknown:0,low:1,high:1,input:3,cacheRead:0,cacheWrite:0,output:3})
  await writeFile(join(root,'spending.json'),JSON.stringify(seeded({events,folded:[day(1),day(2),day(3)],retentionLimited:true})))
  await writeFile(join(transcripts,'a.jsonl'),answer('fresh','a')+'\n')
  const collector=createSpendingCollector({dir:root,transcripts,clock:()=>now});await collector.load()
  await collector.scan([{session:'a',name:'Worker A',role:'worker'}])
  const ledger=await ledgerOf(root)
  assert.ok(ledger.folded.length>0&&ledger.folded.every(r=>new Date(r.sourceAt).getUTCDate()===1),'every old row is on a month start')
  assert.equal(ledger.folded.filter(r=>r.part==='dims').reduce((n,r)=>n+r.messages,0),9+11)
  assert.equal(ledger.folded.filter(r=>r.part==='task').reduce((n,r)=>n+r.messages,0),9+11)
}))
