import {mkdir,open,readFile,readdir,stat} from 'node:fs/promises'
import {join} from 'node:path'
import {createHash} from 'node:crypto'
import {writeAtomic} from '../../write.mjs'
import {parseTail} from '../../transcript.mjs'
import {attributeUsage,compactFolded,foldEvents,routingSummary,FOLD_MERGE_DAYS} from './metrics.mjs'

const CHUNK=1024*1024,MAX_EVENTS=50000,MAX_FILES=32,TAIL_BYTES=16*CHUNK,MAX_BYTES=96*CHUNK,MAX_SCAN_MS=5000,MAX_CHILDREN=4096,READ_OUT_SLICE=100
// Round 4 (b): a ledger without day totals is read again once from the start, so the days the cap dropped are folded.
// 2: a folded row keeps its task. The ids of folded messages are kept for the newest MAX_FOLDED_IDS only.
const FOLD_VERSION=2,MAX_FOLDED_IDS=6*MAX_EVENTS
const isZeros=bytes=>bytes.every(byte=>byte===0)
// Round 4 (b): a message that was folded is known by a 12-hex hash of its id; a copy of it (a fork copies old lines) read
// later is not counted twice.
const hashOf=id=>createHash('sha1').update(id).digest('hex').slice(0,12)
const statOf=path=>stat(path).catch(()=>null)
// Round 4 (c): of 1,291 lines over 1 MB none was an answer (user lines, request blobs): only an answer's line hides
// usage, so only it is counted as skipped. Its type stands in its first bytes.
const isAnswerLine=bytes=>bytes.subarray(0,4096).includes('"type":"assistant"')
const OVERSIZED_RULE=1

/**
 * Spending counts every chat: every clear starts a new session, and the card of the old one names the next (`movedTo`,
 * .claude/chats). A left session is counted under the chat its chain of moves ends in; a chain that ends in no named
 * card under "Earlier chat". `cards` keeps what was read: a moved card never changes, a named one is read again.
 * A named card that is no chat's own session now is read under its name, and kept looking at. A session that left the
 * board, or a chain that ends in no named card, is named by `titleOf` (the app's title of the session) where it can be.
 */
/**
 * A card's fields. A card cut short (four were cut at 70 bytes on 24-26 Oct) does not parse; its name, role, move and
 * leaving are still read from what is there, so a chain of moves through it is not broken.
 */
export function cardOf(text){
  try{return JSON.parse(text)}catch{}
  const field=key=>new RegExp('"'+key+'"\\s*:\\s*"([^"]*)"').exec(text)?.[1]
  const card={}
  for(const key of ['name','role','movedTo'])if(field(key)!==undefined)card[key]=field(key)
  if(/"left"\s*:\s*true/.test(text))card.left=true
  return card
}

export async function movedSubjects(chats,cards=new Map(),titleOf=()=>null){
  for(const name of await readdir(chats)){
    if(!/^[\w-]+\.json$/.test(name))continue
    const session=name.slice(0,-5)
    if(typeof cards.get(session)?.movedTo==='string')continue
    try{cards.set(session,cardOf(await readFile(join(chats,name),'utf8')))}catch{}
  }
  const subjects=[]
  for(const [session,card] of cards){
    // A named card whose session is not a chat's own now (a chat started anew, a second window) is read under its name.
    // A card of a session that left the board has no chat.
    if(typeof card?.name==='string'&&card.name!==''&&typeof card.movedTo!=='string'){subjects.push({session,name:card.name,role:typeof card.role==='string'?card.role:'worker',left:true});continue}
    if(card?.left===true){subjects.push({session,name:titleOf(session)??'Earlier chat',role:'worker',left:true});continue}
    if(typeof card?.movedTo!=='string')continue
    let at=session;const seen=new Set()
    while(typeof cards.get(at)?.movedTo==='string'&&!seen.has(at)){seen.add(at);at=cards.get(at).movedTo}
    const end=cards.get(at)
    subjects.push({session,name:typeof end?.name==='string'&&end.name!==''?end.name:titleOf(at)??titleOf(session)??'Earlier chat',role:typeof end?.role==='string'?end.role:'worker',left:true})
  }
  return subjects
}
/**
 * The files of a session, each with its size (null: not there): its transcript, its native children
 * (<session>/subagents/*.jsonl) and its workflow agents (<session>/subagents/workflows/<run>/*.jsonl). `limited` when
 * a folder holds more children than are read.
 */
