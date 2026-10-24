export function readRoutingRecord(item){
  const read=name=>{const lines=item?.sections?.get(name);return lines===undefined?null:JSON.parse(lines.join('\n'))}
  try{const routing=read('Routing');const contract=read('Contract');const candidates=read('Candidates')??[];const repair=read('Repair');if(routing!==null&&(routing.version!==1||typeof routing.managed!=='boolean'||!Array.isArray(routing.assignments)))throw Error('Invalid routing record');if(!Array.isArray(candidates))throw Error('Invalid candidates');return {ok:true,record:{contract,managed:routing?.managed??false,policy:routing?.policy??null,policyHash:routing?.policyHash??null,assignments:routing?.assignments??[],candidates,repair}}}catch{return {ok:false,why:'Routing record is unreadable; managed work is held.'}}
}
export function writeRoutingSections(item,record){
  const next={...item,head:new Map(item.head),sections:new Map([...item.sections].map(([key,lines])=>[key,[...lines]]))}
  if(record.contract)next.sections.set('Contract',[JSON.stringify(record.contract)])
  next.sections.set('Routing',[JSON.stringify({version:1,managed:record.managed,policy:record.policy??null,policyHash:record.policyHash??null,assignments:record.assignments})])
  next.sections.set('Candidates',[JSON.stringify(record.candidates)])
  if(record.repair)next.sections.set('Repair',[JSON.stringify(record.repair)])
  return next
}
