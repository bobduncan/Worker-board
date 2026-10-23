import {mkdir,open,readFile,readdir} from 'node:fs/promises'
import {join} from 'node:path'
import {writeAtomic} from '../../write.mjs'
import {parseTail} from '../../transcript.mjs'
import {attributeUsage,routingSummary} from './metrics.mjs'

const CHUNK=1024*1024,MAX_EVENTS=50000,MAX_FILES=32,MAX_BYTES=16*CHUNK,MAX_CHILDREN=4096
const nonnegative=n=>Number.isFinite(n)&&n>=0
const nullableString=s=>s===null||typeof s==='string'
function validLedger(raw){
  return raw?.version===1&&Array.isArray(raw.events)&&raw.events.every(e=>e&&typeof e.messageId==='string'&&typeof e.sourceSessionId==='string'&&typeof e.chat==='string'&&typeof e.phase==='string'&&nonnegative(e.sourceAt)&&Number.isFinite(new Date(e.sourceAt).getTime())&&nullableString(e.actualModel)&&nullableString(e.actualEffort)&&['input','cacheWrite','cacheRead','output'].every(k=>e[k]===null||nonnegative(e[k])))&&raw.scans&&typeof raw.scans==='object'&&!Array.isArray(raw.scans)&&Object.values(raw.scans).every(s=>s&&Number.isSafeInteger(s.offset)&&s.offset>=0&&(s.size===undefined||nonnegative(s.size))&&(s.taskId===undefined||nullableString(s.taskId)))&&(raw.startedAt===undefined||nonnegative(raw.startedAt))&&(raw.unknown===undefined||nonnegative(raw.unknown))&&(raw.nextScanIndex===undefined||Number.isSafeInteger(raw.nextScanIndex)&&raw.nextScanIndex>=0)
}
export function createSpendingCollector({dir,transcripts,clock=Date.now}){
  let ledger={version:1,events:[],scans:{},startedAt:clock(),lastScanAt:null,unknown:0,retentionLimited:false},busy=false,problem=null,outcomes=[],unavailable=false
  const file=join(dir,'spending.json')
  const coverage=()=>({startedAt:ledger.startedAt,lastScanAt:ledger.lastScanAt,unknownMessages:ledger.unknown??0,skippedLongLines:ledger.skippedLongLines??0,pendingBytes:Object.values(ledger.scans).reduce((sum,scan)=>sum+Math.max(0,(scan.size??scan.offset)-scan.offset),0),pendingFiles:ledger.pendingFiles??0,childTranscripts:ledger.childTranscripts??0,unavailableTranscripts:ledger.unavailableTranscripts??0,discoveryLimited:ledger.discoveryLimited??false,retentionLimited:ledger.retentionLimited,collecting:busy,problem,unavailable,scope:'Recorded project chats and discovered native children, including Main and Advisors; missing or still-pending transcripts leave totals incomplete.'})
  return {
    async load(){
      try{const raw=JSON.parse(await readFile(file,'utf8'));if(!validLedger(raw))throw Error('Unsupported or corrupt spending ledger');ledger={...ledger,...raw}}
      catch(error){if(error.code!=='ENOENT'){unavailable=true;problem='Spending history is unavailable. The previous file is preserved; repair or move it aside before restarting collection.'}}
    },
    summary(days=7){
      try{return routingSummary({events:ledger.events,outcomes,now:clock(),days,coverage:coverage()})}
      catch{unavailable=true;problem='Spending is unavailable. Its local history is preserved; other board functions remain available.';return routingSummary({events:[],outcomes:[],now:clock(),days,coverage:{problem,unavailable:true}})}
    },
    /** Clear after each step: how far a session's transcript is read (a left session is read on to its end). */
    offsetOf(key){return ledger.scans[key]?.offset??0},
    async scan(subjects,{assignments=[],results=[]}={}){
      if(busy||!transcripts||unavailable)return
      busy=true;outcomes=results
      try{
        let changed=false,bytes=0,visited=0
        const jobs=[];ledger.discoveryLimited=false
        for(const subject of subjects){
          if(!/^[\w-]+$/.test(subject.session??''))continue
          jobs.push({...subject,key:subject.session,path:join(transcripts,`${subject.session}.jsonl`)})
          try{
            const children=(await readdir(join(transcripts,subject.session,'subagents'),{withFileTypes:true})).filter(f=>f.isFile()&&/^[\w-]+\.jsonl$/.test(f.name)).sort((a,b)=>a.name.localeCompare(b.name))
            if(children.length>MAX_CHILDREN)ledger.discoveryLimited=true
            for(const child of children.slice(0,MAX_CHILDREN))jobs.push({session:`${subject.session}:child:${child.name.slice(0,-6)}`,parentSessionId:subject.session,key:`${subject.session}/subagents/${child.name}`,path:join(transcripts,subject.session,'subagents',child.name),name:subject.name,role:'child'})
          }catch(error){if(error.code!=='ENOENT'){ledger.discoveryLimited=true;problem='Some native child transcripts could not be discovered; totals are incomplete.'}}
        }
        ledger.childTranscripts=jobs.filter(j=>j.parentSessionId).length
        const start=jobs.length?(ledger.nextScanIndex??0)%jobs.length:0
        let missing=0
        while(visited<Math.min(MAX_FILES,jobs.length)&&bytes<MAX_BYTES){
          const subject=jobs[(start+visited++)%jobs.length]
          let handle
          try{
            handle=await open(subject.path,'r')
            const stat=await handle.stat(),before=ledger.scans[subject.key]??{offset:0,taskId:null}
            let scan={...before,size:stat.size,unavailable:false};if(scan.offset>stat.size)scan={offset:0,taskId:null,size:stat.size}
            for(let chunk=0;chunk<2&&scan.offset<stat.size&&bytes<MAX_BYTES;chunk++){
              const buffer=Buffer.alloc(Math.min(CHUNK,stat.size-scan.offset,MAX_BYTES-bytes));const {bytesRead}=await handle.read(buffer,0,buffer.length,scan.offset);bytes+=bytesRead
              if(!bytesRead)break
              let lineStart=0
              if(scan.skippingLine){const newline=buffer.indexOf(10);if(newline<0){scan.offset+=bytesRead;changed=true;continue}lineStart=newline+1;scan.skippingLine=false}
              const end=buffer.lastIndexOf(10,bytesRead-1)
              if(end<lineStart){
                if(bytesRead===CHUNK){ledger.skippedLongLines=(ledger.skippedLongLines??0)+1;scan.skippingLine=true;scan.offset+=bytesRead;changed=true;problem='Oversized transcript lines are excluded; collection continues after them.';continue}
                if(lineStart>0){scan.offset+=lineStart;changed=true}
                break
              }
              const entries=parseTail(buffer.subarray(lineStart,end+1).toString('utf8'),false,true)
              const found=attributeUsage({entries,sourceSessionId:subject.session,parentSessionId:subject.parentSessionId??null,chat:subject.name,role:subject.role,assignments,previous:ledger.events,cursor:scan})
              ledger.events=found.events;ledger.unknown+=found.unknown;scan={...scan,...found.cursor,offset:scan.offset+end+1};changed=true
            }
            ledger.scans[subject.key]=scan
          }catch(error){missing++;ledger.scans[subject.key]={...(ledger.scans[subject.key]??{offset:0,taskId:null}),unavailable:true};if(error.code!=='ENOENT')problem=`Some local usage is unavailable (${error.code??'read failed'}).`}
          finally{await handle?.close()}
        }
        ledger.nextScanIndex=jobs.length?(start+visited)%jobs.length:0
        ledger.pendingFiles=jobs.filter(j=>!ledger.scans[j.key]).length
        ledger.unavailableTranscripts=Math.max(missing,jobs.filter(j=>ledger.scans[j.key]?.unavailable).length)
        if(ledger.events.length>MAX_EVENTS){ledger.events.sort((a,b)=>a.sourceAt-b.sourceAt);ledger.events=ledger.events.slice(-MAX_EVENTS);ledger.retentionLimited=true}
        ledger.lastScanAt=clock()
        if(changed){await mkdir(dir,{recursive:true});await writeAtomic(file,JSON.stringify(ledger))}
      }finally{busy=false}
    },
  }
}