export async function sessionFiles(transcripts,session){
  const files=[],main=join(transcripts,`${session}.jsonl`)
  files.push({key:session,path:main,size:(await statOf(main))?.size??null})
  let limited=false,problem=null
  const children=async(folder,keyOf,idOf)=>{
    let names
    try{names=(await readdir(folder,{withFileTypes:true})).filter(f=>f.isFile()&&/^[\w-]+\.jsonl$/.test(f.name)).map(f=>f.name).sort()}
    catch(error){if(error.code!=='ENOENT')problem=error.code??'read failed';return}
    if(files.length+names.length>MAX_CHILDREN+1)limited=true
    for(const name of names.slice(0,Math.max(0,MAX_CHILDREN+1-files.length))){const path=join(folder,name);files.push({key:keyOf(name),path,child:idOf(name),size:(await statOf(path))?.size??null})}
  }
  const subagents=join(transcripts,session,'subagents')
  await children(subagents,name=>`${session}/subagents/${name}`,name=>name.slice(0,-6))
  let runs=[]
  try{runs=(await readdir(join(subagents,'workflows'),{withFileTypes:true})).filter(f=>f.isDirectory()&&/^[\w-]+$/.test(f.name)).map(f=>f.name).sort()}
  catch(error){if(error.code!=='ENOENT')problem=error.code??'read failed'}
  for(const run of runs)await children(join(subagents,'workflows',run),name=>`${session}/subagents/workflows/${run}/${name}`,name=>`${run}/${name.slice(0,-6)}`)
  return {files,limited,problem}
}
/** A session's mark when read to its end: the bytes of all its files, so a child that grows undoes it too. */
const bytesOf=files=>files.reduce((sum,file)=>sum+(file.size??0),0)
const nonnegative=n=>Number.isFinite(n)&&n>=0
const nullableString=s=>s===null||typeof s==='string'
function validLedger(raw){
  return raw?.version===1&&Array.isArray(raw.events)&&raw.events.every(e=>e&&typeof e.messageId==='string'&&typeof e.sourceSessionId==='string'&&typeof e.chat==='string'&&typeof e.phase==='string'&&nonnegative(e.sourceAt)&&Number.isFinite(new Date(e.sourceAt).getTime())&&nullableString(e.actualModel)&&nullableString(e.actualEffort)&&['input','cacheWrite','cacheRead','output'].every(k=>e[k]===null||nonnegative(e[k])))&&raw.scans&&typeof raw.scans==='object'&&!Array.isArray(raw.scans)&&Object.values(raw.scans).every(s=>s&&Number.isSafeInteger(s.offset)&&s.offset>=0&&(s.size===undefined||nonnegative(s.size))&&(s.taskId===undefined||nullableString(s.taskId)))&&(raw.startedAt===undefined||nonnegative(raw.startedAt))&&(raw.unknown===undefined||nonnegative(raw.unknown))&&(raw.nextScanIndex===undefined||Number.isSafeInteger(raw.nextScanIndex)&&raw.nextScanIndex>=0)
}
/**
 * The app's titles of its sessions (its session files, `appSessions`), by session id, without a project's prefix
 * ("<project> - Worker 7" is "Worker 7"): the name of a chat that left the board.
 */
export async function appTitles(appSessions){
  const titles=new Map()
  const walk=async(folder,depth)=>{
    for(const entry of await readdir(folder,{withFileTypes:true}).catch(()=>[])){
      const path=join(folder,entry.name)
      if(entry.isDirectory()&&depth<3)await walk(path,depth+1)
      else if(entry.isFile()&&/\.json$/.test(entry.name)){
        try{const one=JSON.parse(await readFile(path,'utf8'));if(typeof one.cliSessionId==='string'&&typeof one.title==='string'&&one.title.trim()!=='')titles.set(one.cliSessionId,one.title.trim().replace(/^[^-]*? - /,''))}catch{}
      }
    }
  }
  await walk(appSessions,0)
  return titles
}

