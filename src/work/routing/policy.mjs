import {createHash} from 'node:crypto'
import {enforcementReadiness} from './capabilities.mjs'
import {validRelative} from './contract.mjs'

export const EFFORTS=['low','medium','high','xhigh','max']
export const FAMILIES=['haiku','sonnet','opus']
const protectedPaths=['src/work/routing/**','src/work/api.mjs','src/work/store.mjs','src/work/guards.mjs','src/work/flow.mjs','src/work/requests.mjs','src/work/check.mjs','src/work/resultCheck.mjs','src/work/sync.mjs','src/config.mjs','server.mjs','mods/**','roles/**','tools/merge-approved.mjs','src/core/**','src/save/**','src/persistence/**','docs/process/done/**','CLAUDE.md','AGENTS.md']
const registry=Object.fromEntries(FAMILIES.map(family=>[family,{model:`claude-${family}-5-5`,verified:false,efforts:['low','medium','high','xhigh','max']}]))
export const DEFAULT_POLICY={version:1,mode:'off',registry,r0Canary:false,r1Canary:false,settingTimeoutMs:120000,validationConcurrency:1,protectedPaths,maxAttempts:3,maxLifetimeAttempts:12,maxStrategies:4}
const stable=value=>value&&typeof value==='object' ? Array.isArray(value)?value.map(stable):Object.fromEntries(Object.keys(value).sort().map(key=>[key,stable(value[key])])):value
export const policyHash=policy=>createHash('sha256').update(JSON.stringify(stable({...policy,mode:undefined}))).digest('hex')
const bad=why=>({ok:false,policy:null,hash:null,why})
export function parseRoutingPolicy(raw) {
  if(raw!==undefined && (raw===null||typeof raw!=='object'||Array.isArray(raw)))return bad('Routing policy must be an object.')
  const policy={...structuredClone(DEFAULT_POLICY),...raw,registry:{...structuredClone(registry),...raw?.registry}}
  if(!['off','observe','enforce'].includes(policy.mode))return bad('Routing mode must be off, observe or enforce.')
  if(policy.version!==1)return bad('Unsupported routing policy version.')
  for(const family of FAMILIES){const m=policy.registry[family]; if(!m||typeof m.model!=='string'||!m.model.startsWith(`claude-${family}-`)||!Array.isArray(m.efforts)||m.efforts.length===0||m.efforts.some(e=>!EFFORTS.includes(e))||typeof m.verified!=='boolean')return bad(`Invalid ${family} model or efforts.`)}
  if(!Array.isArray(policy.protectedPaths)||policy.protectedPaths.some(p=>typeof p!=='string'||p.includes('..')))return bad('Invalid protected paths.')
  if(typeof policy.r0Canary!=='boolean'||typeof policy.r1Canary!=='boolean'||policy.validationConcurrency!==1||policy.settingTimeoutMs!==120000||policy.maxAttempts!==3||policy.maxLifetimeAttempts!==12||policy.maxStrategies!==4)return bad('Invalid routing safeguards; ceilings cannot be silently changed.')
  return {ok:true,policy,hash:policyHash(policy),why:null}
}
const route=(family,effort,policy)=>({family,model:policy.registry[family].model,effort})
const stronger=(a,b)=>!b?a:FAMILIES.indexOf(b.family)>FAMILIES.indexOf(a.family)?b:FAMILIES.indexOf(b.family)===FAMILIES.indexOf(a.family)&&EFFORTS.indexOf(b.effort)>EFFORTS.indexOf(a.effort)?b:a
const protectedMatch=(path,pattern)=>{
  path=path.replaceAll('\\','/').toLowerCase();pattern=pattern.replaceAll('\\','/').toLowerCase()
  const scopeDirectory=path.endsWith('/**'),protectedDirectory=pattern.endsWith('/**')
  const scope=scopeDirectory?path.slice(0,-3):path,guard=protectedDirectory?pattern.slice(0,-3):pattern
  return scope===guard||(scopeDirectory&&guard.startsWith(scope+'/'))||(protectedDirectory&&scope.startsWith(guard+'/'))
}
export function meetsRoute(actual,required,models=registry){
  if(!actual||!required)return false
  const family=FAMILIES.find(one=>models[one]?.model===actual.model)
  return family!==undefined&&FAMILIES.indexOf(family)>=FAMILIES.indexOf(required.family)&&EFFORTS.includes(actual.effort)&&EFFORTS.indexOf(actual.effort)>=EFFORTS.indexOf(required.effort)&&models[family].efforts.includes(actual.effort)
}
export function resolveRoute({policy,phase='implement',role='worker',contract,changedPaths=[],previousFloor,capabilities}={}){
  if(!policy?.registry)return {ok:false,why:'Routing policy unavailable.',route:null}
  let selected,risk=structuredClone(contract?.risk??{class:null,factors:[],why:'Assessment missing'})
  const reasons=[]
  if(phase==='coordinate'||(!contract&&['main','advisor','helper'].includes(role))){ selected=route(role==='helper'?'haiku':'sonnet',role==='main'?'low':role==='helper'?'low':'medium',policy) }
  else{
    if(!['R0','R1','R2','R3'].includes(risk.class))return {ok:false,why:'Hold for Sonnet/high assessment: risk is unknown.',route:null,risk}
    const paths=[...changedPaths,...Object.values(contract?.allowedPaths??{}).flat()]
    if(paths.some(p=>!validRelative(p.endsWith?.('/**')?p.slice(0,-3):p)))return {ok:false,route:null,risk,why:'Scope paths are unknown or outside the repository.'}
    if(paths.some(p=>policy.protectedPaths.some(pattern=>protectedMatch(p,pattern)))){risk.class='R3';reasons.push('Protected scope')}
    const high=(risk.factors??[]).length>0
    if(high&&['R0','R1'].includes(risk.class))risk.class='R2'
    if((risk.factors??[]).includes('unresolved-design'))risk.class='R3'
    const mechanical=paths.length>0&&paths.every(p=>!p.includes('*')&&/\.(?:md|txt|csv|tsv|json|ya?ml)$/i.test(p))&&!high
    if(risk.class==='R0')selected=route(policy.r0Canary&&mechanical?'haiku':'sonnet',policy.r0Canary&&mechanical?'low':'medium',policy)
    const narrow=paths.length>0&&paths.every(p=>!p.includes('*')||/^(?:test|tests)\/\*\*$/i.test(p.replaceAll('\\','/')))&&validRelative(contract.patternReference??'')
    if(risk.class==='R1')selected=route(policy.r1Canary&&narrow&&Number.isInteger(contract.implementationFiles)&&contract.implementationFiles<=3&&contract.implementationFiles>0&&!high?'haiku':'sonnet','medium',policy)
    if(risk.class==='R2')selected=route('sonnet',high?'high':'medium',policy)
    if(risk.class==='R3'){const plan=contract.implementationPlan;const fixed=plan?.verified===true&&plan?.sha256&&plan.approvalModel===policy.registry.opus.model&&EFFORTS.indexOf(plan.approvalEffort)>=2;selected=route(fixed&&phase==='implement'?'sonnet':'opus','high',policy)}
    if(phase==='review'||role==='reviewer'||phase==='spec')selected=route(risk.class==='R3'?'opus':'sonnet',risk.class==='R3'||high?'high':'medium',policy)
  }
  selected=stronger(selected,previousFloor)
  const model=policy.registry[selected.family]
  if(!model||selected.model!==model.model||!model.verified||!model.efforts.includes(selected.effort))return {ok:false,route:selected,risk,reasons,why:'Required exact model/effort is not verified available.'}
  if(policy.mode==='enforce'&&!enforcementReadiness(capabilities).ok)return {ok:false,route:selected,risk,reasons,why:enforcementReadiness(capabilities).why}
  return {ok:true,route:selected,risk,reviewFloor:route(risk.class==='R3'?'opus':'sonnet',risk.class==='R3'?'high':'medium',policy),reasons:[...reasons,risk.why??`${role}: ${phase}`],why:null}
}
