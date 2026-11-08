// Reported usage only. API-equivalent estimates are not subscription charges or quota conversions.
export const PRICE_BASIS={date:'2026-10-21',currency:'USD',source:'https://platform.claude.com/docs/en/about-claude/pricing',label:'API-equivalent estimate; subscription bill unchanged'}
const prices={
  'claude-opus-5-5':{input:4,output:20,cacheRead:.2,cacheWrite:[5,8]},
  'claude-sonnet-5-5':{input:2,output:10,cacheRead:.1,cacheWrite:[2.5,4]},
  'claude-fable-5-1':{input:10,output:50,cacheRead:.25,cacheWrite:[12.5,20]},
  'claude-opus-4-6':{input:5,output:25,cacheRead:.5,cacheWrite:[6.25,10]},
  'claude-sonnet-4-6':{input:3,output:15,cacheRead:.3,cacheWrite:[3.75,6]},
  'claude-haiku-4-5':{input:1,output:5,cacheRead:.1,cacheWrite:[1.25,2]},
}
const tokenKeys=['input','cacheWrite','cacheRead','output']
const number=n=>Number.isFinite(n)&&n>=0?n:null
export function estimateUsage(event){
  if(event.conflictingAttribution)return {known:false,low:null,high:null}
  const tokens=tokenKeys.map(k=>number(event[k]))
  if(tokens.some(n=>n===null))return {known:false,low:null,high:null}
  let price=prices[event.actualModel]
  if(event.actualModel==='claude-haiku-5-5')price=event.input+event.cacheRead+event.cacheWrite<=100000?{input:.1,output:.5,cacheRead:.01,cacheWrite:[.125,.2]}:{input:.5,output:2.5,cacheRead:.05,cacheWrite:[.625,1]}
  if(!price)return {known:false,low:null,high:null}
  const base=(event.input*price.input+event.cacheRead*price.cacheRead+event.output*price.output)/1e6
  return {known:true,low:base+event.cacheWrite*price.cacheWrite[0]/1e6,high:base+event.cacheWrite*price.cacheWrite[1]/1e6}
}
const calls=entry=>(entry.blocks??[]).filter(b=>b.type==='tool_use'&&/(?:^|__)work$/.test(b.name??'')).map(b=>b.input??{})
const phaseOf=action=>['refine','refined','contract','new'].includes(action)?'spec':['checked','candidate-review'].includes(action)?'review':['route-raise'].includes(action)?'evaluate':null
// `index` (a Map by message id) is filled in place, for a collector that keeps it between chunks; without it `previous` is copied.
export function attributeUsage({entries,assignments=[],sourceSessionId,parentSessionId=null,chat=sourceSessionId,role,previous=[],index=null,cursor={}}){
  const events=index??new Map(previous.map(e=>[e.messageId,e]));let unknown=0,taskId=cursor.taskId??null
  for(const entry of entries){
    if(entry.type!=='assistant')continue
    const child=parentSessionId!==null||entry.isSidechain===true
    const actions=calls(entry),take=actions.find(a=>a.action==='take'&&/^B\d+$/.test(a.id??''))
    if(take&&!child)taskId=take.id
    if(!entry.messageId||!Number.isFinite(entry.at)){unknown++;continue}
    const assignment=assignments.filter(a=>a.ownerSessionId===sourceSessionId&&entry.at>=a.createdAt&&(a.completedAt==null||entry.at<=a.completedAt)).sort((a,b)=>b.createdAt-a.createdAt)[0]
    const tagged=actions.find(a=>/^B\d+$/.test(a.id??'')&&phaseOf(a.action))
    const next={messageId:entry.messageId,sourceSessionId,parentSessionId,chat,role:role??'unknown',sourceAt:entry.at,actualModel:entry.model??null,actualEffort:entry.effort??null,taskId:assignment?.taskId??tagged?.id??(child?null:taskId),rootTaskId:assignment?.rootTaskId??null,attemptId:assignment?.attemptId??null,phase:assignment?.phase??phaseOf(tagged?.action)??(!child&&role==='main'?'coordinate':taskId&&!child?'implement':'unattributed'),attribution:assignment?'assignment':tagged?'work-call':taskId&&!child?'active-task':'unattributed',isChild:child,...Object.fromEntries(tokenKeys.map(k=>[k,number(entry.usage?.[k])]))}
    const before=events.get(entry.messageId)
    if(before){
      // Message IDs are global. A fork's copied old lines are not newly generated answers.
      const merged={...before}
      if(before.actualModel&&next.actualModel&&before.actualModel!==next.actualModel)merged.conflictingAttribution=true
      for(const k of tokenKeys)merged[k]=before[k]===null||next[k]===null?before[k]??next[k]:Math.max(before[k],next[k])
      if(!merged.actualModel&&next.actualModel)merged.actualModel=next.actualModel
      if(before.sourceSessionId===sourceSessionId&&!merged.taskId&&next.taskId){merged.taskId=next.taskId;merged.phase=next.phase;merged.attribution=next.attribution}
      events.set(entry.messageId,merged)
    }else events.set(entry.messageId,next)
    if(actions.some(a=>a.action==='report'&&a.id===taskId)&&!child)taskId=null
  }
  return {events:index?null:[...events.values()],cursor:{taskId},unknown}
}
const round=n=>Math.round(n*1e8)/1e8
// Round 4 (f): an event's cost and day are worked out once and kept with it, not again in every grouping of every
// period each minute (five summaries over 50 000 events froze the board 0.4-0.9 s).
const costs=new WeakMap(),days=new Map()
const costOf=e=>{let cost=costs.get(e);if(cost===undefined){cost=estimateUsage(e);costs.set(e,cost)}return cost}
const dayOf=at=>{const day=Math.floor(at/86400000);let text=days.get(day);if(text===undefined){text=new Date(day*86400000).toISOString().slice(0,10);days.set(day,text)}return text}
/**
 * Round 4 (b): a day's events the 50 000 cap drops are kept as totals, one row per day, chat, model, effort, phase and task:
 * `{folded:true,sourceAt:<the day's start>,chat,actualModel,actualEffort,phase,messages,unknown,low,high,<tokens>}`,
 * its cost worked out per message before it was folded. A row counts as its `messages` in every grouping.
 */