export function createSpendingCollector({dir,transcripts,chats=null,appSessions=null,clock=Date.now}){
  let ledger={version:1,events:[],scans:{},startedAt:clock(),lastScanAt:null,unknown:0,retentionLimited:false},busy=false,problem=null,outcomes=[],unavailable=false
  let keptFor={events:null,outcomes:null,folded:null};const kept=new Map(),cards=new Map();let byId=null,byIdFor=null,titles=new Map(),titlesAt=-Infinity,outcomesKey='[]'
  // The events by message id, kept between scans: a chunk looks its answers up instead of building the map anew.
  const indexOf=()=>{if(byIdFor!==ledger.events){byId=new Map(ledger.events.map(e=>[e.messageId,e]));byIdFor=ledger.events}return byId}
  const file=join(dir,'spending.json')
  let idSet=null,idSetFor=null,rereadKeep=new Set()
  // A message whose file is read only part way: its last line is not read, so it is not folded and does not count as old.
  const heldIds=()=>new Set(Object.values(ledger.scans).filter(s=>s.lastMessageId&&s.offset<(s.size??s.offset)).map(s=>s.lastMessageId))
  // Built when a copy of a folded message can be among the events (rare), not at every start.
  const foldedSet=()=>{if(idSetFor!==ledger.foldedIds||idSet===null){idSet=new Set((ledger.foldedIds??'').match(/.{12}/g)??[]);idSetFor=ledger.foldedIds}return idSet}
  const coverage=()=>({startedAt:ledger.startedAt,lastScanAt:ledger.lastScanAt,unknownMessages:ledger.unknown??0,skippedLongLines:ledger.skippedLongLines??0,pendingBytes:Object.values(ledger.scans).reduce((sum,scan)=>sum+Math.max(0,(scan.size??scan.offset)-scan.offset),0),pendingFiles:ledger.pendingFiles??0,childTranscripts:ledger.childTranscripts??0,unavailableTranscripts:ledger.unavailableTranscripts??0,discoveryLimited:ledger.discoveryLimited??false,retentionLimited:ledger.retentionLimited,retainedFrom:ledger.retentionLimited&&!Array.isArray(ledger.folded)?ledger.retainedFrom??null:null,collecting:busy,problem,unavailable,scope:'Recorded project chats and discovered native children, including Main and Advisors; missing or still-pending transcripts leave totals incomplete.'})
  return {
    async load(){
      try{const raw=JSON.parse(await readFile(file,'utf8'));if(!validLedger(raw))throw Error('Unsupported or corrupt spending ledger');ledger={...ledger,...raw};if(ledger.retentionLimited&&ledger.retainedFrom===undefined)ledger.retainedFrom=ledger.events.reduce((first,e)=>Math.min(first,e.sourceAt),Infinity);for(const [session,mark] of Object.entries(ledger.readOut??{}))if(typeof mark!=='number')delete ledger.readOut[session]
        // The count kept before counted every long line; checked on the live data (chat 1, 2026-11-05), none was an answer.
        if(ledger.oversizedRule!==OVERSIZED_RULE){ledger.skippedLongLines=0;ledger.oversizedRule=OVERSIZED_RULE}
        if(ledger.foldVersion!==FOLD_VERSION||(ledger.foldScanAt??null)!==(ledger.lastScanAt??null)){
          // (foldScanAt: the code that folds writes it with lastScanAt; older code writes lastScanAt alone and drops messages
          // unfolded, so a ledger it wrote last is read again once.)
          // Read every transcript again from its start: the messages the cap dropped come back and are folded into day
          // totals; the kept ones are merged by message id. The oversized lines and unknown messages are counted anew.
          for(const scan of Object.values(ledger.scans)){scan.offset=0;scan.taskId=null;delete scan.takenAt;delete scan.skippingLine;delete scan.lastMessageId}
          // Round 5 (d): after a rollback (same fold version) the day totals are right: they stay, and the messages read again
          // that are at or before `foldedBefore` are already in them (`rereadBefore`). A new fold version has other rows: wiped.
          if(ledger.foldVersion===FOLD_VERSION&&Array.isArray(ledger.folded))ledger.rereadBefore=ledger.foldedBefore??0
          else{ledger.folded=[];ledger.foldedIds='';ledger.foldedBefore=0;delete ledger.rereadBefore}
          ledger.readOut={};ledger.readOutAt={};ledger.skippedLongLines=0;ledger.unknown=0;ledger.foldVersion=FOLD_VERSION;ledger.oversizedRule=OVERSIZED_RULE
        }
        // What was kept at or before that time when the re-read began (a message held half read) stays; a restart finds it too.
        if(ledger.rereadBefore!==undefined)rereadKeep=new Set(ledger.events.filter(e=>e.sourceAt<=ledger.rereadBefore).map(e=>e.messageId))}
      catch(error){if(error.code!=='ENOENT'){unavailable=true;problem='Spending history is unavailable. The previous file is preserved; repair or move it aside before restarting collection.'}}
      if(ledger.foldVersion===undefined){ledger.foldVersion=FOLD_VERSION;ledger.folded=[];ledger.foldedIds='';ledger.foldedBefore=0}
    },
    // B917 (X93): the board's every rebuild asked 5 summaries over all events, 374 ms each time; one is kept per period
    // while the events and outcomes are the same and its window starts in the same minute (the time and coverage fresh).
    summary(days=7){
      try{
        const now=clock(),period=days===null?'all':Number.isInteger(days)?`d${days}`:'part',minute=days===null?null:Math.floor((now-days*86400000)/60000)
        // Round 4 (f): the outcomes are a new list every scan; they count as changed only when their content is.
        if(keptFor.events!==ledger.events||keptFor.outcomes!==outcomesKey||keptFor.folded!==ledger.folded){kept.clear();keptFor={events:ledger.events,outcomes:outcomesKey,folded:ledger.folded}}
        const was=kept.get(period)
        if(was?.minute===minute)return {...was.value,days,until:now,coverage:{...was.value.coverage,...coverage()}}
        // A window that moved past no message (its first one is still inside) gives the same summary.
        const from=days===null?null:now-days*86400000,first=was?.value.coverage.earliestMessage
        if(was&&from!==null&&Number.isFinite(first)&&from<=first){kept.set(period,{minute,value:was.value});return {...was.value,days,from,until:now,coverage:{...was.value.coverage,...coverage()}}}
        const value=routingSummary({events:ledger.events,folded:ledger.folded??[],outcomes,now,days,coverage:coverage(),held:heldIds()})
        kept.set(period,{minute,value})
        return value
      }
      catch{unavailable=true;problem='Spending is unavailable. Its local history is preserved; other board functions remain available.';return routingSummary({events:[],outcomes:[],now:clock(),days,coverage:{problem,unavailable:true}})}
    },
    /** Clear after each step: how far a session's transcript is read (a left session is read on to its end). */
    offsetOf(key){return ledger.scans[key]?.offset??0},
    async scan(subjects,{assignments=[],results=[]}={}){
      if(busy||!transcripts||unavailable)return
      busy=true;outcomes=results;outcomesKey=JSON.stringify(results)
      try{
        let changed=false,bytes=0,missing=0
        const index=indexOf(),readOut=ledger.readOut??{},readOutAt=ledger.readOutAt??{}
        const jobs=[];ledger.discoveryLimited=false
        // Spending counts every chat: the sessions a clear left are read too, under the chat their moves end in.
        const own=new Set(subjects.map(one=>one.session))
        // The app's titles are read again at most every ten minutes.
        if(appSessions&&clock()-titlesAt>=600000){titles=await appTitles(appSessions);titlesAt=clock()}
        const titleOf=session=>titles.get(session)??null
        const claimed=(chats?await movedSubjects(chats,cards,titleOf).catch(error=>{if(error.code!=='ENOENT')problem='The sessions cleared chats left could not be listed; totals are incomplete.';return []}):[]).filter(one=>!own.has(one.session))
        // And every other session of the project (a side chat that never joined the board): under its app title.
        const known=new Set([...own,...claimed.map(one=>one.session)])
        const others=chats?(await readdir(transcripts).catch(()=>[])).filter(name=>/^[\w-]+\.jsonl$/.test(name)).map(name=>name.slice(0,-6)).filter(session=>!known.has(session)).map(session=>({session,name:titleOf(session)??'Earlier chat',role:'worker',left:true})):[]
        const left=[...claimed,...others],filesOf=new Map()
        // Round 4 (a): a read-out session is walked whole only when its transcript or its children's folder changed since
        // its mark, or in its turn: READ_OUT_SLICE of them a scan, in rotation. One whose transcript and folder are gone is not.
        const marked=left.filter(one=>readOut[one.session]!==undefined&&!own.has(one.session)).map(one=>one.session).sort()
        const sliceFrom=marked.length?(ledger.readOutCursor??0)%marked.length:0
        const inTurn=new Set(Array.from({length:Math.min(READ_OUT_SLICE,marked.length)},(_,n)=>marked[(sliceFrom+n)%marked.length]))
        ledger.readOutCursor=marked.length?(sliceFrom+inTurn.size)%marked.length:0
        for(const subject of [...subjects,...left]){
          if(!/^[\w-]+$/.test(subject.session??'')||filesOf.has(subject.session))continue
          if(readOut[subject.session]!==undefined&&!own.has(subject.session)&&!inTurn.has(subject.session)){
            const [main,folder]=await Promise.all([statOf(join(transcripts,`${subject.session}.jsonl`)),statOf(join(transcripts,subject.session,'subagents'))])
            if(main===null&&folder===null)continue
            if(Math.max(main?.mtimeMs??0,folder?.mtimeMs??0)<=(readOutAt[subject.session]??0))continue
          }
          const found=await sessionFiles(transcripts,subject.session)
          if(found.limited)ledger.discoveryLimited=true
          if(found.problem){ledger.discoveryLimited=true;problem='Some native child transcripts could not be discovered; totals are incomplete.'}
          // A left session read to its end is skipped while all its files have the bytes they had then. One that grew (a
          // chat resumed it, a child of it goes on, it is still in use) or that is a chat's own again is read on.
          if(readOut[subject.session]!==undefined){
            if(!own.has(subject.session)&&bytesOf(found.files)===readOut[subject.session]){if(readOutAt[subject.session]===undefined)changed=true;readOutAt[subject.session]=clock();continue}
            delete readOut[subject.session];delete readOutAt[subject.session];changed=true
          }
          filesOf.set(subject.session,found.files)
          for(const file of found.files){
            // A left session whose transcript is gone has nothing to read: it is read out, never "unavailable".
            if(file.size===null&&!file.child&&subject.left){if(ledger.scans[file.key])ledger.scans[file.key]={...ledger.scans[file.key],unavailable:false,size:ledger.scans[file.key].offset};continue}
            jobs.push(file.child===undefined?{...subject,key:file.key,path:file.path}:{session:`${subject.session}:child:${file.child}`,parentSessionId:subject.session,key:file.key,path:file.path,name:subject.name,role:'child',left:subject.left})
          }
        }
        // The scan's time to read starts here, after the looking around.
        const began=clock()
        // One file read on from its offset: at most `chunks` chunks, within `most` bytes of this scan; the board answers between chunks.
        const readOn=async(subject,chunks,most)=>{
          let handle
          try{
            handle=await open(subject.path,'r')
            const stat=await handle.stat(),before=ledger.scans[subject.key]??{offset:0,taskId:null}
            let scan={...before,size:stat.size,unavailable:false};if(scan.offset>stat.size)scan={offset:0,taskId:null,size:stat.size}
            for(let chunk=0;chunk<chunks&&scan.offset<stat.size&&bytes<most&&clock()-began<MAX_SCAN_MS;chunk++){
              const buffer=Buffer.alloc(Math.min(CHUNK,stat.size-scan.offset,most-bytes));const {bytesRead}=await handle.read(buffer,0,buffer.length,scan.offset);bytes+=bytesRead
              if(!bytesRead)break
              let lineStart=0
              if(scan.skippingLine){const newline=buffer.indexOf(10);if(newline<0){if(isZeros(buffer.subarray(0,bytesRead)))scan.skippingLine=false;scan.offset+=bytesRead;changed=true;continue}lineStart=newline+1;scan.skippingLine=false}
              const end=buffer.lastIndexOf(10,bytesRead-1)
              if(end<lineStart){
                // A crash left a tail of zeros and no newline at the file's end: there is nothing more to read in it.
                if(scan.offset+bytesRead===stat.size&&buffer.subarray(lineStart,bytesRead).every(byte=>byte===0)){scan.offset=stat.size;changed=true;break}
                // Round 4 (d): a chunk of a crash's zeros is passed over, no line and no problem.
                if(bytesRead===CHUNK&&isZeros(buffer.subarray(lineStart,bytesRead))){scan.offset+=bytesRead;changed=true;continue}
                if(bytesRead===CHUNK){if(isAnswerLine(buffer.subarray(lineStart,bytesRead))){ledger.skippedLongLines=(ledger.skippedLongLines??0)+1;problem='Oversized transcript lines are excluded; collection continues after them.'}scan.skippingLine=true;scan.offset+=bytesRead;changed=true;continue}
                if(lineStart>0){scan.offset+=lineStart;changed=true}
                break
              }
              // Only an answer's line carries usage: the rest (tool output, the bulk of a transcript) is never parsed.
              const answers=buffer.subarray(lineStart,end+1).toString('utf8').split('\n').filter(line=>line.includes('"type":"assistant"')).join('\n')
              const entries=parseTail(answers,false,true),lastAnswer=entries.findLast(e=>e.type==='assistant'&&e.messageId)?.messageId
              const found=attributeUsage({entries,sourceSessionId:subject.session,parentSessionId:subject.parentSessionId??null,chat:subject.name,role:subject.role,assignments,index,cursor:scan})
              ledger.unknown+=found.unknown;scan={...scan,...found.cursor,offset:scan.offset+end+1};if(lastAnswer)scan.lastMessageId=lastAnswer;changed=true
              await new Promise(done=>setImmediate(done))
            }
            // The file is read to its end: no message of it is still being written.
            if(scan.offset>=stat.size)delete scan.lastMessageId
            ledger.scans[subject.key]=scan
          }catch(error){missing++;ledger.scans[subject.key]={...(ledger.scans[subject.key]??{offset:0,taskId:null}),unavailable:true};if(error.code!=='ENOENT')problem=`Some local usage is unavailable (${error.code??'read failed'}).`}
          finally{await handle?.close()}
        }
        // First the chats' own sessions in turn, two chunks each, as before: their newest answers show within a minute.
        const lanes=jobs.filter(j=>!j.left)
        const start=lanes.length?(ledger.nextScanIndex??0)%lanes.length:0
        let visited=0
        while(visited<Math.min(MAX_FILES,lanes.length)&&bytes<TAIL_BYTES)await readOn(lanes[(start+visited++)%lanes.length],2,TAIL_BYTES)
        ledger.nextScanIndex=lanes.length?(start+visited)%lanes.length:0
        // Then every file still behind, the most recently written first, on to the scan's bytes: a backlog of a GB is read within the hour.
        const behind=[]
        for(const job of jobs){
          const found=await statOf(job.path),scan=ledger.scans[job.key]
          if(found!==null&&scan!==undefined)scan.size=found.size
          if(found!==null&&(scan===undefined||scan.offset!==found.size))behind.push({job,at:found.mtimeMs})
        }
        for(const {job} of behind.sort((a,b)=>b.at-a.at)){
          if(bytes>=MAX_BYTES||clock()-began>=MAX_SCAN_MS)break
          await readOn(job,Infinity,MAX_BYTES)
        }
        // A left session read to its end, its children too, is marked with the bytes of all its files.
        const jobsOf=new Map()
        for(const job of jobs){const session=job.parentSessionId??job.key;if(!jobsOf.has(session))jobsOf.set(session,[]);jobsOf.get(session).push(job)}
        for(const one of left){
          if(!filesOf.has(one.session))continue
          const mine=jobsOf.get(one.session)??[]
          if(mine.every(j=>{const scan=ledger.scans[j.key];return scan!==undefined&&!scan.unavailable&&!scan.skippingLine&&scan.offset===scan.size})){
            // A new mark is written too, so it holds after a restart.
            const bytes=mine.reduce((sum,j)=>sum+ledger.scans[j.key].size,0)
            if(readOut[one.session]!==bytes){readOut[one.session]=bytes;readOutAt[one.session]=clock();changed=true}
          }
        }
        ledger.readOut=readOut;ledger.readOutAt=readOutAt
        // Every child read so far counts, also of sessions read out.
        ledger.childTranscripts=Object.keys(ledger.scans).filter(key=>key.includes('/subagents/')).length
        ledger.pendingFiles=jobs.filter(j=>!ledger.scans[j.key]).length
        ledger.unavailableTranscripts=Math.max(missing,jobs.filter(j=>ledger.scans[j.key]?.unavailable).length)
        if(changed){
          let events=[...index.values()],rebuilt=false
          // Round 5 (d): while the ledger is read again after a rollback, a message at or before `foldedBefore` is in the day totals.
          if(ledger.rereadBefore!==undefined){const fresh=events.filter(e=>e.sourceAt>ledger.rereadBefore||rereadKeep.has(e.messageId));if(fresh.length!==events.length){events=fresh;rebuilt=true}}
          // A copy of a message folded before (a fork's old lines) is dropped, not counted again. The ids are looked up only
          // when an event is old enough to be such a copy.
          if(ledger.foldedIds&&events.some(e=>e.sourceAt<=(ledger.foldedBefore??0))){const known=foldedSet();const fresh=events.filter(e=>!(e.sourceAt<=(ledger.foldedBefore??0)&&known.has(hashOf(e.messageId))));if(fresh.length!==events.length){events=fresh;rebuilt=true}}
          if(events.length>MAX_EVENTS){
            events.sort((a,b)=>a.sourceAt-b.sourceAt)
            // A message whose file is read only part way may have lines still to come (output tokens, a task link): it
            // stays kept, and is folded in a later scan.
            const open=heldIds(),cut=events.length-MAX_EVENTS
            const dropped=events.slice(0,cut).filter(e=>!open.has(e.messageId)),hashes=dropped.map(e=>hashOf(e.messageId))
            if(dropped.length){
              ledger.folded=compactFolded(foldEvents(ledger.folded??[],dropped),clock()-FOLD_MERGE_DAYS*86400000)
              const before=ledger.foldedIds??'',joined=before+hashes.join('');ledger.foldedIds=joined.slice(-12*MAX_FOLDED_IDS);ledger.foldedBefore=Math.max(ledger.foldedBefore??0,dropped[dropped.length-1].sourceAt)
              // Round 5 (c): the set follows the cut: when ids were cut it is built anew from the string at the next look-up.
              if(joined.length>ledger.foldedIds.length)idSet=null
              else if(idSet!==null&&idSetFor===before){for(const h of hashes)idSet.add(h);idSetFor=ledger.foldedIds}
            }
            events=[...events.slice(0,cut).filter(e=>open.has(e.messageId)),...events.slice(cut)];ledger.retentionLimited=true;ledger.retainedFrom=events[0]?.sourceAt??null;rebuilt=true
          }
          if(rebuilt)byId=new Map(events.map(e=>[e.messageId,e]))
          ledger.events=events;byIdFor=events
        }
        // Round 5 (d): the re-read after a rollback is over when every file is read to its end (or cannot be read).
        if(ledger.rereadBefore!==undefined&&!ledger.pendingFiles&&Object.values(ledger.scans).every(s=>s.unavailable||(s.size??s.offset)<=s.offset)){delete ledger.rereadBefore;rereadKeep=new Set();changed=true}
        ledger.lastScanAt=clock()
        if(changed){ledger.foldScanAt=ledger.lastScanAt;await mkdir(dir,{recursive:true});await writeAtomic(file,JSON.stringify(ledger))}
      }finally{busy=false}
    },
  }
}
