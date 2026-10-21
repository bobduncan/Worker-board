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
export function attributeUsage({entries,assignments=[],sourceSessionId,chat=sourceSessionId,role,previous=[],cursor={}}){
  const events=new Map(previous.map(e=>[e.messageId,e]));let unknown=0,taskId=cursor.taskId??null
  for(const entry of entries){
    if(entry.type!=='assistant')continue
    const actions=calls(entry),take=actions.find(a=>a.action==='take'&&/^B\d+$/.test(a.id??''))
    if(take&&!entry.isSidechain)taskId=take.id
    if(!entry.messageId||!Number.isFinite(entry.at)){unknown++;continue}
    if(!entry.usage)continue
    const assignment=assignments.filter(a=>a.ownerSessionId===sourceSessionId&&entry.at>=a.createdAt&&(a.completedAt==null||entry.at<=a.completedAt)).sort((a,b)=>b.createdAt-a.createdAt)[0]
    const tagged=actions.find(a=>/^B\d+$/.test(a.id??'')&&phaseOf(a.action))
    const next={messageId:entry.messageId,sourceSessionId,chat,role:role??'unknown',sourceAt:entry.at,actualModel:entry.model??null,actualEffort:entry.effort??null,taskId:assignment?.taskId??tagged?.id??(entry.isSidechain?null:taskId),rootTaskId:assignment?.rootTaskId??null,attemptId:assignment?.attemptId??null,phase:assignment?.phase??phaseOf(tagged?.action)??(role==='main'?'coordinate':taskId&&!entry.isSidechain?'implement':'unattributed'),attribution:assignment?'assignment':tagged?'work-call':taskId&&!entry.isSidechain?'active-task':'unattributed',isChild:entry.isSidechain===true,...Object.fromEntries(tokenKeys.map(k=>[k,number(entry.usage[k])]))}
    const before=events.get(entry.messageId)
    if(before){
      // Message IDs are global. A fork's copied old lines are not newly generated answers.
      const merged={...before}
      for(const k of tokenKeys)merged[k]=before[k]===null||next[k]===null?before[k]??next[k]:Math.max(before[k],next[k])
      if(!merged.actualModel&&next.actualModel)merged.actualModel=next.actualModel
      events.set(entry.messageId,merged)
    }else events.set(entry.messageId,next)
    if(actions.some(a=>a.action==='report'&&a.id===taskId)&&!entry.isSidechain)taskId=null
  }
  return {events:[...events.values()],cursor:{taskId},unknown}
}
const round=n=>Math.round(n*1e8)/1e8
function grouped(events,key){
  const groups=new Map()
  for(const e of events){const k=key(e)??'Unknown';let g=groups.get(k);if(!g){g={key:k,messages:0,low:0,high:0,unknown:0,input:0,cacheRead:0,cacheWrite:0,output:0};groups.set(k,g)}g.messages++;const cost=estimateUsage(e);if(cost.known){g.low+=cost.low;g.high+=cost.high}else g.unknown++;for(const t of tokenKeys)g[t]+=number(e[t])??0}
  return [...groups.values()].map(g=>({...g,low:round(g.low),high:round(g.high)})).sort((a,b)=>b.high-a.high||a.key.localeCompare(b.key))
}
export function routingSummary({events=[],outcomes=[],now=Date.now(),days=7,coverage={}}){
  const from=days===null?-Infinity:now-days*86400000
  const selected=events.filter(e=>e.sourceAt>=from&&e.sourceAt<=now)
  const total=grouped(selected,()=> 'total')[0]??{low:0,high:0,messages:0,unknown:0,input:0,cacheRead:0,cacheWrite:0,output:0}
  const ids=new Set(selected.map(e=>e.taskId).filter(Boolean));const relevant=outcomes.filter(o=>ids.has(o.id));const accepted=relevant.filter(o=>o.accepted===true)
  const attributed=selected.filter(e=>e.taskId);const a=grouped(attributed,()=> 'total')[0]??{low:0,high:0}
  const phases=grouped(selected,e=>e.phase),models=grouped(selected,e=>e.actualModel),tasks=grouped(selected,e=>e.taskId??'Unassigned').map(t=>({...t,outcome:outcomes.find(o=>o.id===t.key)??null}));
  const measured=accepted.filter(o=>Number.isInteger(o.attempts)&&o.attempts>0)
  const suggestions=[]
  if(selected.some(e=>e.actualModel?.includes('opus')&&e.phase==='coordinate'))suggestions.push({kind:'review',text:'Inspect routine coordination still using Opus. Sonnet is the proposed baseline; confirm its checks before switching.'})
  if(selected.some(e=>e.actualEffort==='xhigh'||e.actualEffort==='max'))suggestions.push({kind:'review',text:'Inspect extra-high and max effort tasks. Keep these settings where the risk requires them.'})
  if(total.unknown||selected.some(e=>!e.taskId))suggestions.push({kind:'coverage',text:'Some spending cannot be priced or linked to a task. Improve coverage before claiming savings.'})
  if(relevant.some(o=>(o.attempts??0)>1))suggestions.push({kind:'quality',text:'Compare repair costs by task class before expanding cheaper model assignments.'})
  if(!selected.length)suggestions.push({kind:'coverage',text:'No reported usage in this period yet. The collector reads local transcripts without making model calls.'})
  return {days,from:Number.isFinite(from)?from:null,until:now,priceBasis:PRICE_BASIS,knownCost:{low:round(total.low),high:round(total.high)},messages:selected.length,unknownCostMessages:total.unknown,tokens:Object.fromEntries(tokenKeys.map(k=>[k,total[k]])),attributedMessages:attributed.length,attributionPercent:selected.length?Math.round(100*attributed.length/selected.length):null,accepted:accepted.length,qualitySample:measured.length,firstPassPercent:measured.length?Math.round(100*measured.filter(o=>o.attempts===1).length/measured.length):null,attributedCostPerAccepted:accepted.length?{low:round(a.low/accepted.length),high:round(a.high/accepted.length)}:null,models,efforts:grouped(selected,e=>e.actualEffort),chats:grouped(selected,e=>e.chat),phases,tasks,daily:grouped(selected,e=>new Date(e.sourceAt).toISOString().slice(0,10)).sort((a,b)=>a.key.localeCompare(b.key)),suggestions,comparison:{savingsPercent:null,why:'A matched baseline and completed quality trials are required.'},coverage:{...coverage,earliestMessage:selected.length?Math.min(...selected.map(e=>e.sourceAt)):null,includesUnfinishedAndFailedWork:true}}
}
export function spendingCsv(summary){
  const cell=v=>{const text=String(v??'');return `"${text.match(/^[=+@\-\t\r]/)?"'":''}${text.replaceAll('"','""')}"`}
  const rows=[['Category','Name','Messages','Estimated cost low USD','Estimated cost high USD','Messages with unknown cost']]
  for(const category of ['models','efforts','chats','phases','tasks','daily'])for(const r of summary[category]??[])rows.push([category,r.key,r.messages,r.low,r.high,r.unknown])
  return '\uFEFF'+rows.map(row=>row.map(cell).join(',')).join('\r\n')+'\r\n'
}
