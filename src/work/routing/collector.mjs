import {mkdir,open,readFile} from 'node:fs/promises'
import {join} from 'node:path'
import {writeAtomic} from '../../write.mjs'
import {parseTail} from '../../transcript.mjs'
import {attributeUsage,routingSummary} from './metrics.mjs'

const CHUNK=1024*1024,MAX_EVENTS=50000
export function createSpendingCollector({dir,transcripts,clock=Date.now}){
  let ledger={version:1,events:[],scans:{},startedAt:clock(),lastScanAt:null,unknown:0,retentionLimited:false},busy=false,problem=null,outcomes=[]
  const file=join(dir,'spending.json')
  return {
    async load(){
      try{const raw=JSON.parse(await readFile(file,'utf8'));if(raw.version!==1||!Array.isArray(raw.events)||!raw.scans)throw Error('Unsupported spending ledger');ledger=raw}
      catch(error){if(error.code!=='ENOENT')problem='Previous spending history could not be read. Figures cover newly collected data only.'}
    },
    summary(days=7){return routingSummary({events:ledger.events,outcomes,now:clock(),days,coverage:{startedAt:ledger.startedAt,lastScanAt:ledger.lastScanAt,unknownMessages:ledger.unknown,skippedLongLines:ledger.skippedLongLines??0,pendingBytes:Object.values(ledger.scans).reduce((sum,scan)=>sum+Math.max(0,(scan.size??scan.offset)-scan.offset),0),retentionLimited:ledger.retentionLimited,collecting:busy,problem,scope:'Recorded project chats, including Main and Advisors; omitted or unavailable transcripts remain unknown.'}})},
    async scan(subjects,{assignments=[],results=[]}={}){
      if(busy||!transcripts)return
      busy=true;outcomes=results
      try{
        let changed=false
        for(const subject of subjects){
          if(!/^[\w-]+$/.test(subject.session??''))continue
          let handle
          try{
            handle=await open(join(transcripts,`${subject.session}.jsonl`),'r')
            const stat=await handle.stat(),before=ledger.scans[subject.session]??{offset:0,taskId:null}
            let scan={...before,size:stat.size};if(scan.offset>stat.size)scan={offset:0,taskId:null,size:stat.size}
            for(let chunk=0;chunk<2&&scan.offset<stat.size;chunk++){
              const buffer=Buffer.alloc(Math.min(CHUNK,stat.size-scan.offset));const {bytesRead}=await handle.read(buffer,0,buffer.length,scan.offset)
              let start=0
              if(scan.skippingLine){const newline=buffer.indexOf(10);if(newline<0){scan.offset+=bytesRead;changed=true;continue}start=newline+1;scan.skippingLine=false}
              const end=buffer.lastIndexOf(10,bytesRead-1)
              if(end<start){
                if(bytesRead===CHUNK){if(!scan.skippingLine){ledger.skippedLongLines=(ledger.skippedLongLines??0)+1;scan.skippingLine=true}scan.offset+=bytesRead;changed=true;problem='Oversized transcript lines are excluded; collection continues after them.';continue}
                if(start>0){scan.offset+=start;changed=true}
                break
              }
              const entries=parseTail(buffer.subarray(start,end+1).toString('utf8'),false)
              const found=attributeUsage({entries,sourceSessionId:subject.session,chat:subject.name,role:subject.role,assignments,previous:ledger.events,cursor:scan})
              ledger.events=found.events;ledger.unknown+=found.unknown;scan={...scan,...found.cursor,offset:scan.offset+end+1};changed=true
            }
            ledger.scans[subject.session]=scan
          }catch(error){if(error.code!=='ENOENT')problem=`Some local usage is unavailable (${error.code??'read failed'}).`}
          finally{await handle?.close()}
        }
        if(ledger.events.length>MAX_EVENTS){ledger.events.sort((a,b)=>a.sourceAt-b.sourceAt);ledger.events=ledger.events.slice(-MAX_EVENTS);ledger.retentionLimited=true}
        ledger.lastScanAt=clock()
        if(changed){await mkdir(dir,{recursive:true});await writeAtomic(file,JSON.stringify(ledger))}
      }finally{busy=false}
    },
  }
}
