import {createHash} from 'node:crypto'
const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v
export function canonicalContract(value){const {hash,approvedAt,approvedBy,...content}=value;return JSON.stringify(canonical(content))}
export const contractHash=value=>createHash('sha256').update(canonicalContract(value)).digest('hex')
export const validRelative=path=>typeof path==='string'&&path.length>0&&!/^[\\/]|^[a-z]:/i.test(path)&&!path.replaceAll('\\','/').split('/').some(p=>p==='..'||p==='.'||p==='')&&!/[\u0000-\u001f]/.test(path)
export function pathAllowed(path,patterns){if(!validRelative(path)||/[*?]/.test(path))return false;const normal=path.replaceAll('\\','/').toLowerCase();return patterns.some(pattern=>{const p=pattern.replaceAll('\\','/').toLowerCase();return p.endsWith('/**')?normal.startsWith(p.slice(0,-2)):normal===p})}
export function validateContract(contract){
  const bad=why=>({ok:false,why})
  if(!contract||typeof contract!=='object'||contract.version!==1||typeof contract.goal!=='string'||!contract.goal.trim())return bad('A version 1 contract needs a goal.')
  if(!Array.isArray(contract.requirements)||contract.requirements.length<1||contract.requirements.length>30)return bad('Give 1–30 observable acceptance criteria.')
  const ids=new Set()
  for(const point of contract.requirements){if(!/^AC[1-9]\d*$/.test(point.id)||ids.has(point.id)||typeof point.behaviour!=='string'||!point.behaviour.trim()||!Array.isArray(point.checks)||!point.checks.length||point.checks.some(c=>typeof c!=='string'||!c.trim()))return bad('Acceptance IDs must be unique with a behaviour and checks.');ids.add(point.id)}
  if(!Array.isArray(contract.repositories)||!contract.repositories.length||contract.repositories.some(r=>!/^[-\w]+$/.test(r))||!contract.allowedPaths||typeof contract.allowedPaths!=='object')return bad('Name configured repositories and relative scope.')
  for(const repo of contract.repositories){const paths=contract.allowedPaths[repo];if(!Array.isArray(paths)||!paths.length||paths.some(p=>!validRelative(p.endsWith?.('/**')?p.slice(0,-3):p)||/[*?]/.test(p.endsWith?.('/**')?p.slice(0,-3):p)))return bad('Scope uses exact relative files or directory/** prefixes only.')}
  if(!['R0','R1','R2','R3'].includes(contract.risk?.class)||!Array.isArray(contract.risk.factors)||typeof contract.risk.why!=='string'||!contract.risk.why.trim())return bad('An eligible spec approver must assess risk.')
  if(!Array.isArray(contract.nonGoals)||!Array.isArray(contract.interfaces)||!Array.isArray(contract.evidence)||!contract.evidence.length||typeof contract.validationProfile!=='string'||!contract.validationProfile.trim())return bad('Include non-goals, interfaces, evidence and a configured validation profile.')
  return {ok:true,contract:structuredClone(contract),hash:contractHash(contract)}
}
export function contractOf(item){try{const value=JSON.parse((item?.sections?.get('Contract')??[]).join('\n'));const read=validateContract(value);return !read.ok?read:value.hash!==read.hash?{ok:false,why:'Contract approval is stale.'}:{...read,contract:value}}catch{return {ok:false,why:'Approved contract missing or unreadable.'}}}
