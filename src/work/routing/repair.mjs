export function repairDecision({group:g,failure:f,quota}){
  const result=(kind,reason,route)=>({kind,reason,...(route?{route}:{})})
  if(!g||!Number.isInteger(g.attemptsInEpoch)||!Number.isInteger(g.lifetimeAttempts)||!Number.isInteger(g.strategyCount))return result('hold','Repair history is missing or corrupt.')
  if(quota?.exhausted)return result('hold','Included usage exhausted; quality floors and paid usage settings are unchanged.')
  if(g.lifetimeAttempts>=12||g.strategyCount>4)return result('hold','Lifetime attempt or strategy limit reached.')
  if(f.kind==='transport')return result((f.retries??0)<1?'retry-transport':'hold','Retry the same transport request once; no model promotion.')
  if(g.attemptsInEpoch>=3)return result('evaluate','Opus/high must evaluate a different approach before another implementation.')
  if(f.protectedScope||g.failures?.[f.id]>=1){const family=g.route?.family==='haiku'?'sonnet':'opus';return result('promote','Repeated acceptance failure or protected scope.',{family,effort:'high'})}
  return result('repair','One targeted repair of the concrete finding at the current setting.')
}
export function rootRepairGroup(item,items){
  const seen=new Set();let root=item
  while(root?.head?.get('Fix of')){const id=root.head.get('Id');if(seen.has(id))return null;seen.add(id);root=items.get(root.head.get('Fix of'))}
  if(!root)return null
  try{return JSON.parse((root.sections.get('Repair')??[]).join('\n'))}catch{return null}
}