export function foldEvents(rows,events){
  const byKey=new Map(rows.map(row=>[[row.sourceAt,row.chat,row.actualModel,row.actualEffort,row.phase,row.taskId??null].join('|'),row]))
  for(const e of events){
    const sourceAt=Math.floor(e.sourceAt/86400000)*86400000,key=[sourceAt,e.chat,e.actualModel,e.actualEffort,e.phase,e.taskId??null].join('|')
    let row=byKey.get(key)
    if(!row){row={folded:true,sourceAt,chat:e.chat,actualModel:e.actualModel,actualEffort:e.actualEffort,phase:e.phase,taskId:e.taskId??null,messages:0,unknown:0,low:0,high:0,input:0,cacheRead:0,cacheWrite:0,output:0};byKey.set(key,row)}
    const cost=e.folded?{known:true,low:e.low,high:e.high}:estimateUsage(e),count=e.folded?e.messages:1
    row.messages+=count;row.unknown+=e.folded?e.unknown:cost.known?0:1
    if(cost.known){row.low+=cost.low;row.high+=cost.high}
    for(const t of tokenKeys)row[t]+=number(e[t])??0
  }
  return [...byKey.values()]
}
// Every grouping of a period in one pass over its events: `keys` names each grouping and how it keys an event (null:
// the event is not in that grouping).
function groupedMany(events,keys){
  const all=Object.fromEntries(Object.keys(keys).map(name=>[name,new Map()])),names=Object.keys(keys)
  for(const e of events){
    let messages=1,low=0,high=0,unknown=0
    if(e.folded){messages=e.messages;low=e.low;high=e.high;unknown=e.unknown}
    else{const cost=costOf(e);if(cost.known){low=cost.low;high=cost.high}else unknown=1}
    for(const name of names){
      const k=keys[name](e);if(k===null)continue
      const key=k??'Unknown',groups=all[name];let g=groups.get(key)
      if(!g){g={key,messages:0,low:0,high:0,unknown:0,input:0,cacheRead:0,cacheWrite:0,output:0};groups.set(key,g)}
      g.messages+=messages;g.low+=low;g.high+=high;g.unknown+=unknown
      for(const t of tokenKeys)g[t]+=number(e[t])??0
    }
  }
  return Object.fromEntries(names.map(name=>[name,[...all[name].values()].map(g=>({...g,low:round(g.low),high:round(g.high)})).sort((a,b)=>b.high-a.high||a.key.localeCompare(b.key))]))
}
const grouped=(events,key)=>groupedMany(events,{one:key}).one
export function routingSummary({events=[],folded=[],outcomes=[],now=Date.now(),days=7,coverage={}}){
  const asked=days===null?-Infinity:now-days*86400000
  // A folded day cannot be cut: it is one row at its day's start. When it holds the window's start, the window begins at
  // that day's start instead (up to 24 h more than asked, folded and kept events alike), and `coverage.widenedFrom` says so.
  // It does so only when the kept events begin after the asked start: if they reach back past it, the folded days are all older.
  const widened=days!==null&&folded.some(e=>e.sourceAt<asked&&e.sourceAt+86400000>asked)&&!events.some(e=>e.sourceAt<=asked),from=widened?Math.floor(asked/86400000)*86400000:asked
  const selected=[...folded.filter(e=>e.sourceAt>=from&&e.sourceAt<=now),...events.filter(e=>e.sourceAt>=from&&e.sourceAt<=now)]
  const groups=groupedMany(selected,{total:()=> 'total',attributed:e=>e.taskId?'total':null,phases:e=>e.phase,models:e=>e.actualModel,efforts:e=>e.actualEffort,chats:e=>e.chat,tasks:e=>e.taskId??'Unassigned',daily:e=>dayOf(e.sourceAt)})
  const total=groups.total[0]??{low:0,high:0,messages:0,unknown:0,input:0,cacheRead:0,cacheWrite:0,output:0}
  const ids=new Set(selected.map(e=>e.taskId).filter(Boolean));const relevant=outcomes.filter(o=>ids.has(o.id));const accepted=relevant.filter(o=>o.accepted===true)
  const a=groups.attributed[0]??{low:0,high:0,messages:0}
  const byOutcome=new Map(outcomes.map(o=>[o.id,o]))
  const phases=groups.phases,models=groups.models,tasks=groups.tasks.map(t=>({...t,outcome:byOutcome.get(t.key)??null}));
  const measured=accepted.filter(o=>Number.isInteger(o.attempts)&&o.attempts>0)
  const suggestions=[]
  if(selected.some(e=>e.actualModel?.includes('opus')&&e.phase==='coordinate'))suggestions.push({kind:'review',text:'Inspect routine coordination still using Opus. Sonnet is the proposed baseline; confirm its checks before switching.'})
  if(selected.some(e=>e.actualEffort==='xhigh'||e.actualEffort==='max'))suggestions.push({kind:'review',text:'Inspect extra-high and max effort tasks. Keep these settings where the risk requires them.'})
  if(total.unknown||selected.some(e=>!e.taskId))suggestions.push({kind:'coverage',text:'Some spending cannot be priced or linked to a task. Improve coverage before claiming savings.'})
  if(relevant.some(o=>(o.attempts??0)>1))suggestions.push({kind:'quality',text:'Compare repair costs by task class before expanding cheaper model assignments.'})
  if(!selected.length)suggestions.push({kind:'coverage',text:'No reported usage in this period yet. The collector reads local transcripts without making model calls.'})
  return {days,from:Number.isFinite(from)?from:null,until:now,priceBasis:PRICE_BASIS,knownCost:{low:round(total.low),high:round(total.high)},messages:total.messages,unknownCostMessages:total.unknown,tokens:Object.fromEntries(tokenKeys.map(k=>[k,selected.length&&!selected.some(e=>number(e[k])!==null)?null:total[k]])),attributedMessages:a.messages,attributionPercent:total.messages?Math.round(100*a.messages/total.messages):null,accepted:accepted.length,qualitySample:measured.length,firstPassPercent:measured.length?Math.round(100*measured.filter(o=>o.attempts===1).length/measured.length):null,attributedCostPerAccepted:accepted.length?{low:round(a.low/accepted.length),high:round(a.high/accepted.length)}:null,models,efforts:groups.efforts,chats:groups.chats,phases,tasks,daily:groups.daily.sort((a,b)=>a.key.localeCompare(b.key)),suggestions,comparison:{savingsPercent:null,why:'A matched baseline and completed quality trials are required.'},coverage:{...coverage,widenedFrom:widened?from:null,earliestMessage:selected.length?selected.reduce((first,e)=>Math.min(first,e.sourceAt),Infinity):null,includesUnfinishedAndFailedWork:true}}
}
export function spendingCsv(summary){
  const cell=v=>{const text=String(v??'');return `"${text.match(/^[=+@\-\t\r]/)?"'":''}${text.replaceAll('"','""')}"`}
  const rows=[['Category','Name','Messages','Estimated cost low USD','Estimated cost high USD','Messages with unknown cost']]
  for(const key of ['scope','pendingFiles','pendingBytes','childTranscripts','unavailableTranscripts','unknownMessages','skippedLongLines','discoveryLimited','retentionLimited','unavailable','problem'])if(summary.coverage?.[key]!==undefined)rows.push(['coverage',`${key}: ${summary.coverage[key]}`])
  for(const category of ['models','efforts','chats','phases','tasks','daily'])for(const r of summary[category]??[])rows.push([category,r.key,r.messages,r.low,r.high,r.unknown])
  return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n'
}
