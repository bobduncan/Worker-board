import {readFile} from 'node:fs/promises'
import {fileURLToPath} from 'node:url'
import {parseRoutingPolicy,resolveRoute,FAMILIES,EFFORTS} from '../src/work/routing/policy.mjs'

export function replayCases(cases,rawPolicy){
  const parsed=parseRoutingPolicy(rawPolicy)
  if(!parsed.ok)return {passed:0,failed:cases.length,results:cases.map(c=>({label:c.label,passed:false,why:parsed.why}))}
  const results=cases.map(c=>{
    const result=resolveRoute({...c,policy:parsed.policy})
    const passed=c.expected.held?result.ok===false&&result.route===null:result.route!==null&&FAMILIES.indexOf(result.route.family)>=FAMILIES.indexOf(c.expected.family)&&EFFORTS.indexOf(result.route.effort)>=EFFORTS.indexOf(c.expected.effort)
    return {label:c.label,passed,route:result.route,why:result.why}
  })
  return {passed:results.filter(r=>r.passed).length,failed:results.filter(r=>!r.passed).length,results}
}
if(process.argv[1]===fileURLToPath(import.meta.url)){
  const args=process.argv.slice(2),file=name=>args[args.indexOf(name)+1]
  if(!args.includes('--cases')||!args.includes('--policy')){console.error('Usage: node tools/routing-replay.mjs --cases <cases.json> --policy <policy.json>');process.exitCode=2}
  else{try{const report=replayCases(JSON.parse(await readFile(file('--cases'),'utf8')),JSON.parse(await readFile(file('--policy'),'utf8')));console.log(JSON.stringify(report,null,2));process.exitCode=report.failed?1:0}catch(error){console.error(`Replay failed: ${error.message}`);process.exitCode=2}}
}
